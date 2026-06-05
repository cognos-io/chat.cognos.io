import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import { CognosAudioNoteComponent } from "./audio-note.component";

type StoryArgs = {
  duration: string;
  src: string | null;
  width: number;
};

const meta: Meta<StoryArgs> = {
  title: "Extension/Files/Audio Note",
  decorators: [
    moduleMetadata({
      imports: [CognosAudioNoteComponent],
    }),
  ],
  argTypes: {
    width: { control: { type: "range", min: 240, max: 360, step: 10 } },
  },
  args: {
    duration: "0:42",
    src: null,
    width: 280,
  },
  render: (args) => ({
    props: args,
    template: `<cog-audio-note [duration]="duration" [src]="src" [width]="width" />`,
  }),
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const Default: Story = {};
