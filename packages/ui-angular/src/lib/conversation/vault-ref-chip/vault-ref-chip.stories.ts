import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import { STORY_VAULT_FILES } from "../../extension-story-data";
import type { CognosVaultFile } from "../../vault/vault.types";

import { CognosVaultRefChipComponent } from "./vault-ref-chip.component";

type StoryArgs = {
  clear: (event?: unknown) => void;
  clearable: boolean;
  expandable: boolean;
  files: CognosVaultFile[];
};

const meta: Meta<StoryArgs> = {
  title: "Extension/Conversation/Vault Ref Chip",
  decorators: [moduleMetadata({ imports: [CognosVaultRefChipComponent] })],
  argTypes: {
    files: { control: "object" },
    clear: { action: "clear" },
  },
  args: {
    files: [STORY_VAULT_FILES[0]],
    clearable: true,
    expandable: true,
  },
  render: (args) => ({
    props: args,
    template: `<cog-vault-ref-chip [files]="files" [clearable]="clearable" [expandable]="expandable" (clear)="clear($event)" />`,
  }),
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const SingleFile: Story = {};
export const MultipleFiles: Story = { args: { files: [STORY_VAULT_FILES[0], STORY_VAULT_FILES[1]] } };
