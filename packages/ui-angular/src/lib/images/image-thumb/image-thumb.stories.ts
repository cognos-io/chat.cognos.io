import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import { STORY_COSMOS_IMAGE } from "../../extension-story-data";

import { CognosImageThumbComponent } from "./image-thumb.component";

type StoryArgs = {
  clickable: boolean;
  cover: boolean;
  height: number;
  lock: boolean;
  more: number;
  open: (event?: unknown) => void;
  round: number;
  src: string;
};

const meta: Meta<StoryArgs> = {
  title: "Extension/Images/Image Thumb",
  decorators: [moduleMetadata({ imports: [CognosImageThumbComponent] })],
  argTypes: {
    height: { control: { type: "range", min: 96, max: 180, step: 4 } },
    round: { control: { type: "range", min: 4, max: 16, step: 1 } },
    open: { action: "open" },
  },
  args: {
    src: STORY_COSMOS_IMAGE,
    clickable: true,
    height: 132,
    round: 8,
    cover: true,
    lock: true,
    more: 0,
  },
  render: (args) => ({
    props: args,
    template: `<div style="width:220px;"><cog-image-thumb [src]="src" [clickable]="clickable" [height]="height" [round]="round" [cover]="cover" [lock]="lock" [more]="more" (open)="open($event)" /></div>`,
  }),
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const Default: Story = {};
export const Contain: Story = { args: { cover: false } };
export const MoreOverlay: Story = { args: { more: 3 } };
