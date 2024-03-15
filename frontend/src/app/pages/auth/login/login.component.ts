import { Component, computed, inject } from '@angular/core';

import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [],
  template: `
    <button (click)="authService.login$.next($event)" [disabled]="loading()">
      Log in to Cognos
    </button>
  `,
  styles: [],
})
export class LoginComponent {
  readonly authService: AuthService = inject(AuthService);

  loading = computed(() => this.authService.status() === 'authenticating');
}
