import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import {
  CognosAttachChipComponent,
  type CognosAttachChipState,
} from "./attach-chip.component";

type StoryArgs = {
  ext: string | null;
  name: string;
  remove: (event?: unknown) => void;
  removeable: boolean;
  state: CognosAttachChipState;
};

const meta: Meta<StoryArgs> = {
  title: "Extension/Files/Attach Chip",
  decorators: [
    moduleMetadata({
      imports: [CognosAttachChipComponent],
    }),
  ],
  argTypes: {
    state: {
      control: "inline-radio",
      options: ["sealed", "encrypting"],
    },
    remove: { action: "remove" },
  },
  args: {
    name: "lease.pdf",
    ext: null,
    state: "sealed",
    removeable: true,
  },
  render: (args) => ({
    props: args,
    template: `<cog-attach-chip [name]="name" [ext]="ext" [state]="state" [removeable]="removeable" (remove)="remove($event)" />`,
  }),
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const Sealed: Story = {};
export const Encrypting: Story = { args: { state: "encrypting", removeable: false, name: "rent-ledger.csv" } };
