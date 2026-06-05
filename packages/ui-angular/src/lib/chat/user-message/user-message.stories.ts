import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import { CognosUserMessageComponent } from "./user-message.component";

type StoryArgs = {
  meta: string;
  securing: boolean;
};

const meta: Meta<StoryArgs> = {
  title: "Chat/User Message",
  decorators: [
    moduleMetadata({
      imports: [CognosUserMessageComponent],
    }),
  ],
  parameters: {
    layout: "padded",
  },
  args: {
    meta: "Encrypted · 14:32",
    securing: false,
  },
  render: (args) => ({
    props: args,
    template: `
      <div style="width:100%; max-width:760px;">
        <cog-user-message [meta]="meta" [securing]="securing">
          Summarise the latest procurement changes and call out anything that affects Swiss hosting.
        </cog-user-message>
      </div>
    `,
  }),
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Default: Story = {};

export const Securing: Story = {
  args: {
    securing: true,
  },
};
