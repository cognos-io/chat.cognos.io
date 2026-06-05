import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import { STORY_VAULT_FILES } from "../../extension-story-data";
import type { CognosVaultFile } from "../vault.types";

import { CognosConfirmShredComponent } from "./confirm-shred.component";

type StoryArgs = {
  close: (event?: unknown) => void;
  confirm: (file: CognosVaultFile) => void;
  file: CognosVaultFile;
};

const meta: Meta<StoryArgs> = {
  title: "Extension/Vault/Confirm Shred",
  decorators: [moduleMetadata({ imports: [CognosConfirmShredComponent] })],
  parameters: {
    layout: "fullscreen",
  },
  argTypes: {
    file: { control: "object" },
    close: { action: "close" },
    confirm: { action: "confirm" },
  },
  args: {
    file: STORY_VAULT_FILES[0],
  },
  render: (args) => ({
    props: args,
    template: `<cog-confirm-shred [file]="file" (close)="close($event)" (confirm)="confirm($event)" />`,
  }),
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const Default: Story = {};
export const WithReferences: Story = { args: { file: STORY_VAULT_FILES[1] } };
