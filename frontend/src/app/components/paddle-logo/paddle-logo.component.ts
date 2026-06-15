import { ChangeDetectionStrategy, Component, input } from '@angular/core';

// PaddleLogoComponent renders the Paddle brand mark inline (a dark rounded
// square with the yellow ascending triangle), used wherever we credit Paddle as
// the merchant of record.
@Component({
  selector: 'app-paddle-logo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 16 16"
      role="img"
      aria-label="Paddle"
      class="paddle-logo"
    >
      <rect width="16" height="16" rx="4" fill="#0A0A1E" />
      <path d="M4.5 11.5 L11.5 11.5 L11.5 4.5 Z" fill="#FFD43B" />
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      line-height: 0;
    }
    .paddle-logo {
      display: block;
    }
  `,
})
export class PaddleLogoComponent {
  readonly size = input(16);
}
