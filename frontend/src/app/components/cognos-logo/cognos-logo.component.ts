import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-cognos-logo',
  standalone: true,
  templateUrl: `./cognos_logo--horizontal.svg`,
  styles: `
    :host {
      display: block;
      color: var(--cog-logo);
    }

    .cognos-logo__svg {
      display: block;
      width: 100%;
      height: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CognosLogoComponent {}
