import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosCalloutComponent,
  CognosCardComponent,
  CognosPageHeaderComponent,
  CognosProgressComponent,
} from '@cognos/ui-angular';

import { ConversationImportClient } from '@app/import/conversation-import-client';
import { ConversationImportPersistence } from '@app/import/conversation-import-persistence';
import {
  ImportFailureReason,
  ImportPreview,
  ImportSource,
} from '@app/import/import-types';
import { Analytics } from '@app/services/analytics/analytics';

@Component({
  selector: 'app-conversation-import',
  imports: [
    CognosButtonComponent,
    CognosCalloutComponent,
    CognosCardComponent,
    CognosPageHeaderComponent,
    CognosProgressComponent,
    RouterLink,
    TranslocoModule,
  ],
  templateUrl: './conversation-import.html',
  styleUrl: './conversation-import.css',
})
export class ConversationImport {
  private readonly _client = inject(ConversationImportClient);
  private readonly _persistence = inject(ConversationImportPersistence);
  private readonly _router = inject(Router);
  private readonly _transloco = inject(TranslocoService);
  private readonly _analytics = inject(Analytics);
  readonly source = signal<ImportSource | null>(null);
  readonly stage = signal<
    'idle' | 'reading' | 'validated' | 'parsed' | 'encrypting' | 'complete' | 'error'
  >('idle');
  readonly preview = signal<ImportPreview | null>(null);
  readonly error = signal<ImportFailureReason | null>(null);
  readonly selected = signal<ReadonlySet<number>>(new Set());
  readonly busy = computed(() =>
    ['reading', 'validated', 'encrypting'].includes(this.stage()),
  );

  chooseSource(source: ImportSource): void {
    this._client.cancel();
    this.source.set(source);
    this.stage.set('idle');
    this.preview.set(null);
    this.error.set(null);
    this.selected.set(new Set());
  }

  sourceHelpUrl(source: ImportSource): string {
    return source === 'chatgpt'
      ? 'https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpt-history-and-data'
      : 'https://support.anthropic.com/en/articles/9450526-how-can-i-export-my-claude-data';
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const source = this.source();
    if (!file || !source) return;
    this.error.set(null);
    this.preview.set(null);
    if (file.size > 250 * 1024 * 1024) {
      this.stage.set('error');
      this.error.set('too_large');
      input.value = '';
      return;
    }
    this.stage.set('reading');
    try {
      const buffer = await file.arrayBuffer();
      const preview = await this._client.parse(source, buffer, (stage) =>
        this.stage.set(stage),
      );
      this.preview.set(preview);
      this._analytics.track('import_previewed', { source });
      this.selected.set(new Set(preview.conversations.map((_, index) => index)));
      this.stage.set('parsed');
    } catch (error) {
      if (error instanceof Error && error.message === 'cancelled') {
        this.stage.set('idle');
        return;
      }
      this.stage.set('error');
      this.error.set(this.failureReason(error));
    } finally {
      input.value = '';
    }
  }

  toggleConversation(index: number, checked: boolean): void {
    this.selected.update((current) => {
      const next = new Set(current);
      if (checked) next.add(index);
      else next.delete(index);
      return next;
    });
  }

  async importSelected(): Promise<void> {
    const preview = this.preview();
    const source = this.source();
    if (!preview || !source || this.selected().size === 0) return;
    this.stage.set('encrypting');
    try {
      const chosen = preview.conversations.filter((_, index) =>
        this.selected().has(index),
      );
      const imported = [];
      for (const conversation of chosen) {
        imported.push(await this._persistence.persist(source, conversation));
      }
      this.preview.set(null);
      this.stage.set('complete');
      this._analytics.track('import_completed', { source });
      if (imported[0]) {
        await this._router.navigate(['/c', imported[0].record.id]);
      }
    } catch {
      this.stage.set('error');
      this.error.set('persistence_failed');
    }
  }

  errorText(): string {
    return this._transloco.translate(
      `adoption.import.errors.${this.error() ?? 'unsupported_schema'}`,
    );
  }

  cancel(): void {
    this._client.cancel();
    this.preview.set(null);
    this.error.set(null);
    this.stage.set('idle');
    this.selected.set(new Set());
  }

  private failureReason(error: unknown): ImportFailureReason {
    const reason = error instanceof Error ? error.message : '';
    return ['invalid_json', 'unsupported_schema', 'too_large', 'too_deep'].includes(
      reason,
    )
      ? (reason as ImportFailureReason)
      : 'unsupported_schema';
  }
}
