import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import { STORY_IMAGES, STORY_COSMOS_IMAGE, STORY_RIPPLES_IMAGE } from "../../extension-story-data";

import { CognosImageGridComponent } from "./image-grid.component";

type StoryArgs = {
  images: string[];
  max: number;
  open: (index: number) => void;
  width: number;
};

const meta: Meta<StoryArgs> = {
  title: "Extension/Images/Image Grid",
  decorators: [moduleMetadata({ imports: [CognosImageGridComponent] })],
  argTypes: {
    open: { action: "open" },
    max: { control: { type: "range", min: 1, max: 4, step: 1 } },
    width: { control: { type: "range", min: 260, max: 360, step: 10 } },
  },
  args: {
    images: STORY_IMAGES.slice(0, 4),
    max: 4,
    width: 320,
  },
  render: (args) => ({
    props: args,
    template: `<cog-image-grid [images]="images" [max]="max" [width]="width" (open)="open($event)" />`,
  }),
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const OneImage: Story = { args: { images: [STORY_COSMOS_IMAGE] } };
export const TwoImages: Story = { args: { images: [STORY_COSMOS_IMAGE, STORY_RIPPLES_IMAGE] } };
export const ThreeImages: Story = { args: { images: STORY_IMAGES.slice(0, 3) } };
export const FourImages: Story = {};
export const FivePlusImages: Story = { args: { images: STORY_IMAGES } };
