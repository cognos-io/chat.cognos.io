import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { CognosIconComponent } from '@cognos/ui-angular';
import type { CognosIconName } from '@cognos/ui/icons';

import { DeviceService, Height } from '@app/services/device.service';

interface FeatureBentoItem {
  title: string;
  description: {
    small: string;
    medium: string;
  };
  tone: 'blue' | 'violet' | 'teal';
  icon: CognosIconName;
}

const featureBentoItems: FeatureBentoItem[] = [
  {
    title: 'Multi-model support',
    description: {
      small: 'Pick from a variety of AI models',
      medium: 'Use both proprietary and open-source AI models to get the best results',
    },
    tone: 'blue',
    icon: 'server',
  },
  {
    title: 'Disappearing messages',
    description: {
      small: 'Set a timer for your messages',
      medium:
        'Set a timer for your messages to be permanently deleted after a certain time',
    },
    tone: 'violet',
    icon: 'rotate-cw',
  },
  {
    title: 'No training on your data',
    description: {
      small: 'Keep your data private',
      medium: 'Your data can never be used to train future AI models',
    },
    tone: 'teal',
    icon: 'shield-x',
  },
  {
    title: 'Messages encrypted',
    description: {
      small: 'Secure & private',
      medium: 'Using strong encryption to keep your data secure and private',
    },
    tone: 'violet',
    icon: 'shield-check',
  },
  {
    title: 'No risk of leaks',
    description: {
      small: 'Only you can see your data',
      medium:
        'Only you can access your data. Without your permission, no one can access it',
    },
    tone: 'blue',
    icon: 'eye-off',
  },
  {
    title: 'Incognito conversations',
    description: {
      small: 'Chats never saved',
      medium: 'Option to enter incognito mode where your chats are never saved',
    },
    tone: 'teal',
    icon: 'lock',
  },
  {
    title: 'Auto account lock',
    description: {
      small: 'Log out after inactivity',
      medium: 'Protect your data by automatically logging out after inactivity',
    },
    tone: 'violet',
    icon: 'key-round',
  },
];

@Component({
  selector: 'app-feature-bento',
  standalone: true,
  imports: [CognosIconComponent],
  template: `
    <div class="feature-bento">
      @for (bentoItem of bentoItems(); track bentoItem.title; let index = $index) {
        <article [class]="cardClass(index, bentoItem.tone)">
          <span [class]="iconClass(bentoItem.tone)">
            <cog-icon [name]="bentoItem.icon" [size]="18" tone="current" />
          </span>

          <div class="feature-bento__content">
            <h3 class="feature-bento__title">{{ bentoItem.title }}</h3>
            <p class="feature-bento__description">
              @if (isMediumBento(index)) {
                {{ bentoItem.description.medium }}
              } @else {
                {{ bentoItem.description.small }}
              }
            </p>
          </div>
        </article>
      }
    </div>
  `,
  styles: `
    .feature-bento {
      display: grid;
      gap: var(--cog-space-150);
    }

    .feature-bento__card {
      display: flex;
      min-height: 164px;
      flex-direction: column;
      justify-content: space-between;
      gap: var(--cog-space-150);
      border: 1px solid color-mix(in srgb, var(--cog-border) 72%, transparent);
      border-radius: var(--cog-radius-md);
      background: color-mix(in srgb, var(--cog-surface) 78%, transparent);
      padding: var(--cog-space-200);
      backdrop-filter: blur(20px);
      transition: border-color var(--cog-dur-fast) var(--cog-ease-standard);
    }

    .feature-bento__card--blue:hover {
      border-color: var(--cog-info);
    }

    .feature-bento__card--violet:hover {
      border-color: var(--cog-loz-purple-fg);
    }

    .feature-bento__card--teal:hover {
      border-color: var(--cog-success);
    }

    .feature-bento__icon {
      display: inline-flex;
      width: 44px;
      height: 44px;
      align-items: center;
      justify-content: center;
      border-radius: var(--cog-radius-md);
      box-shadow: inset 0 0 0 4px rgba(255, 255, 255, 0.9);
    }

    .feature-bento__icon--blue {
      background: var(--cog-info-bg);
      color: var(--cog-info-text);
    }

    .feature-bento__icon--violet {
      background: var(--cog-loz-purple-bg);
      color: var(--cog-loz-purple-fg);
    }

    .feature-bento__icon--teal {
      background: var(--cog-success-bg);
      color: var(--cog-success-text);
    }

    .feature-bento__content {
      display: grid;
      gap: var(--cog-space-100);
    }

    .feature-bento__title,
    .feature-bento__description {
      margin: 0;
    }

    .feature-bento__title {
      color: var(--cog-text);
      font-size: var(--cog-fs-h-sm);
      font-weight: var(--cog-fw-h-sm);
      line-height: var(--cog-lh-h-sm);
      text-wrap: balance;
    }

    .feature-bento__description {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body-sm);
      line-height: var(--cog-lh-body-sm);
      text-wrap: pretty;
    }

    @media (min-width: 768px) {
      .feature-bento {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .feature-bento__card--medium {
        grid-column: span 2;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeatureBentoComponent {
  private readonly _deviceService = inject(DeviceService);

  private readonly _shuffledBentoItems = computed(() => {
    return [...featureBentoItems].sort(() => Math.random() - 0.5);
  });

  readonly bentoItems = computed(() => {
    let numberOfItems = 1;

    if (this._deviceService.isMobile()) {
      switch (this._deviceService.height()) {
        case Height.Short:
          numberOfItems = 1;
          break;
        case Height.Medium:
          numberOfItems = 2;
          break;
        case Height.Tall:
          numberOfItems = 3;
          break;
      }
    } else {
      switch (this._deviceService.height()) {
        case Height.Short:
          numberOfItems = 3;
          break;
        case Height.Medium:
          numberOfItems = 5;
          break;
        case Height.Tall:
          numberOfItems = 7;
          break;
      }
    }

    return this._shuffledBentoItems().slice(0, numberOfItems);
  });

  isMediumBento(index: number): boolean {
    if (this._deviceService.isMobile()) return false;
    return index === 3 || index === 6;
  }

  cardClass(index: number, tone: FeatureBentoItem['tone']) {
    const classes = ['feature-bento__card', `feature-bento__card--${tone}`];

    if (this.isMediumBento(index)) {
      classes.push('feature-bento__card--medium');
    }

    return classes.join(' ');
  }

  iconClass(tone: FeatureBentoItem['tone']) {
    return `feature-bento__icon feature-bento__icon--${tone}`;
  }
}
