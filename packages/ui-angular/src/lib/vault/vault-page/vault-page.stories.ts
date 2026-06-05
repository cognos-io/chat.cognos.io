import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import { STORY_VAULT_FILES } from "../../extension-story-data";
import type { CognosStorageSegment, CognosVaultFile } from "../vault.types";

import { CognosVaultPageComponent } from "./vault-page.component";

type StoryArgs = {
  addFiles: (event?: unknown) => void;
  empty: boolean;
  fileMore: (file: CognosVaultFile) => void;
  fileOpen: (file: CognosVaultFile) => void;
  files: CognosVaultFile[];
  filesDropped: (files?: FileList) => void;
  storageSegments: CognosStorageSegment[];
  storageTotal: string;
  storageUsed: string;
};

const meta: Meta<StoryArgs> = {
  title: "Extension/Vault/Vault Page",
  decorators: [moduleMetadata({ imports: [CognosVaultPageComponent] })],
  parameters: {
    layout: "fullscreen",
  },
  argTypes: {
    files: { control: "object" },
    storageSegments: { control: "object" },
    addFiles: { action: "addFiles" },
    filesDropped: { action: "filesDropped" },
    fileOpen: { action: "fileOpen" },
    fileMore: { action: "fileMore" },
  },
  args: {
    files: STORY_VAULT_FILES,
    storageUsed: "1.6 GB",
    storageTotal: "5 GB",
    storageSegments: [
      { label: "Documents", tone: "blue", used: 17 },
      { label: "Images", tone: "purple", used: 9 },
      { label: "Sheets", tone: "green", used: 4 },
      { label: "Audio", tone: "red", used: 2 },
    ],
    empty: false,
  },
  render: (args) => ({
    props: args,
    template: `<div style="padding:24px;"><cog-vault-page [files]="files" [storageUsed]="storageUsed" [storageTotal]="storageTotal" [storageSegments]="storageSegments" [empty]="empty" (addFiles)="addFiles($event)" (filesDropped)="filesDropped($event)" (fileOpen)="fileOpen($event)" (fileMore)="fileMore($event)" /></div>`,
  }),
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const Default: Story = {};
export const Empty: Story = { args: { files: [], empty: true } };
