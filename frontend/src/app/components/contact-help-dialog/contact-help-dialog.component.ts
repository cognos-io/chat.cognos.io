import { DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import {
  CognosButtonComponent,
  CognosDialogSurfaceComponent,
} from '@cognos/ui-angular';

import { ProfilePictureComponent } from '../team/profile-picture/profile-picture.component';

@Component({
  selector: 'app-contact-help-dialog',
  standalone: true,
  imports: [
    CognosDialogSurfaceComponent,
    CognosButtonComponent,
    ProfilePictureComponent,
  ],
  template: `
    <cog-dialog-surface
      title="Need help? Want to contact me?"
      [footer]="true"
      (close)="close()"
    >
      <div class="contact-help-dialog">
        <div class="contact-help-dialog__copy">
          <p>
            If you are having problems, you can contact me —
            <a
              href="https://www.linkedin.com/in/egjones/"
              rel="noopener noreferrer"
              target="_blank"
              >Ewan</a
            >
            — the founder, for direct support.
          </p>

          <ul>
            <li>
              Email:
              <a href="mailto:ewan@cognos.io">ewan&#64;cognos.io</a>
            </li>
            <li>
              Threema:
              <a
                href="https://threema.id/NM4AVD9N"
                rel="noopener noreferrer"
                target="_blank"
                >NM4AVD9N</a
              >
            </li>
          </ul>

          <p>
            Let me know what you're having trouble with and I will be happy to help make
            it better with you.
          </p>
          <p>Thank you for using Cognos.</p>
        </div>

        <div class="contact-help-dialog__image">
          <app-profile-picture
            profileName="Ewan Jones"
            profilePicturePath="assets/img/profile/profile_ewan--square.jpg"
          ></app-profile-picture>
        </div>
      </div>

      <div cogDialogFooter>
        <cog-button appearance="primary" (click)="close()">Done</cog-button>
      </div>
    </cog-dialog-surface>
  `,
  styles: `
    .contact-help-dialog {
      display: grid;
      gap: var(--cog-space-200);
    }

    .contact-help-dialog__copy {
      color: var(--cog-text);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
      text-wrap: pretty;
    }

    .contact-help-dialog__copy p,
    .contact-help-dialog__copy ul {
      margin: 0 0 var(--cog-space-150);
    }

    .contact-help-dialog__copy ul {
      padding-inline-start: var(--cog-space-250);
    }

    .contact-help-dialog__copy a {
      color: var(--cog-link);
    }

    .contact-help-dialog__image {
      width: min(160px, 100%);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContactHelpDialogComponent {
  private readonly _dialogRef = inject(DialogRef<void>);

  close() {
    this._dialogRef.close();
  }
}
