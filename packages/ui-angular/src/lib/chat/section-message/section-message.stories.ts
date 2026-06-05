import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import {
  CognosSectionMessageComponent,
  type CognosSectionMessageTone,
} from "./section-message.component";

type StoryArgs = {
  title: string;
  tone: CognosSectionMessageTone;
};

const meta: Meta<StoryArgs> = {
  title: "Chat/Section Message",
  decorators: [
    moduleMetadata({
      imports: [CognosSectionMessageComponent],
    }),
  ],
  args: {
    title: "One honest caveat",
    tone: "info",
  },
  render: (args) => ({
    props: args,
    template: `
      <div style="width:520px;">
        <cog-section-message [title]="title" [tone]="tone">
          Messages are encrypted again immediately after processing and can only be decrypted by authorized clients.
        </cog-section-message>
      </div>
    `,
  }),
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Info: Story = {};

export const Success: Story = {
  args: {
    title: "Visible encryption enabled",
    tone: "success",
  },
};
