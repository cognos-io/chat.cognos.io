import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

export enum Height {
  Short,
  Medium,
  Tall,
}

const _heightBreakpoints = [
  { height: Height.Short, breakpoint: '(min-height: 480px)' },
  { height: Height.Medium, breakpoint: '(min-height: 960px)' },
  { height: Height.Tall, breakpoint: '(min-height: 1440px)' },
];

@Injectable({
  providedIn: 'root',
})
export class DeviceService {
  private readonly breakpointObserver = inject(BreakpointObserver);

  public readonly isMobile = signal(false);
  public readonly height = signal<Height>(Height.Short); // mobile first

  constructor() {
    this.breakpointObserver
      .observe([Breakpoints.Handset])
      .pipe(takeUntilDestroyed())
      .subscribe((result) => this.isMobile.set(result.matches));

    this.breakpointObserver
      .observe(_heightBreakpoints.map((hb) => hb.breakpoint))
      .pipe(takeUntilDestroyed())
      .subscribe((result) => {
        if (result.matches) {
          for (let i = 0; i < _heightBreakpoints.length; i++) {
            if (result.breakpoints[_heightBreakpoints[i].breakpoint]) {
              this.height.set(_heightBreakpoints[i].height);
            }
          }
        }
      });
  }
}
