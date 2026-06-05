import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import { STORY_VAULT_FILES } from "../../extension-story-data";
import type { CognosVaultFile } from "../vault.types";

import { CognosVaultCardComponent } from "./vault-card.component";

type StoryArgs = {
  file: CognosVaultFile;
  more: (event?: unknown) => void;
  open: (event?: unknown) => void;
  selectable: boolean;
  selected: boolean;
  toggle: (event?: unknown) => void;
};

const meta: Meta<StoryArgs> = {
  title: "Extension/Vault/Vault Card",
  decorators: [moduleMetadata({ imports: [CognosVaultCardComponent] })],
  argTypes: {
    file: { control: "object" },
    more: { action: "more" },
    open: { action: "open" },
    toggle: { action: "toggle" },
  },
  args: {
    file: STORY_VAULT_FILES[0],
    selectable: false,
    selected: false,
  },
  render: (args) => ({
    props: args,
    template: `<div style="width:240px;"><cog-vault-card [file]="file" [selectable]="selectable" [selected]="selected" (open)="open($event)" (more)="more($event)" (toggle)="toggle($event)" /></div>`,
  }),
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const Default: Story = {};
export const Selectable: Story = { args: { selectable: true } };
export const Selected: Story = { args: { selectable: true, selected: true } };
export const ImageFile: Story = { args: { file: STORY_VAULT_FILES[2] } };
