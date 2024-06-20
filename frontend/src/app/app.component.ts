import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterOutlet } from '@angular/router';

import { Observable, fromEvent, interval, merge, repeat, takeUntil } from 'rxjs';

import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  title = 'frontend';

  public auth = inject(AuthService);

  private readonly _router = inject(Router);

  constructor() {
    const browserInactive$ = (graceTimeMs: number): Observable<number> => {
      const activityIndicatorEvents$ = merge(
        ...['click', 'mousemove', 'mousedown', 'scroll', 'keypress'].map((eventName) =>
          fromEvent(document, eventName),
        ),
      );

      return interval(graceTimeMs).pipe(takeUntil(activityIndicatorEvents$), repeat());
    };

    // Logout user after 30 mins of inactivity
    browserInactive$(30 * 60 * 1000)
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        if (this.auth.user()) {
          this._router.navigate(['', 'auth', 'logout']);
        }
      });
  }
}
