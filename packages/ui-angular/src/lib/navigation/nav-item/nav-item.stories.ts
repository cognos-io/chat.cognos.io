import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import { CognosNavItemComponent } from "./nav-item.component";

type StoryArgs = {
  expandable: boolean;
  expanded: boolean;
  icon: "folder" | "lock" | "graduation-cap" | "landmark";
  indent: number;
  label: string;
  meta: string;
  pinned: boolean;
  selected: boolean;
};

const meta: Meta<StoryArgs> = {
  title: "Navigation/Nav Item",
  decorators: [
    moduleMetadata({
      imports: [CognosNavItemComponent],
    }),
  ],
  args: {
    expandable: false,
    expanded: false,
    icon: "folder",
    indent: 0,
    label: "Policy review",
    meta: "12",
    pinned: false,
    selected: false,
  },
  render: (args) => ({
    props: args,
    template: `
      <div style="width:280px; background:var(--cog-nav-bg); padding:12px; border:1px solid var(--cog-border); border-radius:8px;">
        <cog-nav-item
          [expandable]="expandable"
          [expanded]="expanded"
          [icon]="icon"
          [indent]="indent"
          [label]="label"
          [meta]="meta"
          [pinned]="pinned"
          [selected]="selected"
        >
          <cog-nav-item label="Data Protection Act — impact" [indent]="1" />
          <cog-nav-item label="Consultation response draft" [indent]="1" />
          <cog-nav-item label="Cross-border data transfer memo" [indent]="1" [pinned]="true" />
        </cog-nav-item>
      </div>
    `,
  }),
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Default: Story = {};

export const Selected: Story = {
  args: {
    selected: true,
  },
};

export const Indented: Story = {
  args: {
    indent: 1,
    label: "Shared with legal",
    pinned: true,
  },
};

export const ExpandedGroup: Story = {
  args: {
    expandable: true,
    expanded: true,
    icon: "landmark",
    label: "Cantonal Policy",
    meta: "",
  },
};

export const CollapsedGroup: Story = {
  args: {
    expandable: true,
    expanded: false,
    icon: "graduation-cap",
    label: "Lycée — Year 11",
    meta: "",
  },
};
