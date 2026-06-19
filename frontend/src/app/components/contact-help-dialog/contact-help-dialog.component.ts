import { DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

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
    TranslocoModule,
  ],
  template: `
    <cog-dialog-surface
      *transloco="let t"
      [title]="t('dialogs.contactHelp.title')"
      [footer]="true"
      (close)="close()"
    >
      <div class="contact-help-dialog">
        <div class="contact-help-dialog__copy">
          <p>
            {{ t('dialogs.contactHelp.introBefore') }}
            <a
              href="https://www.linkedin.com/in/egjones/"
              rel="noopener noreferrer"
              target="_blank"
              >Ewan</a
            >
            {{ t('dialogs.contactHelp.introAfter') }}
          </p>

          <ul>
            <li>
              {{ t('dialogs.contactHelp.emailLabel') }}
              <a href="mailto:ewan@cognos.io">ewan&#64;cognos.io</a>
            </li>
            <li>
              {{ t('dialogs.contactHelp.threemaLabel') }}
              <a
                href="https://threema.id/NM4AVD9N"
                rel="noopener noreferrer"
                target="_blank"
                >NM4AVD9N</a
              >
            </li>
          </ul>

          <p>{{ t('dialogs.contactHelp.outro') }}</p>
          <p>{{ t('dialogs.contactHelp.thanks') }}</p>
        </div>

        <div class="contact-help-dialog__image">
          <app-profile-picture
            profileName="Ewan Jones"
            profilePicturePath="assets/img/profile/profile_ewan--square.jpg"
          ></app-profile-picture>
        </div>
      </div>

      <div cogDialogFooter>
        <cog-button appearance="primary" (click)="close()">{{
          t('dialogs.contactHelp.done')
        }}</cog-button>
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
