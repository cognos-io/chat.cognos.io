import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import { STORY_VAULT_FILES } from "../../extension-story-data";
import type { CognosVaultFile } from "../../vault/vault.types";

import { CognosSourceCardComponent } from "./source-card.component";

type StoryArgs = {
  clickable: boolean;
  file: CognosVaultFile;
  locator: string;
  open: (event?: unknown) => void;
  quote: string;
};

const meta: Meta<StoryArgs> = {
  title: "Extension/Conversation/Source Card",
  decorators: [moduleMetadata({ imports: [CognosSourceCardComponent] })],
  argTypes: {
    file: { control: "object" },
    open: { action: "open" },
  },
  args: {
    file: STORY_VAULT_FILES[0],
    locator: "p. 4",
    quote: "The agreement requires thirty days' notice before termination.",
    clickable: true,
  },
  render: (args) => ({
    props: args,
    template: `<div style="width:520px;"><cog-source-card [file]="file" [locator]="locator" [quote]="quote" [clickable]="clickable" (open)="open($event)" /></div>`,
  }),
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const Default: Story = {};
export const WithoutQuote: Story = { args: { quote: "" } };
