import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
  selector: 'app-profile-picture',
  standalone: true,
  imports: [NgOptimizedImage],
  template: ` <img
    class="rounded-lg  shadow-xl"
    width="160"
    height="160"
    [ngSrc]="profilePicturePath"
    [alt]="'Profile picture of ' + profileName"
  />`,
  styles: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfilePictureComponent {
  @Input({ required: true }) profilePicturePath: string = '';
  @Input({ required: true }) profileName: string = '';
}
