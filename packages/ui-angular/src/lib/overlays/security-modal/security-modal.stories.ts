import { type Meta, type StoryObj, moduleMetadata } from '@storybook/angular';

import { CognosSecurityModalComponent } from './security-modal.component';

type StoryArgs = {
  open: boolean;
  fingerprint: string;
  verified: boolean;
};

const meta: Meta<StoryArgs> = {
  title: 'Overlays/Security Modal',
  decorators: [
    moduleMetadata({
      imports: [CognosSecurityModalComponent],
    }),
  ],
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    open: true,
    fingerprint: '9F2A · 7C41 · DD08',
    verified: true,
  },
  render: (args) => ({
    props: args,
    template: `
      <cog-security-modal
        [open]="open"
        [fingerprint]="fingerprint"
        [verified]="verified"
      />
    `,
  }),
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Default: Story = {};

export const WithoutKeys: Story = {
  args: {
    fingerprint: '',
  },
};
