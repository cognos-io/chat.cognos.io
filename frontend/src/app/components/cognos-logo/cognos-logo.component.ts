import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
  selector: 'app-cognos-logo',
  standalone: true,
  imports: [CommonModule],
  templateUrl: `./cognos_logo--horizontal.svg`,
  styles: `
    .cognos-logo__svg {
      display: block;
      width: 100%;
      height: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CognosLogoComponent {
  @Input() palette: 'dark' | 'light' = 'light';

  get color(): string {
    switch (this.palette) {
      case 'dark':
        return '#343434';
      case 'light':
        return '#EEF6E7';
    }
  }
}
