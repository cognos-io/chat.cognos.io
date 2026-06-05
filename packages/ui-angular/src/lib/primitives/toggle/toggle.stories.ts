import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import { CognosToggleComponent } from "./toggle.component";

type StoryArgs = {
  checked: boolean;
  label: string;
};

const meta: Meta<StoryArgs> = {
  title: "Primitives/Toggle",
  decorators: [
    moduleMetadata({
      imports: [CognosToggleComponent],
    }),
  ],
  args: {
    checked: true,
    label: "Show visible encryption cue",
  },
  render: (args) => ({
    props: args,
    template: `
      <div style="display:flex; align-items:center; gap:12px; color:var(--cog-text);">
        <cog-toggle [checked]="checked" [label]="label" />
        <span>{{ label }}</span>
      </div>
    `,
  }),
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const On: Story = {};

export const Off: Story = {
  args: {
    checked: false,
  },
};
