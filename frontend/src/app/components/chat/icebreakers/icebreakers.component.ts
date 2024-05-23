import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { Component, EventEmitter, Output, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { IceBreaker } from '@app/interfaces/ice-breaker';

const iceBreakers: IceBreaker[] = [
  {
    title: 'Future Tech Innovator',
    description: 'envisioning the next big technology innovation',
    prompt:
      "Imagine you're a tech innovator in the year 2040. Describe a groundbreaking technology you've invented, how it works, and its impact on society.",
  },
  {
    title: 'Environmental champion',
    description: 'designing a sustainable future for our planet',
    prompt:
      "You've been tasked with solving a pressing environmental issue in your community. What's the problem, and what's your plan to address it?",
  },
  {
    title: "Space explorer's journal",
    description: 'detail the chronicles of a space explorer in a distant galaxy',
    prompt:
      "You're a space explorer documenting your journey through a newly discovered galaxy. Describe your most fascinating discovery and how it changes our understanding of the universe.",
  },
  {
    title: 'Would You Rather',
    description: 'AI Edition',
    prompt: `I've got some AI-themed "Would You Rather" questions for you.
      Pick the scenario that sounds more appealing and explain your choice!  For example, would you rather have an AI that can perfectly mimic any human voice or one that can instantly translate any language?`,
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
  {
    title: 'Write the ultimate ',
    description: 'dinner party guest list',
    prompt: `You're throwing a dinner party and can invite any 5 historical or fictional characters (real or imagined!
    ).  Who would you choose and why?`,
  },
  {
    title: 'Plan a holiday',
    description: 'that I will never forget',
    prompt:
      'Imagine you have an unlimited budget for a two-week vacation. Where would you go, what would you do, and why? Outline your dream itinerary and explain your choices.',
  },
  {
    title: 'Create a time capsule',
    description: 'for future generations',
    prompt:
      'If you were to create a time capsule to be opened in 100 years, what five items would you put in it and why? Explain the significance of each item to future generations.',
  },
  {
    title: 'Rewrite history',
    description: 'to change the course of events',
    prompt: `Choose a historical event and re-imagine how it could have happened differently. Describe the event, your changes, and how history would change as a result.`,
  },
  {
    title: 'Describe a dream house',
    description: 'for my pet',
    prompt: `Design the ultimate pet paradise. Describe the facilities, the types of activities available for pets, and any special services your paradise would offer.`,
  },
  {
    title: 'Master chef challenge',
    description: 'with limited ingredients',
    prompt: `You're a contestant on a cooking show and must create a dish using only five ingredients. Choose your ingredients, describe the dish you would prepare, and explain the cooking process.`,
  },
  {
    title: 'Predict the future',
    description: 'of technical innovation',
    prompt: `Predict a technological innovation that will transform our lives in the next 50 years. Describe the technology, how it works, and its societal impacts.`,
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
