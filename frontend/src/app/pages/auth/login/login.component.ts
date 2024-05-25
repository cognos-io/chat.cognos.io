import { Component, OnInit, computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

import { filterNil } from 'ngxtension/filter-nil';

import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [],
  template: `
    <p>If you are not automatically redirected, please click below to login:</p>
    <button (click)="authService.login$.next(true)" [disabled]="loading()">
      Log in to Cognos
    </button>
  `,
  styles: [],
})
export class LoginComponent implements OnInit {
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

  ngOnInit(): void {
    // Try to log in as soon as we can
    this.authService.login$.next(true);
  }
}
