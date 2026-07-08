import { type Meta, type StoryObj, moduleMetadata } from '@storybook/angular';

import {
  CognosSecurityModalComponent,
  DEFAULT_SECURITY_MODAL_CONTENT,
  type SecurityModalContent,
} from './security-modal.component';

type StoryArgs = {
  open: boolean;
  fingerprint: string;
  verified: boolean;
  content: SecurityModalContent;
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
    content: DEFAULT_SECURITY_MODAL_CONTENT,
  },
  render: (args) => ({
    props: args,
    template: `
      <cog-security-modal
        [open]="open"
        [fingerprint]="fingerprint"
        [verified]="verified"
        [content]="content"
      />
    `,
  }),
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Default: Story = {};

export const EuGatewayWithDetails: Story = {
  args: {
    content: {
      ...DEFAULT_SECURITY_MODAL_CONTENT,
      computeFlag: '🇪🇺',
      computeTitle: 'EU gateway',
      rows: [
        { icon: 'sparkles', label: 'Model', value: 'Fast 70B · Requesty (EU)' },
        { icon: 'server', label: 'Region', value: 'Europe + Switzerland + UK' },
        { icon: 'eraser', label: 'Auto-delete', value: 'After 30 days' },
      ],
      links: [
        { label: 'How we keep it private', href: 'https://cognos.io/security' },
        { label: 'Who processes your data', href: 'https://cognos.io/subprocessors' },
      ],
    },
  },
};

export const WithoutKeys: Story = {
  args: {
    fingerprint: '',
  },
};
