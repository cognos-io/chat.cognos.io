import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import { CognosDrawerShowcaseComponent } from "./drawer-showcase/drawer-showcase.component";

type StoryArgs = {
  open: boolean;
  title: string;
};

const meta: Meta<StoryArgs> = {
  title: "Navigation/Drawer",
  decorators: [
    moduleMetadata({
      imports: [CognosDrawerShowcaseComponent],
    }),
  ],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    open: true,
    title: "Cognos",
  },
  render: (args) => ({
    props: args,
    template: `<cog-drawer-showcase [open]="open" [title]="title" />`,
  }),
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Default: Story = {};
