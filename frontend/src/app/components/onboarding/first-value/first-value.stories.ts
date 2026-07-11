import { signal } from '@angular/core';

import {
  type Meta,
  type StoryObj,
  applicationConfig,
  moduleMetadata,
} from '@storybook/angular';

import { Analytics } from '@app/services/analytics/analytics';
import { NoopAnalytics } from '@app/services/analytics/noop-analytics';
import { AuthService } from '@app/services/auth.service';
import { FirstValueJourney } from '@app/services/first-value-journey';
import { storybookProviders } from '@app/storybook/storybook-providers';

import { FirstValue } from './first-value';

const meta: Meta<FirstValue> = {
  title: 'Onboarding/First value',
  component: FirstValue,
  decorators: [
    moduleMetadata({ imports: [FirstValue] }),
    applicationConfig({
      providers: [
        ...storybookProviders,
        { provide: AuthService, useValue: { user: signal({ id: 'story-account' }) } },
        { provide: Analytics, useClass: NoopAnalytics },
        FirstValueJourney,
      ],
    }),
  ],
  parameters: { layout: 'padded' },
};

export default meta;

type Story = StoryObj<FirstValue>;

export const Welcome: Story = {};
