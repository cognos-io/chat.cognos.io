import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import {
  CognosDocAttachmentComponent,
  type CognosDocAttachmentState,
} from "./doc-attachment.component";

type StoryArgs = {
  clickable: boolean;
  ext: string | null;
  meta: string | null;
  name: string;
  progress: number;
  removeable: boolean;
  size: string;
  state: CognosDocAttachmentState;
  width: number;
  open: (event?: unknown) => void;
  remove: (event?: unknown) => void;
  retry: (event?: unknown) => void;
};

const meta: Meta<StoryArgs> = {
  title: "Extension/Files/Doc Attachment",
  decorators: [
    moduleMetadata({
      imports: [CognosDocAttachmentComponent],
    }),
  ],
  argTypes: {
    state: {
      control: "inline-radio",
      options: ["sealed", "encrypting", "error"],
    },
    progress: { control: { type: "range", min: 0, max: 100, step: 1 } },
    open: { action: "open" },
    remove: { action: "remove" },
    retry: { action: "retry" },
  },
  args: {
    name: "Procurement-2026.pdf",
    ext: null,
    size: "2.4 MB",
    meta: "PDF · 18 pages",
    state: "sealed",
    progress: 67,
    width: 280,
    clickable: true,
    removeable: true,
  },
  render: (args) => ({
    props: args,
    template: `
      <cog-doc-attachment
        [name]="name"
        [ext]="ext"
        [size]="size"
        [meta]="meta"
        [state]="state"
        [progress]="progress"
        [width]="width"
        [clickable]="clickable"
        [removeable]="removeable"
        (open)="open($event)"
        (remove)="remove($event)"
        (retry)="retry($event)"
      />
    `,
  }),
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const Sealed: Story = {};
export const Encrypting: Story = { args: { state: "encrypting", meta: null } };
export const Error: Story = { args: { state: "error", meta: null } };
