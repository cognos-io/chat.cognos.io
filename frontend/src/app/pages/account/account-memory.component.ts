import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';

import { EMPTY, catchError, finalize, forkJoin } from 'rxjs';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosCardComponent,
  CognosIconComponent,
  CognosToastService,
} from '@cognos/ui-angular';

import { SettingsPageComponent } from '@app/components/settings/settings-page.component';
import { CompactionDurableMemory } from '@app/interfaces/compaction';
import { RedactionEntry } from '@app/redaction';
import { RedactionService } from '@app/services/redaction.service';
import { ScopedMemoryService } from '@app/services/scoped-memory.service';
import { UserPreferencesService } from '@app/services/user-preferences.service';
import { VaultService } from '@app/services/vault.service';

// AccountMemoryComponent is the settings page for the user's personal memory
// (spec §16): the facts/decisions/open-threads pinned to "user" scope, which are
// injected into every chat. Encrypted client-side and sealed to the user's vault
// key; redaction is honoured both ways (hydrate for display, re-redact on save).
@Component({
  selector: 'app-account-memory',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    CognosButtonComponent,
    CognosIconComponent,
    TranslocoModule,
    SettingsPageComponent,
    CognosCardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <app-settings-page
        [heading]="t('account.memory.title')"
        [subtitle]="t('account.memory.subtitle')"
      >
        <cog-card>
          @if (!memoryEnabled()) {
            <p class="memory-page__redaction-info" role="status">
              <cog-icon name="info" [size]="14" tone="current" />
              {{ t('account.memory.editorDisabledNote') }}
            </p>
          }
          @if (redactionEnabled()) {
            <p class="memory-page__redaction-info">
              <cog-icon name="shield-check" [size]="14" tone="current" />
              {{ t('chat.memory.redactionInfo') }}
            </p>
          }

          <form [formGroup]="form" class="memory-page__form">
            <div class="memory-page__field">
              <label for="user-memory-items">{{ t('chat.memory.items') }}</label>
              <textarea
                id="user-memory-items"
                rows="10"
                formControlName="items"
                [placeholder]="t('chat.memory.linePlaceholder')"
              ></textarea>
              @if (itemsRedactions().length > 0) {
                <p class="memory-page__redacted-note">
                  <span>{{ t('chat.memory.redactedNote') }}</span>
                  @for (value of itemsRedactions(); track value) {
                    <mark>{{ value }}</mark>
                  }
                </p>
              }
            </div>
          </form>

          <div card-actions class="memory-page__actions">
            <cog-button
              appearance="danger"
              icon="eraser"
              [disabled]="deleting() || !hasStoredMemory()"
              (click)="clear()"
            >
              {{
                deleting() ? t('account.memory.deleting') : t('account.memory.delete')
              }}
            </cog-button>
            <cog-button
              appearance="primary"
              [disabled]="saving() || !memoryEnabled()"
              (click)="save()"
            >
              {{ t('account.memory.save') }}
            </cog-button>
          </div>
        </cog-card>

        <cog-card>
          <section class="memory-page__allowlist">
            <header class="memory-page__allowlist-head">
              <h2>{{ t('account.memory.allowlist.title') }}</h2>
              <p>{{ t('account.memory.allowlist.subtitle') }}</p>
            </header>

            @if (allowlistedValues().length > 0) {
              <ul class="memory-page__allowlist-list">
                @for (item of allowlistedValues(); track item.token) {
                  <li class="memory-page__allowlist-item">
                    <span>
                      <strong>{{ item.value }}</strong>
                      <small>{{
                        t('chat.composer.redaction.types.' + item.type)
                      }}</small>
                    </span>
                    <cog-button
                      appearance="subtle"
                      icon="rotate-cw"
                      [disabled]="removingAllowlistToken() === item.token"
                      (click)="removeAllowlist(item.token)"
                    >
                      {{ t('account.memory.allowlist.redactAgain') }}
                    </cog-button>
                  </li>
                }
              </ul>
            } @else {
              <p class="memory-page__empty">
                {{ t('account.memory.allowlist.empty') }}
              </p>
            }
          </section>
        </cog-card>
      </app-settings-page>
    </ng-container>
  `,
  styles: `
    .memory-page__redaction-info {
      display: flex;
      align-items: center;
      gap: var(--cog-space-050);
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
    }

    .memory-page__form {
      display: grid;
      gap: var(--cog-space-200);
    }

    .memory-page__field {
      display: grid;
      gap: var(--cog-space-100);
    }

    .memory-page__field label,
    .memory-page__readonly h2 {
      color: var(--cog-text);
      font-size: var(--cog-fs-h-sm);
      font-weight: var(--cog-fw-semibold);
    }

    .memory-page__field textarea {
      width: 100%;
      box-sizing: border-box;
      border: var(--cog-border-width-strong) solid var(--cog-border);
      border-radius: var(--cog-radius-sm);
      background: var(--cog-input-bg);
      color: var(--cog-text);
      padding: var(--cog-space-100) var(--cog-space-150);
      font: inherit;
      resize: vertical;
      outline: 0;
    }

    .memory-page__field textarea:focus {
      border-color: var(--cog-brand);
      background: var(--cog-input-bg-focus);
    }

    .memory-page__redacted-note {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--cog-space-050);
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
    }

    .memory-page__redacted-note mark {
      background: var(--cog-loz-purple-bg);
      color: var(--cog-text);
      border-radius: var(--cog-radius-xs);
      padding: 0 var(--cog-space-050);
    }

    .memory-page__readonly {
      display: grid;
      gap: var(--cog-space-100);
    }

    .memory-page__readonly h2 {
      margin: 0;
    }

    .memory-page__readonly ul {
      margin: 0;
      padding-left: var(--cog-space-200);
      display: grid;
      gap: var(--cog-space-050);
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body);
    }

    .memory-page__actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--cog-space-150);
      flex-wrap: wrap;
    }

    .memory-page__allowlist {
      display: grid;
      gap: var(--cog-space-150);
    }

    .memory-page__allowlist-head h2 {
      margin: 0;
      color: var(--cog-text);
      font-size: var(--cog-fs-h-sm);
      font-weight: var(--cog-fw-semibold);
    }

    .memory-page__allowlist-head p,
    .memory-page__empty {
      margin: var(--cog-space-050) 0 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body);
    }

    .memory-page__allowlist-list {
      display: grid;
      gap: var(--cog-space-075);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .memory-page__allowlist-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--cog-space-150);
      padding-block: var(--cog-space-075);
      border-block-start: var(--cog-border-width) solid var(--cog-border-subtle);
    }

    .memory-page__allowlist-item span {
      display: grid;
      min-width: 0;
      gap: var(--cog-space-025);
    }

    .memory-page__allowlist-item strong {
      overflow-wrap: anywhere;
      color: var(--cog-text);
      font-size: var(--cog-fs-body);
      font-weight: var(--cog-fw-semibold);
    }

    .memory-page__allowlist-item small {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
    }
  `,
})
export class AccountMemoryComponent {
  private readonly _scopedMemory = inject(ScopedMemoryService);
  private readonly _redaction = inject(RedactionService);
  private readonly _vault = inject(VaultService);
  private readonly _transloco = inject(TranslocoService);
  private readonly _toast = inject(CognosToastService);
  private readonly _preferences = inject(UserPreferencesService);

  // Guards the one-shot load so the unlock effect doesn't reload on every
  // vault state change.
  private _loaded = false;

  readonly saving = signal(false);
  readonly deleting = signal(false);
  readonly removingAllowlistToken = signal<string | null>(null);
  readonly redactionEnabled = this._redaction.enabled;
  readonly memoryEnabled = this._preferences.memoryEnabled;
  readonly allowlistedValues = computed(() => this._redaction.allowlistedValues());

  // Whether there is a stored memory record to clear. Reads the memory signal so
  // the Delete control enables/disables as memory is loaded, saved or cleared.
  readonly hasStoredMemory = computed(() => !!this._scopedMemory.userMemory());

  readonly form = new FormGroup({
    items: new FormControl('', { nonNullable: true }),
  });

  private readonly _items = toSignal(this.form.controls.items.valueChanges, {
    initialValue: '',
  });

  readonly itemsRedactions = computed(() => this.detectRedactions(this._items()));

  // The page can render before the vault is unlocked (the unlock gate prompts
  // over it), so wait for the user key pair before loading. Load the redaction
  // entries first so stored placeholders hydrate, then populate from the
  // decrypted user memory.
  private readonly _load = effect(() => {
    if (this._loaded || !this._vault.keyPair()) {
      return;
    }
    this._loaded = true;
    forkJoin([
      this._redaction.loadUserRedaction(),
      this._scopedMemory.loadUserMemory(),
    ]).subscribe({
      next: () => this.populate(),
      error: () => this.populate(),
    });
  });

  save(): void {
    if (this.saving()) {
      return;
    }
    // Re-redact the list against the user scope so no plaintext PII is stored.
    const newEntries: RedactionEntry[] = [];
    const items = this.redactList(this.fromTextarea(this.form.value.items), newEntries);

    if (newEntries.length > 0) {
      this._redaction
        .persistUserRedaction(newEntries)
        .subscribe({ error: () => undefined });
    }

    const durableMemory: CompactionDurableMemory = { items };

    this.saving.set(true);
    this._scopedMemory
      .saveUserMemory(durableMemory)
      .pipe(
        finalize(() => this.saving.set(false)),
        catchError(() => {
          this._toast.notify({
            title: this._transloco.translate('chat.memory.saveError'),
            tone: 'danger',
          });
          return EMPTY;
        }),
      )
      .subscribe(() =>
        this._toast.notify({
          title: this._transloco.translate('account.memory.saved'),
        }),
      );
  }

  // clear deletes the stored personal memory (server record + local cache) and
  // empties the editor. Available regardless of the opt-in toggle so a user can
  // always remove what was captured before.
  clear(): void {
    if (this.deleting() || !this.hasStoredMemory()) {
      return;
    }
    this.deleting.set(true);
    this._scopedMemory
      .deleteUserMemory()
      .pipe(
        finalize(() => this.deleting.set(false)),
        catchError(() => {
          this._toast.notify({
            title: this._transloco.translate('account.memory.deleteError'),
            tone: 'danger',
          });
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.form.setValue({ items: '' });
        this._toast.notify({
          title: this._transloco.translate('account.memory.deleted'),
        });
      });
  }

  removeAllowlist(token: string): void {
    if (this.removingAllowlistToken()) {
      return;
    }
    this.removingAllowlistToken.set(token);
    this._redaction
      .removeAllowlistedValue(token)
      .pipe(
        finalize(() => this.removingAllowlistToken.set(null)),
        catchError(() => {
          this._toast.notify({
            title: this._transloco.translate('account.memory.allowlist.deleteError'),
            tone: 'danger',
          });
          return EMPTY;
        }),
      )
      .subscribe(() =>
        this._toast.notify({
          title: this._transloco.translate('account.memory.allowlist.deleted'),
        }),
      );
  }

  private populate(): void {
    const memory = this._scopedMemory.userMemory()?.payload.durable_memory;
    this.form.setValue({ items: this.toTextarea(memory?.items ?? []) });
  }

  private hydrate(text: string): string {
    // User scope only: no conversation/project context on the settings page.
    return this._redaction.hydrate(null, text);
  }

  private toTextarea(items: string[]): string {
    return items.map((item) => this.hydrate(item)).join('\n');
  }

  private fromTextarea(value: string | undefined): string[] {
    return (value ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  private redactList(items: string[], newEntries: RedactionEntry[]): string[] {
    if (!this._redaction.enabled()) {
      return items;
    }
    return items.map((item) => {
      const { redactedText, newEntries: entries } =
        this._redaction.prepareUserRedaction(item);
      newEntries.push(...entries);
      return redactedText;
    });
  }

  private detectRedactions(text: string): string[] {
    if (!this._redaction.enabled() || !text) {
      return [];
    }
    const seen = new Set<string>();
    const values: string[] = [];
    for (const candidate of this._redaction.detect(text)) {
      const value = text.slice(candidate.start, candidate.end).trim();
      if (value && !seen.has(value)) {
        seen.add(value);
        values.push(value);
      }
    }
    return values;
  }
}
