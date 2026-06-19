import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { LanguageSwitcherComponent } from '@app/components/language-switcher/language-switcher.component';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [RouterOutlet, LanguageSwitcherComponent],
  templateUrl: './auth.component.html',
  styles: [
    `
      .auth-shell {
        position: relative;
        min-height: 100vh;
        min-height: 100svh;
      }

      .auth-shell__lang {
        position: fixed;
        top: var(--cog-space-200);
        right: var(--cog-space-200);
        z-index: 60;
      }

      @media (max-width: 640px) {
        .auth-shell__lang {
          top: calc(env(safe-area-inset-top, 0px) + var(--cog-space-150));
          right: var(--cog-space-150);
        }
      }
    `,
  ],
})
export class AuthComponent {}
