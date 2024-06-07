import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatDialogContent, MatDialogTitle } from '@angular/material/dialog';

import { ProfilePictureComponent } from '../team/profile-picture/profile-picture.component';

@Component({
  selector: 'app-contact-help-dialog',
  standalone: true,
  imports: [MatDialogTitle, MatDialogContent, ProfilePictureComponent],
  template: `<h2 mat-dialog-title class="text-balance">
      Need help? Want to contact me?
    </h2>
    <mat-dialog-content>
      <div class="prose text-balance">
        <p>
          If you are having problems, you can contact me -
          <a
            href="https://www.linkedin.com/in/egjones/"
            target="_blank"
            rel="noreferrer"
            >Ewan</a
          >
          the founder - to get direct, personalized support.
        </p>
        <ul>
          <li>
            Email me:
            <a class="underline" href="mailto:ewan@cognos.io">ewan&#64;cognos.io</a>
          </li>
          <li>
            Contact me on Threema:
            <a
              class="underline"
              target="_blank"
              rel="noreferrer"
              href="https://threema.id/NM4AVD9N"
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
      <div class="mt-2 size-24 lg:size-40">
        <app-profile-picture
          profileName="Ewan Jones"
          profilePicturePath="assets/img/profile/profile_ewan--square.jpg"
        ></app-profile-picture>
      </div>
    </mat-dialog-content>`,
  styles: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContactHelpDialogComponent {}
