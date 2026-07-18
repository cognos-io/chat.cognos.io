import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosCardComponent,
  CognosFieldComponent,
  CognosTextFieldComponent,
  CognosToastService,
} from '@cognos/ui-angular';

import { OrganisationRecord } from '@app/interfaces/organisation';
import { CognosApiService } from '@app/services/cognos-api.service';
import { ErrorService } from '@app/services/error.service';

// OrgGeneralComponent holds organisation-level settings: rename now,
// dissolution later (spec §8.3 — deliberately not built in this slice; the
// disabled control plus hint copy keeps the eventual location discoverable
// without pretending it works).
@Component({
  selector: 'app-org-general',
  standalone: true,
  imports: [
    CognosButtonComponent,
    CognosCardComponent,
    CognosFieldComponent,
    CognosTextFieldComponent,
    TranslocoModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <cog-card [heading]="t('team.settings.heading')">
        <form class="org-general__form" (submit)="save($event)">
          <cog-field [label]="t('team.settings.nameLabel')">
            <cog-text-field
              [value]="name()"
              (valueChange)="name.set($event)"
              [ariaLabel]="t('team.settings.nameLabel')"
            />
          </cog-field>
          <div>
            <cog-button
              appearance="primary"
              type="submit"
              [disabled]="savePending() || !canSave()"
              >{{ t('team.settings.save') }}</cog-button
            >
          </div>
        </form>
      </cog-card>

      <cog-card tone="danger" [heading]="t('team.settings.dangerHeading')">
        <p class="org-general__danger-body">{{ t('team.settings.dangerBody') }}</p>
        <p class="org-general__danger-hint">{{ t('team.settings.dangerHint') }}</p>
        <cog-button
          card-actions
          appearance="danger"
          [disabled]="true"
          [title]="t('team.settings.dangerHint')"
          >{{ t('team.settings.dangerCta') }}</cog-button
        >
      </cog-card>
    </ng-container>
  `,
  styles: `
    .org-general__form {
      display: flex;
      flex-direction: column;
      gap: var(--cog-space-150);
      max-width: 480px;
    }

    .org-general__danger-body,
    .org-general__danger-hint {
      margin: 0;
      color: var(--cog-text);
      font-size: var(--cog-fs-body);
    }

    .org-general__danger-hint {
      color: var(--cog-text-muted);
      font-size: var(--cog-fs-small);
    }
  `,
})
export class OrgGeneralComponent {
  private readonly _api = inject(CognosApiService);
  private readonly _toast = inject(CognosToastService);
  private readonly _errors = inject(ErrorService);
  private readonly _transloco = inject(TranslocoService);
  private readonly _destroyRef = inject(DestroyRef);

  /** The Organisation being managed (caller is Owner/Admin). */
  readonly org = input.required<OrganisationRecord>();

  /** Emits the updated record after a successful rename. */
  readonly renamed = output<OrganisationRecord>();

  // Editable copy of the name; resets whenever the managed org changes.
  protected readonly name = linkedSignal(() => this.org().name);
  protected readonly savePending = signal(false);

  protected canSave(): boolean {
    const name = this.name().trim();
    return name.length > 0 && name !== this.org().name;
  }

  protected save(event?: Event): void {
    event?.preventDefault();
    if (this.savePending() || !this.canSave()) {
      return;
    }
    this.savePending.set(true);
    this._api
      .updateOrg(this.org().id, { name: this.name().trim() })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (record) => {
          this.savePending.set(false);
          // Announced via the toast host's aria-live status region.
          this._toast.notify({
            title: this._transloco.translate('team.settings.saved'),
            tone: 'success',
          });
          this.renamed.emit(record);
        },
        error: () => {
          this.savePending.set(false);
          this._errors.alert(this._transloco.translate('team.settings.saveError'));
        },
      });
  }
}
