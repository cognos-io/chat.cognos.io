import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import { CognosMenuComponent, type CognosMenuItem } from "./menu.component";

type StoryArgs = {
  items: CognosMenuItem[];
  label: string;
};

const meta: Meta<StoryArgs> = {
  title: "Overlays/Menu",
  decorators: [
    moduleMetadata({
      imports: [CognosMenuComponent],
    }),
  ],
  parameters: {
    layout: "padded",
  },
  args: {
    label: "Models",
    items: [
      {
        icon: "laptop",
        title: "This device",
        sub: "Private inference on-device",
        selected: true,
      },
      {
        icon: "server",
        title: "On-prem cluster",
        sub: "Pinned to your secure tenancy",
      },
      {
        icon: "cloud",
        title: "Swiss cloud",
        sub: "Regional encrypted compute",
        trailing: "Beta",
      },
    ],
  },
  render: (args) => ({
    props: args,
    template: `<cog-menu [items]="items" [label]="label" />`,
  }),
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Default: Story = {};
