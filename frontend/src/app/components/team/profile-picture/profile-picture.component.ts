import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

@Component({
  selector: 'app-profile-picture',
  standalone: true,
  imports: [NgOptimizedImage, TranslocoModule],
  template: ` <img
    class="rounded-lg  shadow-xl"
    width="160"
    height="160"
    [ngSrc]="profilePicturePath"
    [alt]="_transloco.translate('dialogs.profilePicture.alt', { name: profileName })"
  />`,
  styles: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfilePictureComponent {
  readonly _transloco = inject(TranslocoService);

  @Input({ required: true }) profilePicturePath: string = '';
  @Input({ required: true }) profileName: string = '';
}
