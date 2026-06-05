import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import { STORY_VAULT_FILES } from "../extension-story-data";

import { CognosFilterChipsComponent } from "./filter-chips/filter-chips.component";
import { CognosStorageMeterComponent } from "./storage-meter/storage-meter.component";
import { CognosVaultCardComponent } from "./vault-card/vault-card.component";
import { CognosVaultListRowComponent } from "./vault-list-row/vault-list-row.component";
import { CognosVaultPageComponent } from "./vault-page/vault-page.component";

const meta: Meta = {
  title: "Extension/Vault/Overview",
  decorators: [moduleMetadata({ imports: [CognosFilterChipsComponent, CognosStorageMeterComponent, CognosVaultCardComponent, CognosVaultListRowComponent, CognosVaultPageComponent] })],
};

export default meta;
type Story = StoryObj;

export const Showcase: Story = {
  render: () => ({
    props: { files: STORY_VAULT_FILES },
    template: `
      <div style="display:grid; gap:24px; width:100%; max-width:980px; color:var(--cog-text);">
        <section style="display:grid; gap:12px; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items:start;"><cog-vault-card [file]="files[0]" /><cog-vault-card [file]="files[2]" [selectable]="true" [selected]="true" /></section>
        <section style="border:1px solid var(--cog-border); border-radius:var(--cog-radius-md); background:var(--cog-surface); overflow:hidden;"><cog-vault-list-row [file]="files[1]" /><cog-vault-list-row [file]="files[3]" [top]="true" /></section>
        <section style="display:grid; gap:16px; align-items:start;"><cog-storage-meter [width]="'100%'" /><cog-filter-chips value="all" /></section>
        <section><cog-vault-page [files]="files" /></section>
      </div>
    `,
  }),
};
