import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { Component, EventEmitter, Output, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

interface IceBreaker {
  title: string;
  description: string;
  prompt: string;
}

const iceBreakers: IceBreaker[] = [
  {
    title: 'Future Tech Innovator',
    description: 'envisioning the next big technology innovation',
    prompt:
      "Imagine you're a tech innovator in the year 2040. Describe a groundbreaking technology you've invented, how it works, and its impact on society.",
  },
  {
    title: 'Eco-Friendly Earth',
    description: 'designing a sustainable future for our planet',
    prompt:
      'Envision a future where Earth is completely eco-friendly. Describe three innovative changes or inventions that have helped achieve this sustainable lifestyle.',
  },
  {
    title: "Space explorer's journal",
    description: 'detail the chronicles of a space explorer in a distant galaxy',
    prompt:
      "You're a space explorer documenting your journey through a newly discovered galaxy. Describe your most fascinating discovery and how it changes our understanding of the universe.",
  },
  {
    title: 'The hidden talent show',
    description: 'to share and discover hidden talents',
    prompt:
      'Everyone has a hidden talent. Describe yours and how you discovered it. Alternatively, if you could instantly gain any talent, what would it be and why?',
  },
  {
    title: 'The Ultimate Playlist',
    description: 'Creating the perfect music playlist',
    prompt:
      "Compile the ultimate playlist for a road trip. Choose five songs, describe the mood they create, and why they're essential for your journey.",
  },
  {
    title: 'Be an Ethereum developer',
    description: 'optimized for smart contract development',
    prompt:
      'Imagine you are an experienced Ethereum developer tasked with creating a smart contract for a blockchain messenger. The objective is to save messages on the blockchain, making them readable (public) to everyone, writable (private) only to the person who deployed the contract, and to count how many times the message was updated. Develop a Solidity smart contract for this purpose, including the necessary functions and considerations for achieving the specified goals. Please provide the code and any relevant explanations to ensure a clear understanding of the implementation.',
  },
  {
    title: 'Help me recruit',
    description: 'a new member for my team',
    prompt:
      'I want you to act as a recruiter. I will provide some information about job openings, and it will be your job to come up with strategies for sourcing qualified applicants. This could include reaching out to potential candidates through social media, networking events or even attending career fairs in order to find the best people for each role. My first request is "I need help improve my CV.”',
  },
];

@Component({
  selector: 'app-icebreakers',
  standalone: true,
  imports: [],
  template: `<ul class="grid grid-cols-1 gap-4 lg:grid-cols-2">
    @for (ib of iceBreakers(); track ib) {
      <li
        class="border-1 col-span-1 rounded-lg bg-white shadow transition-all duration-150 ease-in-out hover:bg-slate-50"
      >
        <button
          class="prose rounded-lg px-6 py-4 text-left prose-headings:m-0"
          (click)="iceBreakerSelected.emit(ib)"
        >
          <h4>{{ ib.title }}</h4>
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

  @Output() iceBreakerSelected = new EventEmitter<IceBreaker>();

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
