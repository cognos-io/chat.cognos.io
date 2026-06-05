import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import type { CognosStorageSegment } from "../vault.types";

import { CognosStorageMeterComponent } from "./storage-meter.component";

type StoryArgs = {
  segments: CognosStorageSegment[];
  total: string;
  used: string;
  width: string;
};

const meta: Meta<StoryArgs> = {
  title: "Extension/Vault/Storage Meter",
  decorators: [moduleMetadata({ imports: [CognosStorageMeterComponent] })],
  argTypes: {
    segments: { control: "object" },
  },
  args: {
    width: "100%",
    used: "1.6 GB",
    total: "5 GB",
    segments: [
      { label: "Documents", tone: "blue", used: 17 },
      { label: "Images", tone: "purple", used: 9 },
      { label: "Sheets", tone: "green", used: 4 },
      { label: "Audio", tone: "red", used: 2 },
    ],
  },
  render: (args) => ({
    props: args,
    template: `<div style="width:640px; max-width:100%;"><cog-storage-meter [width]="width" [used]="used" [total]="total" [segments]="segments" /></div>`,
  }),
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const Default: Story = {};
