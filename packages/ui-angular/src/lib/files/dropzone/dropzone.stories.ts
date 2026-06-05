import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import { CognosDropzoneComponent } from "./dropzone.component";

type StoryArgs = {
  compact: boolean;
  filesSelected: (files?: FileList) => void;
};

const meta: Meta<StoryArgs> = {
  title: "Extension/Files/Dropzone",
  decorators: [
    moduleMetadata({
      imports: [CognosDropzoneComponent],
    }),
  ],
  argTypes: {
    filesSelected: { action: "filesSelected" },
  },
  args: {
    compact: false,
  },
  render: (args) => ({
    props: args,
    template: `<div style="width:520px; max-width:100%;"><cog-dropzone [compact]="compact" (filesSelected)="filesSelected($event)" /></div>`,
  }),
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const Default: Story = {};
export const Compact: Story = { args: { compact: true } };
