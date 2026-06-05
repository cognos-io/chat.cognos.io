import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import { CognosProgressComponent } from "./progress.component";

type StoryArgs = {
  height: number;
  indeterminate: boolean;
  tone: string;
  value: number;
};

const meta: Meta<StoryArgs> = {
  title: "Extension/Files/Progress",
  decorators: [
    moduleMetadata({
      imports: [CognosProgressComponent],
    }),
  ],
  argTypes: {
    value: { control: { type: "range", min: 0, max: 100, step: 1 } },
    height: { control: { type: "range", min: 2, max: 8, step: 1 } },
  },
  args: {
    value: 42,
    indeterminate: false,
    height: 4,
    tone: "var(--cog-brand)",
  },
  render: (args) => ({
    props: args,
    template: `<div style="width:320px;"><cog-progress [value]="value" [indeterminate]="indeterminate" [height]="height" [tone]="tone" /></div>`,
  }),
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const Determinate: Story = {};
export const Complete: Story = { args: { value: 100, tone: "var(--cog-success)" } };
export const Indeterminate: Story = { args: { indeterminate: true } };
