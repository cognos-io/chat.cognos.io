import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import {
  CognosButtonComponent,
  type CognosButtonAppearance,
  type CognosButtonSize,
  type CognosButtonType,
} from './button.component';

type ButtonStoryArgs = {
  appearance: CognosButtonAppearance;
  disabled: boolean;
  fullWidth: boolean;
  icon: 'plus' | 'send' | 'user-plus' | 'server' | null;
  iconAfter: 'chevron-down' | 'chevron-right' | null;
  label: string;
  size: CognosButtonSize;
  type: CognosButtonType;
};

const meta: Meta<ButtonStoryArgs> = {
  title: 'Primitives/Button',
  decorators: [
    moduleMetadata({
      imports: [CognosButtonComponent],
    }),
  ],
  argTypes: {
    appearance: {
      control: 'select',
      options: ['primary', 'default', 'subtle', 'link', 'danger'],
    },
    size: {
      control: 'inline-radio',
      options: ['md', 'lg'],
    },
    type: {
      control: 'inline-radio',
      options: ['button', 'submit', 'reset'],
    },
    icon: {
      control: 'select',
      options: [null, 'plus', 'send', 'user-plus', 'server'],
    },
    iconAfter: {
      control: 'select',
      options: [null, 'chevron-down', 'chevron-right'],
    },
  },
  args: {
    appearance: 'default',
    disabled: false,
    fullWidth: false,
    icon: null,
    iconAfter: null,
    label: 'Ask Cognos',
    size: 'md',
    type: 'button',
  },
  render: (args: ButtonStoryArgs) => ({
    props: args,
    template: `
      <div style="width: 280px;">
        <cog-button
          [appearance]="appearance"
          [disabled]="disabled"
          [fullWidth]="fullWidth"
          [icon]="icon"
          [iconAfter]="iconAfter"
          [size]="size"
          [type]="type"
        >
          {{ label }}
        </cog-button>
      </div>
    `,
  }),
};

export default meta;

type Story = StoryObj<ButtonStoryArgs>;

export const Primary: Story = {
  args: {
    appearance: 'primary',
  },
};

export const Default: Story = {};

export const Subtle: Story = {
  args: {
    appearance: 'subtle',
  },
};

export const Link: Story = {
  args: {
    appearance: 'link',
  },
};

export const Danger: Story = {
  args: {
    appearance: 'danger',
  },
};

export const WithIcons: Story = {
  args: {
    icon: 'server',
    iconAfter: 'chevron-down',
    label: 'Cognos Sovereign',
  },
};

export const StartAndEndIcons: Story = {
  args: {
    appearance: 'primary',
    icon: 'plus',
    iconAfter: 'chevron-right',
    label: 'New chat',
  },
};

export const FullWidth: Story = {
  args: {
    appearance: 'primary',
    fullWidth: true,
    icon: 'plus',
    label: 'New chat',
  },
};

export const Large: Story = {
  args: {
    appearance: 'primary',
    size: 'lg',
  },
};

export const Disabled: Story = {
  args: {
    appearance: 'primary',
    disabled: true,
  },
};
