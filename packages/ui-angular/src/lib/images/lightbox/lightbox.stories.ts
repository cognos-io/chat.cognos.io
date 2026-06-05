import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import { STORY_COSMOS_IMAGE } from "../../extension-story-data";

import { CognosLightboxComponent } from "./lightbox.component";

type StoryArgs = {
  close: (event?: unknown) => void;
  download: (event?: unknown) => void;
  name: string;
  saveToVault: (event?: unknown) => void;
  src: string;
};

const meta: Meta<StoryArgs> = {
  title: "Extension/Images/Lightbox",
  decorators: [moduleMetadata({ imports: [CognosLightboxComponent] })],
  parameters: {
    layout: "fullscreen",
  },
  argTypes: {
    close: { action: "close" },
    download: { action: "download" },
    saveToVault: { action: "saveToVault" },
  },
  args: {
    src: STORY_COSMOS_IMAGE,
    name: "generated-starfield.png",
  },
  render: (args) => ({
    props: args,
    template: `<div style="position:relative; min-height:540px; width:100vw;"><cog-lightbox [src]="src" [name]="name" (close)="close($event)" (download)="download($event)" (saveToVault)="saveToVault($event)" /></div>`,
  }),
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const Default: Story = {};
