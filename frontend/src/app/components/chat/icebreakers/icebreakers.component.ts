import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

interface IceBreaker {
  title: string;
  description: string;
  prompt: string;
}

const iceBreakers: IceBreaker[] = [
  {
    title: 'Write a short story...',
    description: 'about a tiny dog navigating the big bad world of finance',
    prompt: 'about a tiny dog navigating the big bad world of finance',
  },
  {
    title: 'Write a short story...',
    description: 'about a tiny dog navigating the big bad world of finance',
    prompt: 'about a tiny dog navigating the big bad world of finance',
  },
  {
    title: 'Write a short story...',
    description: 'about a tiny dog navigating the big bad world of finance',
    prompt: 'about a tiny dog navigating the big bad world of finance',
  },
  {
    title: 'Write a short story...',
    description: 'about a tiny dog navigating the big bad world of finance',
    prompt: 'about a tiny dog navigating the big bad world of finance',
  },
];

@Component({
  selector: 'app-icebreakers',
  standalone: true,
  imports: [],
  template: `<ul class="grid grid-cols-1 gap-4 lg:grid-cols-2">
    @for (ib of iceBreakers(); track ib) {
      <li class="border-1 col-span-1 rounded-lg bg-white shadow">
        <button
          class="prose rounded-lg px-6 py-4 text-left"
          (click)="onIceBreakerClick(ib)"
        >
          <h2>{{ ib.title }}</h2>
          <p>{{ ib.description }}</p>
        </button>
      </li>
    }
  </ul>`,
  styles: ``,
})
export class IcebreakersComponent {
  public readonly iceBreakers = signal<IceBreaker[]>([]);
  private readonly _breakpointObserver = inject(BreakpointObserver);

  onIceBreakerClick(iceBreaker: IceBreaker) {
    console.log(iceBreaker.prompt);
  }

  constructor() {
    this._breakpointObserver
      .observe([Breakpoints.XSmall, Breakpoints.Small, Breakpoints.Medium])
      .pipe(takeUntilDestroyed())
      .subscribe((result) => {
        let iceBreakersLength = 4;
        if (result.matches) {
          iceBreakersLength = 2;
        }

        this.iceBreakers.set(getRandomSubset(iceBreakers, iceBreakersLength));
      });
  }
}

const getRandomSubset = <T>(arr: T[], count: number): T[] => {
  // Create a copy of the original array
  const copy = [...arr];

  // Shuffle the copied array
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  // Get the subset
  return copy.slice(0, count);
};
