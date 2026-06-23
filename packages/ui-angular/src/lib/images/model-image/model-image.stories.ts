import { type Meta, type StoryObj, moduleMetadata } from '@storybook/angular';

import { STORY_COSMOS_IMAGE } from '../../extension-story-data';
import {
  CognosModelImageComponent,
  type CognosModelImageState,
} from './model-image.component';

type StoryArgs = {
  download: (event?: unknown) => void;
  host: string;
  open: (event?: unknown) => void;
  prompt: string;
  regenerate: (event?: unknown) => void;
  src: string | null;
  state: CognosModelImageState;
  tag: string;
  tone: 'blue' | 'green' | 'purple';
  variations: (event?: unknown) => void;
  width: number;
};

const meta: Meta<StoryArgs> = {
  title: 'Extension/Images/Model Image',
  decorators: [moduleMetadata({ imports: [CognosModelImageComponent] })],
  argTypes: {
    state: { control: 'inline-radio', options: ['done', 'generating'] },
    tone: { control: 'inline-radio', options: ['blue', 'green', 'purple'] },
    open: { action: 'open' },
    download: { action: 'download' },
    regenerate: { action: 'regenerate' },
    variations: { action: 'variations' },
  },
  args: {
    src: STORY_COSMOS_IMAGE,
    prompt: 'A calm starfield in soft violet, wide aspect',
    state: 'done',
    tag: 'SWISS CLOUD',
    tone: 'blue',
    host: 'Swiss cloud',
    width: 380,
  },
  render: (args) => ({
    props: args,
    template: `<cog-model-image [src]="src" [prompt]="prompt" [state]="state" [tag]="tag" [tone]="tone" [host]="host" [width]="width" (open)="open($event)" (download)="download($event)" (regenerate)="regenerate($event)" (variations)="variations($event)" />`,
  }),
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const Returned: Story = {};
export const Generating: Story = { args: { state: 'generating', src: null } };
export const OnPrem: Story = {
  args: { tag: 'ON-PREM', tone: 'green', host: 'On-prem' },
};
export const ThisDevice: Story = {
  args: { tag: 'THIS DEVICE', tone: 'purple', host: 'this device' },
};
