import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import { CognosComposerComponent } from "./composer.component";

type StoryArgs = {
  modelLabel: string;
  placeholder: string;
  sendDisabled: boolean;
  value: string;
};

const meta: Meta<StoryArgs> = {
  title: "Chat/Composer",
  decorators: [
    moduleMetadata({
      imports: [CognosComposerComponent],
    }),
  ],
  parameters: {
    layout: "padded",
  },
  args: {
    modelLabel: "This device",
    placeholder: "Ask Cognos anything secure…",
    sendDisabled: false,
    value: "",
  },
  render: (args) => ({
    props: args,
    template: `
      <div style="width:100%; max-width:760px;">
        <cog-composer
          [modelLabel]="modelLabel"
          [placeholder]="placeholder"
          [sendDisabled]="sendDisabled"
          [value]="value"
        />
      </div>
    `,
  }),
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Default: Story = {};

export const Draft: Story = {
  args: {
    modelLabel: "Swiss cloud",
    value: "Compare the attached policy to last quarter's version.",
  },
};
