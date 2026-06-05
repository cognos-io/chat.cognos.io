import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { CognosIconShowcaseComponent } from './icon-showcase/icon-showcase.component';

type IconStoryArgs = {
  accent: 'blue' | 'emerald';
  size: 12 | 14 | 16 | 18 | 20 | 24;
  theme: 'dark' | 'light';
  tone:
    | 'current'
    | 'text'
    | 'text-subtle'
    | 'text-subtlest'
    | 'selected'
    | 'link'
    | 'brand'
    | 'success'
    | 'danger';
};

const meta: Meta<IconStoryArgs> = {
  title: 'Foundations/Icons',
  decorators: [
    moduleMetadata({
      imports: [CognosIconShowcaseComponent],
    }),
  ],
  parameters: {
    layout: 'padded',
  },
  argTypes: {
    theme: {
      control: 'inline-radio',
      options: ['light', 'dark'],
    },
    accent: {
      control: 'inline-radio',
      options: ['emerald', 'blue'],
    },
    size: {
      control: 'inline-radio',
      options: [12, 14, 16, 18, 20, 24],
    },
    tone: {
      control: 'select',
      options: [
        'current',
        'text',
        'text-subtle',
        'text-subtlest',
        'selected',
        'link',
        'brand',
        'success',
        'danger',
      ],
    },
  },
  args: {
    accent: 'emerald',
    size: 18,
    theme: 'light',
    tone: 'text-subtle',
  },
  render: (args: IconStoryArgs) => ({
    props: args,
    template: `
      <cog-icon-showcase
        [accent]="accent"
        [size]="size"
        [theme]="theme"
        [tone]="tone"
      />
    `,
  }),
};

export default meta;

type Story = StoryObj<IconStoryArgs>;

export const Showcase: Story = {};
