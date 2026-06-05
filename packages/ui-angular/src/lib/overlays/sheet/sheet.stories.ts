import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import { CognosButtonComponent } from "../../button/button.component";
import { CognosSheetComponent } from "./sheet.component";

type StoryArgs = {
  full: boolean;
  open: boolean;
  stickyFooter: boolean;
  title: string;
};

const meta: Meta<StoryArgs> = {
  title: "Overlays/Sheet",
  decorators: [
    moduleMetadata({
      imports: [CognosButtonComponent, CognosSheetComponent],
    }),
  ],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    full: false,
    open: true,
    stickyFooter: true,
    title: "Grant decrypt access",
  },
  render: (args) => ({
    props: args,
    template: `
      <cog-sheet [full]="full" [open]="open" [stickyFooter]="stickyFooter" [title]="title">
        <div style="display:grid; gap:12px; color:var(--cog-text);">
          <p style="margin:0;">Invite a teammate with their public key fingerprint.</p>
          <p style="margin:0; color:var(--cog-text-subtle);">Access can be revoked at any time.</p>
        </div>

        <div cogSheetFooter style="display:flex; justify-content:flex-end; gap:8px;">
          <cog-button appearance="subtle">Cancel</cog-button>
          <cog-button appearance="primary">Grant access</cog-button>
        </div>
      </cog-sheet>
    `,
  }),
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Default: Story = {};

export const Full: Story = {
  args: {
    full: true,
    title: "Security details",
  },
};
