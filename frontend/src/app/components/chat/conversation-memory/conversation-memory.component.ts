import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';

import { EMPTY, catchError, finalize } from 'rxjs';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosDialogSurfaceComponent,
  CognosIconComponent,
} from '@cognos/ui-angular';

import { Compaction, CompactionDurableMemory } from '@app/interfaces/compaction';
import { RedactionEntry } from '@app/redaction';
import { CompactionService } from '@app/services/compaction.service';
import { ConversationService } from '@app/services/conversation.service';
import { ErrorService } from '@app/services/error.service';
import { RedactionService } from '@app/services/redaction.service';

// ConversationMemoryComponent shows and edits the durable memory of a
// conversation's most recent compaction (spec §8.2). It is opened as a
// right-anchored drawer from the chat header, only when a compaction exists.
//
// Redaction is honoured both ways: stored placeholders are hydrated to their
// originals for the owner to read, and edited text is re-redacted (reusing
// existing token mappings) before it is re-encrypted and persisted, so no
// plaintext PII is ever written into the compaction.
@Component({
  selector: 'app-conversation-memory',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    CognosDialogSurfaceComponent,
    CognosButtonComponent,
    CognosIconComponent,
    TranslocoModule,
  ],
  templateUrl: './conversation-memory.component.html',
  styleUrl: './conversation-memory.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConversationMemoryComponent implements OnInit {
  private readonly _dialogRef = inject(DialogRef<void>);
  private readonly _transloco = inject(TranslocoService);
  private readonly _errorService = inject(ErrorService);
  private readonly _compactionService = inject(CompactionService);
  private readonly _redaction = inject(RedactionService);

  readonly conversationService = inject(ConversationService);
  readonly data: { conversationId: string } = inject(DIALOG_DATA);

  // The compaction being edited (the newest one for the conversation).
  private _compaction: Compaction | null = null;

  readonly saving = signal(false);
  // Read-only, hydrated context for the user.
  readonly narrative = signal('');
  readonly glossary = signal<{ term: string; note: string }[]>([]);
  // Whether anything is shown at all (a compaction exists).
  readonly hasMemory = signal(false);

  // Editable lists, one item per line, hydrated for display.
  readonly form = new FormGroup({
    facts: new FormControl('', { nonNullable: true }),
    decisions: new FormControl('', { nonNullable: true }),
    openThreads: new FormControl('', { nonNullable: true }),
  });

  // Whether PII redaction is on for this user — drives the "stored redacted"
  // affordances.
  readonly redactionEnabled = this._redaction.enabled;

  // Live field values, so the detection below recomputes as the user types.
  private readonly _factsValue = toSignal(this.form.controls.facts.valueChanges, {
    initialValue: '',
  });
  private readonly _decisionsValue = toSignal(
    this.form.controls.decisions.valueChanges,
    {
      initialValue: '',
    },
  );
  private readonly _openThreadsValue = toSignal(
    this.form.controls.openThreads.valueChanges,
    { initialValue: '' },
  );

  // Sensitive values detected in each field that will be stored redacted.
  readonly factsRedactions = computed(() => this.detectRedactions(this._factsValue()));
  readonly decisionsRedactions = computed(() =>
    this.detectRedactions(this._decisionsValue()),
  );
  readonly openThreadsRedactions = computed(() =>
    this.detectRedactions(this._openThreadsValue()),
  );

  ngOnInit(): void {
    const compaction = this.newestCompaction();
    if (!compaction) {
      return;
    }
    this._compaction = compaction;
    this.hasMemory.set(true);

    const memory = compaction.payload.durable_memory;
    this.form.setValue({
      facts: this.toTextarea(memory.facts),
      decisions: this.toTextarea(memory.decisions),
      openThreads: this.toTextarea(memory.open_threads),
    });
    this.narrative.set(this.hydrate(compaction.payload.rolling_narrative));
    this.glossary.set(
      memory.glossary.map((entry) => ({
        term: this.hydrate(entry.term),
        note: this.hydrate(entry.note),
      })),
    );
  }

  close(): void {
    this._dialogRef.close();
  }

  save(): void {
    const compaction = this._compaction;
    const conversation = this.conversationService.getConversation(
      this.data.conversationId,
    )();
    if (!compaction || !conversation || this.saving()) {
      return;
    }

    // Re-redact every edited list back into placeholders, collecting any new
    // token mappings to persist so they hydrate correctly next time.
    const newEntries: RedactionEntry[] = [];
    const facts = this.redactList(this.fromTextarea(this.form.value.facts), newEntries);
    const decisions = this.redactList(
      this.fromTextarea(this.form.value.decisions),
      newEntries,
    );
    const openThreads = this.redactList(
      this.fromTextarea(this.form.value.openThreads),
      newEntries,
    );

    const durableMemory: CompactionDurableMemory = {
      // Glossary stays as stored (already redacted); only the editable lists
      // change in V1.
      ...compaction.payload.durable_memory,
      facts,
      decisions,
      open_threads: openThreads,
    };

    if (newEntries.length > 0) {
      // Best-effort: the memory is already re-redacted before storage, so a
      // persistence failure costs hydration, not a leak.
      this._redaction
        .persist(conversation, newEntries, {
          kind: 'document',
          id: this.data.conversationId,
        })
        .subscribe({ error: () => undefined });
    }

    this.saving.set(true);
    this._compactionService
      .updateDurableMemory(compaction, durableMemory, conversation.keyPair)
      .pipe(
        finalize(() => this.saving.set(false)),
        catchError(() => {
          this._errorService.alert(this._transloco.translate('chat.memory.saveError'));
          return EMPTY;
        }),
      )
      .subscribe(() => this._dialogRef.close());
  }

  // Prefer the user-curated manual memory (the target of "Add to memory"); fall
  // back to the newest auto-compaction so the drawer still works for chats that
  // have only ever been auto-compacted.
  private newestCompaction(): Compaction | null {
    const manual = this._compactionService.manualMemoryFor(this.data.conversationId);
    if (manual) {
      return manual;
    }
    const compactions = this._compactionService.compactionsFor(
      this.data.conversationId,
    );
    if (compactions.length === 0) {
      return null;
    }
    return [...compactions].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )[0];
  }

  private hydrate(text: string): string {
    return this._redaction.hydrate(this.data.conversationId, text);
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

  // detectRedactions returns the distinct sensitive values in `text` that will be
  // stored redacted (empty when redaction is off). Values already written as
  // placeholders are not re-flagged.
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

  // redactList re-redacts each item (when redaction is enabled), reusing existing
  // token mappings and accumulating any new ones into `newEntries`.
  private redactList(items: string[], newEntries: RedactionEntry[]): string[] {
    if (!this._redaction.enabled()) {
      return items;
    }
    return items.map((item) => {
      const { redactedText, newEntries: entries } = this._redaction.prepareRedaction(
        this.data.conversationId,
        item,
      );
      newEntries.push(...entries);
      return redactedText;
    });
  }
}
