import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Injectable({
  providedIn: 'root',
})
export class DeviceService {
  private readonly breakpointObserver = inject(BreakpointObserver);

  public readonly isMobile = signal(false);

  constructor() {
    this.breakpointObserver
      .observe([Breakpoints.Handset])
      .pipe(takeUntilDestroyed())
      .subscribe((result) => this.isMobile.set(result.matches));
  }
}
