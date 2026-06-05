import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import { STORY_VAULT_FILES } from "../../extension-story-data";
import type { CognosVaultFile } from "../vault.types";

import { CognosVaultListRowComponent } from "./vault-list-row.component";

type StoryArgs = {
  file: CognosVaultFile;
  more: (event?: unknown) => void;
  open: (event?: unknown) => void;
  top: boolean;
};

const meta: Meta<StoryArgs> = {
  title: "Extension/Vault/Vault List Row",
  decorators: [moduleMetadata({ imports: [CognosVaultListRowComponent] })],
  argTypes: {
    file: { control: "object" },
    more: { action: "more" },
    open: { action: "open" },
  },
  args: {
    file: STORY_VAULT_FILES[1],
    top: false,
  },
  render: (args) => ({
    props: args,
    template: `<div style="width:720px; border:1px solid var(--cog-border); border-radius:var(--cog-radius-md); overflow:hidden; background:var(--cog-surface);"><cog-vault-list-row [file]="file" [top]="top" (open)="open($event)" (more)="more($event)" /></div>`,
  }),
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const Default: Story = {};
export const WithTopDivider: Story = { args: { top: true } };
export const ImageFile: Story = { args: { file: STORY_VAULT_FILES[2] } };
