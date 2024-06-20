import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-feature-bento',
  standalone: true,
  imports: [],
  template: ` <p>feature-bento works!</p> `,
  styles: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeatureBentoComponent {}
