import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import { CognosAssistantMessageComponent } from "../assistant-message/assistant-message.component";
import { CognosRedactedTextComponent } from "./redacted-text.component";

type StoryArgs = {
  kind: "name" | "email" | "phone" | "case-id" | "custom";
  label: string;
  placeholder: string;
  showSettings: boolean;
  value: string;
};

const meta: Meta<StoryArgs> = {
  title: "Chat/Redacted Text",
  decorators: [
    moduleMetadata({
      imports: [CognosAssistantMessageComponent, CognosRedactedTextComponent],
    }),
  ],
  parameters: {
    layout: "padded",
  },
  args: {
    kind: "email",
    label: "",
    placeholder: "REDACTED_EMAIL_7A6F",
    showSettings: true,
    value: "l.meyer@example.ch",
  },
  argTypes: {
    kind: {
      control: "select",
      options: ["name", "email", "phone", "case-id", "custom"],
    },
  },
  render: (args) => ({
    props: args,
    template: `
      <div style="width:100%; max-width:820px; display:grid; gap:24px;">
        <p style="margin:0; color:var(--cog-text); font-size:var(--cog-fs-body-lg); line-height:var(--cog-lh-body-lg);">
          Click the highlighted token to explain what was redacted and what the model actually sees:
          <cog-redacted-text
            [kind]="kind"
            [label]="label"
            [placeholder]="placeholder"
            [showSettings]="showSettings"
            [value]="value"
          />
        </p>
      </div>
    `,
  }),
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Default: Story = {};

export const Conversation: Story = {
  render: () => ({
    template: `
      <div style="width:100%; max-width:920px;">
        <cog-assistant-message
          model="Cognos Sovereign"
          time="14:32"
          [showActions]="false"
          [sources]="0"
        >
          <div style="display:grid; gap:14px;">
            <p style="margin:0;">
              Here’s a draft you can send to
              <cog-redacted-text kind="name" value="Laurent Meyer" placeholder="REDACTED_NAME_2C31" />:
            </p>
            <p style="margin:0;">
              Thank you for getting in touch. We’ve logged your request under
              <cog-redacted-text kind="case-id" value="GE-2026-0417" placeholder="REDACTED_CASE_ID_17D0" />
              and will follow up by email at
              <cog-redacted-text kind="email" value="l.meyer@example.ch" placeholder="REDACTED_EMAIL_7A6F" />.
              If anything is urgent, please call
              <cog-redacted-text kind="phone" value="+41 22 555 0143" placeholder="REDACTED_PHONE_510B" />.
            </p>
          </div>
        </cog-assistant-message>
      </div>
    `,
  }),
};
