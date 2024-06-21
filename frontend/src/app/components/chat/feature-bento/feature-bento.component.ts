import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { DeviceService } from '@app/services/device.service';

interface FeatureBentoItem {
  title: string;
  description: {
    small: string; // small bento items
    medium: string; // medium bento items
    large: string; // large bento items
  };
  color: string; // tailwind color
  icon: string; // bootstrap icon name
}

const featureBentoItems: FeatureBentoItem[] = [
  {
    title: 'Use multiple AI models',
    description: {
      small: 'Small bento 1',
      medium: 'Medium bento 1',
      large: 'Large bento 1',
    },
    color: 'blue',
    icon: 'bi-1-circle-fill',
  },
  {
    title: 'No training on your data',
    description: {
      small: 'Small bento 2',
      medium: 'Medium bento 2',
      large: 'Large bento 2',
    },
    color: 'blue',
    icon: 'bi-1-circle-fill',
  },
  {
    title: 'Conversations encrypted',
    description: {
      small: 'Small bento 3',
      medium: 'Medium bento 3',
      large: 'Large bento 3',
    },
    color: 'blue',
    icon: 'bi-1-circle-fill',
  },
  {
    title: 'No risk of leaks',
    description: {
      small: 'Small bento 4',
      medium: 'Medium bento 4',
      large: 'Large bento 4',
    },
    color: 'blue',
    icon: 'bi-1-circle-fill',
  },
  {
    title: 'Incognito conversations',
    description: {
      small: 'Small bento 5',
      medium: 'Medium bento 5',
      large: 'Large bento 5',
    },
    color: 'blue',
    icon: 'bi-1-circle-fill',
  },
  {
    title: 'Auto account lock',
    description: {
      small: 'Small bento 6',
      medium: 'Medium bento 6',
      large: 'Large bento 6',
    },
    color: 'blue',
    icon: 'bi-1-circle-fill',
  },
];

@Component({
  selector: 'app-feature-bento',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `<div class="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-8">
    @for (bentoItem of bentoItems(); track bentoItem.title; let index = $index) {
      <div
        class=" prose flex flex-col justify-between rounded-xl bg-white p-4 shadow prose-p:m-0 md:p-8"
        [ngClass]="{
          'col-span-2': isMediumBento(index),
          'aspect-square': !isMediumBento(index)
        }"
      >
        <h3 class="text-balance text-sm">{{ bentoItem.title }}</h3>
        <div>
          <div
            class="float-start mb-4 me-4 flex aspect-square items-center justify-center rounded-md px-2"
            [ngClass]="bentoItem.color"
          >
            <mat-icon fontSet="bi" [fontIcon]="bentoItem.icon"></mat-icon>
          </div>
          <p class="text-sm ">
            @if (isMediumBento(index)) {
              {{ bentoItem.description.medium }}
            } @else {
              {{ bentoItem.description.small }}
            }
          </p>
        </div>
      </div>
    }
  </div>`,
  styles: `
    .blue {
      @apply bg-blue-100 text-blue-900;
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
    // If mobile only return 2, otherwise return 5
    return this._deviceService.isMobile()
      ? this._shuffledBentoItems().slice(0, 2)
      : this._shuffledBentoItems().slice(0, 5);
  });

  isMediumBento(index: number): boolean {
    return index === 3 || index === 6;
  }
}
