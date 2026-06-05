import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import { CognosUploadRowComponent } from "./upload-row.component";

type StoryArgs = {
  cancellable: boolean;
  cancel: (event?: unknown) => void;
  done: boolean;
  ext: string | null;
  name: string;
  progress: number;
};

const meta: Meta<StoryArgs> = {
  title: "Extension/Files/Upload Row",
  decorators: [
    moduleMetadata({
      imports: [CognosUploadRowComponent],
    }),
  ],
  argTypes: {
    progress: { control: { type: "range", min: 0, max: 100, step: 1 } },
    cancel: { action: "cancel" },
  },
  args: {
    name: "Tenancy-agreement.pdf",
    ext: null,
    progress: 42,
    done: false,
    cancellable: true,
  },
  render: (args) => ({
    props: args,
    template: `<div style="width:420px;"><cog-upload-row [name]="name" [ext]="ext" [progress]="progress" [done]="done" [cancellable]="cancellable" (cancel)="cancel($event)" /></div>`,
  }),
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const InFlight: Story = {};
export const Done: Story = { args: { name: "Passport-scan.jpg", progress: 100, done: true, cancellable: false } };
