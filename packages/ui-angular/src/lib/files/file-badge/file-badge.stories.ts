import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import { CognosFileBadgeComponent } from "./file-badge.component";

type StoryArgs = {
  ext: string;
  radius: number;
  size: number;
};

const meta: Meta<StoryArgs> = {
  title: "Extension/Files/File Badge",
  decorators: [
    moduleMetadata({
      imports: [CognosFileBadgeComponent],
    }),
  ],
  argTypes: {
    size: { control: { type: "range", min: 22, max: 44, step: 2 } },
    radius: { control: { type: "range", min: 3, max: 8, step: 1 } },
  },
  args: {
    ext: "pdf",
    size: 38,
    radius: 4,
  },
  render: (args) => ({
    props: args,
    template: `<cog-file-badge [ext]="ext" [size]="size" [radius]="radius" />`,
  }),
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const Default: Story = {};
export const Image: Story = { args: { ext: "jpg" } };
export const Spreadsheet: Story = { args: { ext: "csv" } };
export const Unknown: Story = { args: { ext: "foo" } };
