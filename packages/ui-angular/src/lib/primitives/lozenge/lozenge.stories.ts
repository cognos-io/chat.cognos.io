import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import {
  CognosLozengeComponent,
  type CognosLozengeTone,
} from "./lozenge.component";

type StoryArgs = {
  label: string;
  tone: CognosLozengeTone;
};

const meta: Meta<StoryArgs> = {
  title: "Primitives/Lozenge",
  decorators: [
    moduleMetadata({
      imports: [CognosLozengeComponent],
    }),
  ],
  args: {
    label: "Encrypted",
    tone: "green",
  },
  render: (args) => ({
    props: args,
    template: `<cog-lozenge [tone]="tone">{{ label }}</cog-lozenge>`,
  }),
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Default: Story = {};

export const ToneSet: Story = {
  render: () => ({
    template: `
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <cog-lozenge tone="neutral">Owner</cog-lozenge>
        <cog-lozenge tone="blue">Swiss cloud</cog-lozenge>
        <cog-lozenge tone="green">On-prem</cog-lozenge>
        <cog-lozenge tone="purple">This device</cog-lozenge>
        <cog-lozenge tone="red">Revoked</cog-lozenge>
      </div>
    `,
  }),
};
