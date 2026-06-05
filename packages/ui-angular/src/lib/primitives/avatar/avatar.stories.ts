import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import { CognosAvatarComponent } from "./avatar.component";

type StoryArgs = {
  group: boolean;
  name: string;
  size: 26 | 28 | 32 | 36 | 40;
};

const meta: Meta<StoryArgs> = {
  title: "Primitives/Avatar",
  decorators: [
    moduleMetadata({
      imports: [CognosAvatarComponent],
    }),
  ],
  args: {
    group: false,
    name: "Ewan Roy",
    size: 32,
  },
  render: (args) => ({
    props: args,
    template: `<cog-avatar [group]="group" [name]="name" [size]="size" />`,
  }),
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Person: Story = {};

export const Group: Story = {
  args: {
    group: true,
    name: "",
  },
};

export const Stack: Story = {
  render: () => ({
    template: `
      <div style="display:flex; align-items:center;">
        <div style="margin-right:-8px;"><cog-avatar name="Ewan Roy" [size]="32" /></div>
        <div style="margin-right:-8px;"><cog-avatar name="Mina Patel" [size]="32" /></div>
        <div><cog-avatar [group]="true" [size]="32" /></div>
      </div>
    `,
  }),
};
