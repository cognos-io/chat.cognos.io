import { type Meta, type StoryObj, moduleMetadata } from '@storybook/angular';

import { STORY_COSMOS_IMAGE } from '../../extension-story-data';
import { CognosLightboxComponent } from './lightbox.component';

type StoryArgs = {
  close: (event?: unknown) => void;
  download: (event?: unknown) => void;
  name: string;
  src: string;
};

const meta: Meta<StoryArgs> = {
  title: 'Extension/Images/Lightbox',
  decorators: [moduleMetadata({ imports: [CognosLightboxComponent] })],
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    close: { action: 'close' },
    download: { action: 'download' },
  },
  args: {
    src: STORY_COSMOS_IMAGE,
    name: 'generated-starfield.png',
  },
  render: (args) => ({
    props: args,
    template: `<div style="position:relative; min-height:540px; width:100vw;"><cog-lightbox [src]="src" [name]="name" (close)="close($event)" (download)="download($event)" /></div>`,
  }),
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const Default: Story = {};
