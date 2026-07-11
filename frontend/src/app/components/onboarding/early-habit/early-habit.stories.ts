import { signal } from '@angular/core';

import {
  type Meta,
  type StoryObj,
  applicationConfig,
  moduleMetadata,
} from '@storybook/angular';

import { FirstValueJourney } from '@app/services/first-value-journey';
import { storybookProviders } from '@app/storybook/storybook-providers';

import { EarlyHabit } from './early-habit';

const journey = (conversationsUsed: number, returnedInWeekTwo: boolean) => ({
  conversationsUsed: signal(conversationsUsed),
  returnedInWeekTwo: signal(returnedInWeekTwo),
  dismissHabit: () => undefined,
});

const meta: Meta<EarlyHabit> = {
  title: 'Onboarding/Early habit',
  component: EarlyHabit,
  decorators: [
    moduleMetadata({ imports: [EarlyHabit] }),
    applicationConfig({
      providers: [
        ...storybookProviders,
        { provide: FirstValueJourney, useValue: journey(1, false) },
      ],
    }),
  ],
  parameters: { layout: 'padded' },
};

export default meta;

type Story = StoryObj<EarlyHabit>;

export const GettingStarted: Story = {};

export const MilestonesComplete: Story = {
  decorators: [
    applicationConfig({
      providers: [{ provide: FirstValueJourney, useValue: journey(2, true) }],
    }),
  ],
};
