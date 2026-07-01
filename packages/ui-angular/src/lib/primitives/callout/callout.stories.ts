import { type Meta, type StoryObj, moduleMetadata } from '@storybook/angular';

import { CognosCalloutComponent, type CognosCalloutTone } from './callout.component';

type StoryArgs = {
  tone: CognosCalloutTone;
};

const meta: Meta<StoryArgs> = {
  title: 'Primitives/Callout',
  decorators: [
    moduleMetadata({
      imports: [CognosCalloutComponent],
    }),
  ],
  args: {
    tone: 'success',
  },
  render: (args) => ({
    props: args,
    template: `
      <cog-callout [tone]="tone" icon="key-round" style="max-width: 420px;">
        The decryption key lives inside the link itself and
        <strong>never reaches our servers</strong>. Anyone holding the link can
        read it — so share only with people you trust.
      </cog-callout>
    `,
  }),
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Default: Story = {};

export const ToneSet: Story = {
  render: () => ({
    template: `
      <div style="display:grid; gap:12px; max-width:420px;">
        <cog-callout tone="neutral" icon="info">Neutral, informational note.</cog-callout>
        <cog-callout tone="info" icon="info">Something worth knowing.</cog-callout>
        <cog-callout tone="success" icon="shield-check">Your data is end-to-end encrypted.</cog-callout>
        <cog-callout tone="warning" icon="brain">Shared messages also include the model's reasoning.</cog-callout>
        <cog-callout tone="danger" icon="triangle-alert">This action cannot be undone.</cog-callout>
      </div>
    `,
  }),
};
