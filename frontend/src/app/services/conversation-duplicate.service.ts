import { Dialog } from '@angular/cdk/dialog';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';

import { CognosToastService } from '@cognos/ui-angular';

import { DuplicatingDialogComponent } from '@app/components/duplicating-dialog/duplicating-dialog.component';
import { Conversation } from '@app/interfaces/conversation';
import { cognosDialogOptions } from '@app/utils/dialog-options';

import { Analytics } from './analytics/analytics';
import {
  CannotDuplicateAttachmentsError,
  CannotDuplicateProjectError,
  ConversationCopyService,
  ConversationTooLargeError,
} from './conversation-copy.service';

/**
 * ConversationDuplicateService is the UI orchestration around
 * ConversationCopyService: it owns the blocking loading dialog, the
 * keep-tab-open `beforeunload` guard, the success/error toasts, and navigation
 * to the duplicate. Both the sidebar item menu and the chat header menu call
 * `duplicate()` so the UX stays identical and lives in one place.
 */
@Injectable({ providedIn: 'root' })
export class ConversationDuplicateService {
  private readonly _copy = inject(ConversationCopyService);
  private readonly _dialog = inject(Dialog);
  private readonly _toast = inject(CognosToastService);
  private readonly _transloco = inject(TranslocoService);
  private readonly _router = inject(Router);
  private readonly _analytics = inject(Analytics);

  // Source conversation ids with an in-flight duplicate. Tracked as a set so
  // concurrent duplicates of different chats each disable only their own action.
  private readonly _inProgress = signal<ReadonlySet<string>>(new Set());

  /** True while any duplicate is running (e.g. to disable global affordances). */
  readonly isDuplicating = computed(() => this._inProgress().size > 0);

  /** True while the given source conversation specifically is being duplicated. */
  isDuplicatingSource(conversationId: string): boolean {
    return this._inProgress().has(conversationId);
  }

  /**
   * duplicate runs the full UX: show the blocking dialog + unload guard, copy,
   * then either navigate to the duplicate (success toast) or surface a
   * translated error and leave the user where they are. Never rejects — the
   * outcome is communicated through toasts/navigation.
   */
  async duplicate(source: Conversation): Promise<void> {
    const sourceId = source.record.id;
    if (this._inProgress().has(sourceId)) {
      return; // Already running for this source — ignore the repeat trigger.
    }
    this.markInProgress(sourceId, true);

    const dialogRef = this._dialog.open(DuplicatingDialogComponent, {
      ...cognosDialogOptions,
      disableClose: true,
    });
    // Best-effort guardrail: browsers may show a generic prompt only. It
    // discourages a reload/close while local re-encryption + upload are mid
    // flight (no backend state exists until the request commits).
    const unloadGuard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', unloadGuard);

    try {
      const duplicate = await this._copy.duplicate(source, this.duplicateTitle(source));
      // v1 scope validation — no conversation identifiers attached.
      this._analytics.track('conversation_duplicated');
      this._toast.notify({
        title: this._transloco.translate('chat.toasts.duplicated'),
      });
      await this._router.navigate(['/c', duplicate.record.id]);
    } catch (error) {
      this._toast.notify({
        title: this.errorTitle(error),
        tone: 'danger',
      });
    } finally {
      window.removeEventListener('beforeunload', unloadGuard);
      dialogRef.close();
      this.markInProgress(sourceId, false);
    }
  }

  // duplicateTitle appends the localized "(copy)" suffix, falling back to the
  // empty title (the sidebar renders its own placeholder) when the source has
  // no decryptable title.
  private duplicateTitle(source: Conversation): string {
    const base = (source.decryptedData.title ?? '').trim();
    if (!base) {
      return '';
    }
    return `${base} ${this._transloco.translate('chat.copy.titleSuffix')}`;
  }

  // errorTitle maps the typed fail-closed errors to specific, actionable copy
  // and everything else to the generic failure message (which must never leak
  // conversation content).
  private errorTitle(error: unknown): string {
    if (error === CannotDuplicateAttachmentsError) {
      return this._transloco.translate('chat.toasts.duplicateAttachments');
    }
    if (error === ConversationTooLargeError) {
      return this._transloco.translate('chat.toasts.duplicateTooLarge');
    }
    if (error === CannotDuplicateProjectError) {
      return this._transloco.translate('chat.toasts.duplicateProject');
    }
    return this._transloco.translate('chat.toasts.duplicateError');
  }

  private markInProgress(conversationId: string, running: boolean): void {
    this._inProgress.update((current) => {
      const next = new Set(current);
      if (running) {
        next.add(conversationId);
      } else {
        next.delete(conversationId);
      }
      return next;
    });
  }
}
