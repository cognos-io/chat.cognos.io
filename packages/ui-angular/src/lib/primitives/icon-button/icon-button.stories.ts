import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import {
  CognosIconButtonComponent,
  type CognosIconButtonSize,
} from "./icon-button.component";

type StoryArgs = {
  name: "plus" | "settings" | "copy" | "menu";
  selected: boolean;
  size: CognosIconButtonSize;
  title: string;
};

const meta: Meta<StoryArgs> = {
  title: "Primitives/Icon Button",
  decorators: [
    moduleMetadata({
      imports: [CognosIconButtonComponent],
    }),
  ],
  args: {
    name: "settings",
    selected: false,
    size: "md",
    title: "Settings",
  },
  render: (args) => ({
    props: args,
    template: `
      <cog-icon-button
        [name]="name"
        [selected]="selected"
        [size]="size"
        [title]="title"
      />
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

export const Large: Story = {
  args: {
    name: "menu",
    size: "lg",
    title: "Open navigation",
  },
};
