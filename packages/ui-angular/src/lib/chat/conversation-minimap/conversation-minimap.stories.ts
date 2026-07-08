import { type Meta, type StoryObj, moduleMetadata } from '@storybook/angular';

import {
  CognosConversationMinimapComponent,
  type MinimapTick,
} from './conversation-minimap.component';

const SAMPLE_TICKS: MinimapTick[] = [
  {
    id: '1',
    preview: 'How do I set up the project locally?',
    ariaLabel: 'Jump to message: How do I set up the project locally?',
  },
  {
    id: '2',
    preview: 'What about the database migrations?',
    ariaLabel: 'Jump to message: What about the database migrations?',
  },
  {
    id: '3',
    preview: 'Can you show me the auth flow?',
    ariaLabel: 'Jump to message: Can you show me the auth flow?',
  },
  {
    id: '4',
    preview: 'Now write a test for the handler',
    ariaLabel: 'Jump to message: Now write a test for the handler',
  },
  {
    id: '5',
    preview: 'Explain the caching strategy',
    ariaLabel: 'Jump to message: Explain the caching strategy',
  },
];

const meta: Meta<CognosConversationMinimapComponent> = {
  title: 'Chat/Conversation minimap',
  component: CognosConversationMinimapComponent,
  decorators: [moduleMetadata({ imports: [CognosConversationMinimapComponent] })],
  // The component is `position: absolute`, so anchor it inside a relative box.
  // Hover (or focus) a tick to open its preview tooltip — the shared
  // hover-intent behaviour drives the open delay, safe-triangle funnel and
  // viewport-aware placement.
  render: (args) => ({
    props: args,
    template: `
      <div style="position:relative; height:360px; width:100%; max-width:820px; border:var(--cog-border-width) solid var(--cog-border); border-radius:var(--cog-radius-md); background:var(--cog-surface-sunken);">
        <cog-conversation-minimap
          [ticks]="ticks"
          [activeId]="activeId"
          [navLabel]="navLabel"
        />
      </div>
    `,
  }),
};

export default meta;

type Story = StoryObj<CognosConversationMinimapComponent>;

export const Default: Story = {
  args: {
    ticks: SAMPLE_TICKS,
    activeId: '3',
    navLabel: 'Message navigator',
  },
};

// A long preview to exercise the tooltip's real width (min(20rem, 80vw)) that
// keeps the bubble from collapsing to one character per line. Hover the top tick
// to see it wrap.
export const LongPreview: Story = {
  args: {
    ticks: [
      {
        id: 'long',
        preview:
          'Could you walk me through the entire end-to-end request lifecycle, including how the encrypted payload is decrypted client-side before it is rendered in the conversation view?',
        ariaLabel: 'Jump to message: long request',
      },
      ...SAMPLE_TICKS.slice(1),
    ],
    activeId: 'long',
    navLabel: 'Message navigator',
  },
};
