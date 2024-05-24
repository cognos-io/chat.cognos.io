import { Component, computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

import { filterNil } from 'ngxtension/filter-nil';

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
  private readonly _router: Router = inject(Router);

  loading = computed(() => this.authService.status() === 'authenticating');

  constructor() {
    this.authService.user$.pipe(takeUntilDestroyed(), filterNil()).subscribe((user) => {
      if (user) {
        this._router.navigate(['/']);
      }
    });
  }
}
