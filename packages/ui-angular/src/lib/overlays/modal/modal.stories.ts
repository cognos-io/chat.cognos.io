import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";
import type { CognosIconName } from "@cognos/ui/icons";

import { CognosButtonComponent } from "../../button/button.component";
import {
  CognosModalComponent,
  type CognosModalTitleTone,
} from "./modal.component";

type StoryArgs = {
  open: boolean;
  stickyFooter: boolean;
  title: string;
  titleIcon: CognosIconName | null;
  titleTone: CognosModalTitleTone;
  width: number;
};

const meta: Meta<StoryArgs> = {
  title: "Overlays/Modal",
  decorators: [
    moduleMetadata({
      imports: [CognosButtonComponent, CognosModalComponent],
    }),
  ],
  parameters: {
    layout: "fullscreen",
  },
  argTypes: {
    titleIcon: {
      control: "select",
      options: [null, "shield-x", "lock", "info", "shield-check"],
    },
    titleTone: {
      control: "inline-radio",
      options: ["default", "info", "success", "danger"],
    },
  },
  args: {
    open: true,
    stickyFooter: true,
    title: "Grant decrypt access",
    titleIcon: null,
    titleTone: "default",
    width: 540,
  },
  render: (args) => ({
    props: args,
    template: `
      <cog-modal
        [open]="open"
        [stickyFooter]="stickyFooter"
        [title]="title"
        [titleIcon]="titleIcon"
        [titleTone]="titleTone"
        [width]="width"
      >
        <div style="display:grid; gap:12px; color:var(--cog-text);">
          <p style="margin:0;">Share access with a public key fingerprint, never a raw export.</p>
          <div style="padding:12px; border:1px solid var(--cog-border); border-radius:4px; background:var(--cog-surface-sunken); font-family:var(--cog-font-mono); color:var(--cog-text-subtle);">
            8F1A-22C4-0E17-7B9D
          </div>
        </div>

        <div cogModalFooter>
          <cog-button appearance="subtle">Cancel</cog-button>
          <cog-button appearance="primary">Grant access</cog-button>
        </div>
      </cog-modal>
    `,
  }),
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Default: Story = {};

export const Destructive: Story = {
  args: {
    title: "Shred this file?",
    titleIcon: "shield-x",
    titleTone: "danger",
    width: 460,
  },
};
