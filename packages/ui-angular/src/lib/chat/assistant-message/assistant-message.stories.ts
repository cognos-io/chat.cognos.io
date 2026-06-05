import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import { CognosAssistantMessageComponent } from "./assistant-message.component";

type StoryArgs = {
  encrypted: boolean;
  model: string;
  sources: number;
  time: string;
  typing: boolean;
};

const meta: Meta<StoryArgs> = {
  title: "Chat/Assistant Message",
  decorators: [
    moduleMetadata({
      imports: [CognosAssistantMessageComponent],
    }),
  ],
  parameters: {
    layout: "padded",
  },
  args: {
    encrypted: true,
    model: "Swiss Cloud",
    sources: 3,
    time: "14:33",
    typing: false,
  },
  render: (args) => ({
    props: args,
    template: `
      <div style="width:100%; max-width:760px;">
        <cog-assistant-message
          [encrypted]="encrypted"
          [model]="model"
          [sources]="sources"
          [time]="time"
          [typing]="typing"
        >
          The latest policy requires regional data residency for uploaded documents. Swiss Cloud satisfies that, but third-party connectors still need legal review.
        </cog-assistant-message>
      </div>
    `,
  }),
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Default: Story = {};

export const Typing: Story = {
  args: {
    sources: 0,
    typing: true,
  },
};
