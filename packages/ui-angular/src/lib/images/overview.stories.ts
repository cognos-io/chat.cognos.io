import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import {
  STORY_COSMOS_IMAGE,
  STORY_IMAGES,
  STORY_RIPPLES_IMAGE,
} from "../extension-story-data";

import { CognosImageGridComponent } from "./image-grid/image-grid.component";
import { CognosImageThumbComponent } from "./image-thumb/image-thumb.component";
import { CognosModelImageComponent } from "./model-image/model-image.component";

const meta: Meta = {
  title: "Extension/Images/Overview",
  decorators: [
    moduleMetadata({
      imports: [
        CognosImageGridComponent,
        CognosImageThumbComponent,
        CognosModelImageComponent,
      ],
    }),
  ],
};

export default meta;
type Story = StoryObj;

export const Showcase: Story = {
  render: () => ({
    props: {
      cosmos: STORY_COSMOS_IMAGE,
      ripples: STORY_RIPPLES_IMAGE,
      images: STORY_IMAGES,
    },
    template: `
      <div style="display:grid; gap:24px; width:100%; max-width:840px; color:var(--cog-text);">
        <section style="display:grid; gap:12px; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items:start;"><cog-image-thumb [src]="cosmos" [clickable]="true" /><cog-image-thumb [src]="ripples" [more]="3" [clickable]="true" /></section>
        <section style="display:grid; gap:12px;"><cog-image-grid [images]="[cosmos]" /><cog-image-grid [images]="images" /></section>
        <section style="display:grid; gap:24px; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items:start;"><cog-model-image [state]="'generating'" host="Swiss cloud" [width]="300" /><cog-model-image [src]="cosmos" prompt="A calm starfield in soft violet, wide aspect" tag="SWISS CLOUD" tone="blue" [width]="300" /></section>
      </div>
    `,
  }),
};
