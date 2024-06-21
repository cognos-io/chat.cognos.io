import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { DeviceService } from '@app/services/device.service';

interface FeatureBentoItem {
  title: string;
  description: {
    small: string; // small bento items
    medium: string; // medium bento items
  };
  color: string; // tailwind color
  icon: string; // bootstrap icon name
}

const featureBentoItems: FeatureBentoItem[] = [
  {
    title: 'Multi-model support',
    description: {
      small: 'Pick from a variety of AI models',
      medium: 'Use both proprietary and open-source AI models to get the best results',
    },
    color: 'blue',
    icon: 'bi-robot',
  },
  {
    title: 'No training on your data',
    description: {
      small: 'Keep your data private',
      medium: 'Your data can never be used to train future AI models',
    },
    color: 'teal',
    icon: 'bi-ban',
  },
  {
    title: 'Messages encrypted',
    description: {
      small: 'Secure & private',
      medium: 'Using strong encryption to keep your data secure & private',
    },
    color: 'violet',
    icon: 'bi-shield-fill-check',
  },
  {
    title: 'No risk of leaks',
    description: {
      small: 'Only you can see your data',
      medium:
        'Only you can access your data. Without your permission, no one can access it',
    },
    color: 'blue',
    icon: 'bi-eye-slash-fill',
  },
  {
    title: 'Incognito conversations',
    description: {
      small: 'Chats never saved',
      medium: 'Option to enter incognito mode where your chats are never saved',
    },
    color: 'teal',
    icon: 'bi-incognito',
  },
  {
    title: 'Auto account lock',
    description: {
      small: 'Log out after inactivity',
      medium: 'Protect your data by auto logging out after inactivity',
    },
    color: 'violet',
    icon: 'bi-key-fill',
  },
];

@Component({
  selector: 'app-feature-bento',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `<div class="grid grid-cols-1 gap-3 md:grid-cols-3 lg:gap-8">
    @for (bentoItem of bentoItems(); track bentoItem.title; let index = $index) {
      <div
        class="flex h-full flex-col justify-between gap-3 rounded-lg border border-opacity-30 bg-slate-50/40 p-3 backdrop-blur-2xl transition-all md:p-8"
        [ngClass]="{
          'col-span-2': isMediumBento(index),
          blue: bentoItem.color === 'blue',
          violet: bentoItem.color === 'violet',
          teal: bentoItem.color === 'teal'
        }"
      >
        <div
          class="icon inline-flex aspect-square items-center justify-center self-start rounded-lg px-3 ring-4 ring-white"
          [ngClass]="bentoItem.color"
        >
          <mat-icon fontSet="bi" [fontIcon]="bentoItem.icon"></mat-icon>
        </div>
        <div class="prose mt-auto prose-p:mb-0">
          <h3 class="text-balance text-sm lg:text-base">{{ bentoItem.title }}</h3>
          <div>
            <p class="text-balance text-sm">
              @if (isMediumBento(index)) {
                {{ bentoItem.description.medium }}
              } @else {
                {{ bentoItem.description.small }}
              }
            </p>
          </div>
        </div>
      </div>
    }
  </div>`,
  styles: `
    .blue {
      &.icon {
        @apply bg-blue-100 text-blue-900;
      }
      &:hover {
        @apply border-blue-900;
      }
    }
    .violet {
      &.icon {
        @apply bg-violet-100 text-violet-900;
      }
      &:hover {
        @apply border-violet-900;
      }
    }
    .teal {
      &.icon {
        @apply bg-teal-100 text-teal-900;
      }
      &:hover {
        @apply border-teal-900;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeatureBentoComponent {
  // Nothing fancy here, we're just creating a grid for 7 elements on desktop
  // and 3 elements on mobile.
  // Desktop layout: 3 columns. Mobile layout: 1 column.
  // Desktop layout: Row 1: 3 small; Row 2: 1 medium, 1 small; Row 3: 1 small 1 medium

  private readonly _deviceService = inject(DeviceService);

  private readonly _shuffledBentoItems = computed(() => {
    return featureBentoItems.sort(() => Math.random() - 0.5);
  });

  readonly bentoItems = computed(() => {
    // If mobile return a smaller subset
    return this._deviceService.isMobile()
      ? this._shuffledBentoItems().slice(0, 1)
      : this._shuffledBentoItems().slice(0, 5);
  });

  isMediumBento(index: number): boolean {
    return index === 3 || index === 6;
  }
}
