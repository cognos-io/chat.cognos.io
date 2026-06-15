import { Dialog } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { Router } from '@angular/router';

import { CognosButtonComponent, CognosToastService } from '@cognos/ui-angular';

import { ContactHelpDialogComponent } from '@app/components/contact-help-dialog/contact-help-dialog.component';
import { VaultService } from '@app/services/vault.service';
import { cognosDialogOptions } from '@app/utils/dialog-options';

// SidebarAccountActionsComponent is the shared Help / Lock / Log out row used in
// both the chat and settings shell footers. Keeping it in one component means
// the buttons, spacing and behaviour stay identical across shells.
@Component({
  selector: 'app-sidebar-account-actions',
  standalone: true,
  imports: [CognosButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="account-actions">
      <cog-button appearance="subtle" type="button" (click)="onOpenHelpDialog()">
        Help
      </cog-button>
      <cog-button
        appearance="subtle"
        icon="lock"
        title="Locks your account and does not log you out."
        type="button"
        (click)="onLock()"
      >
        Lock
      </cog-button>
      <cog-button appearance="subtle" type="button" (click)="onLogout()">
        Log out
      </cog-button>
    </div>
  `,
  styles: `
    .account-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--cog-space-050);
    }
  `,
})
export class SidebarAccountActionsComponent {
  private readonly _dialog = inject(Dialog);
  private readonly _vaultService = inject(VaultService);
  private readonly _toastService = inject(CognosToastService);
  private readonly _router = inject(Router);

  /** Emitted after an action runs, so a host can close its mobile drawer. */
  readonly actioned = output<void>();

  protected onOpenHelpDialog(): void {
    this._dialog.open(ContactHelpDialogComponent, cognosDialogOptions);
    this.actioned.emit();
  }

  protected onLock(): void {
    this._vaultService.lock();
    this._toastService.notify({
      title: 'Account locked',
      msg: 'This device now needs your password and Account Key to unlock again.',
      tone: 'info',
      icon: 'lock',
      duration: 4200,
    });
    this.actioned.emit();
  }

  protected onLogout(): void {
    void this._router.navigate(['', 'auth', 'logout']);
    this.actioned.emit();
  }
}
