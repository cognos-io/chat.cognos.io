import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';

import { EMPTY, catchError, finalize } from 'rxjs';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosDialogActionsComponent,
  CognosDialogSurfaceComponent,
  CognosSegmentedControlComponent,
  type CognosSegmentedOption,
  CognosToastService,
} from '@cognos/ui-angular';

import { ConversationService } from '@app/services/conversation.service';
import { ErrorService } from '@app/services/error.service';
import {
  CONVERSATION_RETENTION_OPTIONS,
  normalizeConversationRetention,
  parseRetentionSegmentValue,
  retentionSegmentValue,
} from '@app/utils/retention';

// RetentionDialogComponent lets the user set a per-conversation auto-delete
// window that overrides (or inherits) their account default. It patches through
// the dedicated retention endpoint and never touches the conversation's
// activity timestamps.
@Component({
  selector: 'app-retention-dialog',
  standalone: true,
  imports: [
    CognosDialogSurfaceComponent,
    CognosDialogActionsComponent,
    CognosSegmentedControlComponent,
    CognosButtonComponent,
    TranslocoModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <cog-dialog-surface
      *transloco="let t"
      [title]="t('dialogs.retention.title')"
      [closeLabel]="t('common.close')"
      [footer]="true"
      [width]="480"
      (close)="close()"
    >
      <div class="retention-dialog">
        <p class="retention-dialog__body">{{ t('dialogs.retention.body') }}</p>

        <cog-segmented-control
          [options]="options(t)"
          [value]="selected()"
          [ariaLabel]="t('dialogs.retention.title')"
          (select)="selected.set($event)"
        />

        <p class="retention-dialog__note" role="note">
          {{ t('dialogs.retention.note') }}
        </p>
      </div>

      <cog-dialog-actions cogDialogFooter>
        <cog-button appearance="subtle" [disabled]="saving()" (click)="close()">{{
          t('common.cancel')
        }}</cog-button>
        <cog-button appearance="primary" [disabled]="saving()" (click)="save()">
          {{ saving() ? t('dialogs.retention.saving') : t('dialogs.retention.save') }}
        </cog-button>
      </cog-dialog-actions>
    </cog-dialog-surface>
  `,
  styles: `
    .retention-dialog {
      display: grid;
      gap: var(--cog-space-200);
    }

    .retention-dialog__body {
      margin: 0;
      color: var(--cog-text);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
      text-wrap: pretty;
    }

    .retention-dialog__note {
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
      text-wrap: pretty;
    }
  `,
})
export class RetentionDialogComponent {
  private readonly _dialogRef = inject(DialogRef<void>);
  private readonly _conversationService = inject(ConversationService);
  private readonly _transloco = inject(TranslocoService);
  private readonly _toast = inject(CognosToastService);
  private readonly _errorService = inject(ErrorService);

  readonly data: { conversationId: string } = inject(DIALOG_DATA);

  private readonly _initial = normalizeConversationRetention(
    this._conversationService.getConversation(this.data.conversationId)()?.record
      .retention_days,
  );

  protected readonly selected = signal(retentionSegmentValue(this._initial));
  protected readonly saving = signal(false);

  protected options(t: (key: string) => string): CognosSegmentedOption[] {
    return CONVERSATION_RETENTION_OPTIONS.map((option) => ({
      value: retentionSegmentValue(option.days),
      label: t('dialogs.retention.options.' + option.labelKey),
    }));
  }

  protected close(): void {
    this._dialogRef.close();
  }

  protected save(): void {
    if (this.saving()) {
      return;
    }

    const days = parseRetentionSegmentValue(this.selected());
    if (days === this._initial) {
      this._dialogRef.close();
      return;
    }

    this.saving.set(true);
    this._conversationService
      .setConversationRetention(this.data.conversationId, days)
      .pipe(
        finalize(() => this.saving.set(false)),
        catchError(() => {
          this._errorService.alert(
            this._transloco.translate('dialogs.retention.error'),
          );
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this._toast.notify({
          title: this._transloco.translate('dialogs.retention.saved'),
        });
        this._dialogRef.close();
      });
  }
}
