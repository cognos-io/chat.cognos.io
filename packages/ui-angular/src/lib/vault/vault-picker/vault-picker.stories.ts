import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import { STORY_VAULT_FILES } from "../../extension-story-data";

import { CognosVaultPickerComponent } from "./vault-picker.component";

type StoryArgs = {
  attach: (ids: string[]) => void;
  close: (event?: unknown) => void;
  files: typeof STORY_VAULT_FILES;
  initialSelected: string[];
};

const meta: Meta<StoryArgs> = {
  title: "Extension/Vault/Vault Picker",
  decorators: [moduleMetadata({ imports: [CognosVaultPickerComponent] })],
  parameters: {
    layout: "fullscreen",
  },
  argTypes: {
    files: { control: "object" },
    initialSelected: { control: "object" },
    attach: { action: "attach" },
    close: { action: "close" },
  },
  args: {
    files: STORY_VAULT_FILES,
    initialSelected: ["v1", "v2"],
  },
  render: (args) => ({
    props: args,
    template: `<cog-vault-picker [files]="files" [initialSelected]="initialSelected" (attach)="attach($event)" (close)="close($event)" />`,
  }),
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const Default: Story = {};
