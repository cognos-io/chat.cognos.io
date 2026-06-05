import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import {
  CognosAvatarGroupComponent,
  type CognosAvatarGroupItem,
} from "./avatar-group.component";

type StoryArgs = {
  items: CognosAvatarGroupItem[];
  size: 26 | 28 | 32 | 36 | 40;
};

const meta: Meta<StoryArgs> = {
  title: "Primitives/Avatar Group",
  decorators: [
    moduleMetadata({
      imports: [CognosAvatarGroupComponent],
    }),
  ],
  args: {
    items: [{ name: "Yara" }, { name: "Luca" }, { group: true }],
    size: 32,
  },
  render: (args) => ({
    props: args,
    template: `<cog-avatar-group [items]="items" [size]="size" />`,
  }),
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Default: Story = {};
