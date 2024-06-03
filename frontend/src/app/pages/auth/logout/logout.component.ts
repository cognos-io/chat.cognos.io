import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

import { AuthService } from '@app/services/auth.service';

@Component({
  selector: 'app-logout',
  standalone: true,
  imports: [],
  template: ``,
  styles: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LogoutComponent implements OnInit {
  private readonly _authService = inject(AuthService);
  private readonly _router = inject(Router);

  constructor() {
    this._authService.user$.pipe(takeUntilDestroyed()).subscribe((user) => {
      if (!user) this._router.navigate(['/auth/login']);
    });
  }

  ngOnInit(): void {
    this._authService.logout$.next(true);
  }
}
