import { Component } from "@angular/core";
import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import { STORY_VAULT_FILES } from "../extension-story-data";

import { CognosCodeBlockComponent } from "./code-block/code-block.component";
import { CognosSourceCardComponent } from "./source-card/source-card.component";
import { CognosSourcesRowComponent } from "./sources-row/sources-row.component";
import { CognosVaultRefChipComponent } from "./vault-ref-chip/vault-ref-chip.component";

@Component({
  selector: "story-conversation-overview",
  standalone: true,
  imports: [
    CognosCodeBlockComponent,
    CognosSourceCardComponent,
    CognosSourcesRowComponent,
    CognosVaultRefChipComponent,
  ],
  template: `
    <div style="display:grid; gap:24px; width:100%; max-width:840px; color:var(--cog-text);">
      <cog-code-block lang="typescript" [code]="code" />
      <cog-source-card [file]="files[0]" locator="p. 4" quote="The agreement requires thirty days' notice before termination." [clickable]="true" />
      <cog-sources-row [sources]="sources" [defaultOpen]="true" />
      <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:center;">
        <cog-vault-ref-chip [files]="[files[0]]" [clearable]="true" />
        <cog-vault-ref-chip [files]="[files[0], files[1]]" [clearable]="true" />
      </div>
    </div>
  `,
})
class ConversationOverviewStoryComponent {
  protected readonly files = STORY_VAULT_FILES;
  protected readonly code = `const notify = inject(CognosToastService);\nnotify.notify({ title: 'Saved to Vault' });`;
  protected readonly sources = [
    {
      file: STORY_VAULT_FILES[0],
      locator: "p. 4",
      quote: "The agreement requires thirty days' notice before termination.",
    },
    {
      file: STORY_VAULT_FILES[1],
      locator: "rows 18–24",
      quote: "Monthly payments were made in full during Q1.",
    },
  ];
}

const meta: Meta = {
  title: "Extension/Conversation/Overview",
  decorators: [moduleMetadata({ imports: [ConversationOverviewStoryComponent] })],
};

export default meta;
type Story = StoryObj;

export const Showcase: Story = {
  render: () => ({ template: `<story-conversation-overview />` }),
};
