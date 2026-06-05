import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import { CognosAttachChipComponent } from "./attach-chip/attach-chip.component";
import { CognosAudioNoteComponent } from "./audio-note/audio-note.component";
import { CognosDocAttachmentComponent } from "./doc-attachment/doc-attachment.component";
import { CognosDropzoneComponent } from "./dropzone/dropzone.component";
import { CognosFileBadgeComponent } from "./file-badge/file-badge.component";
import { CognosProgressComponent } from "./progress/progress.component";
import { CognosUploadRowComponent } from "./upload-row/upload-row.component";

const meta: Meta = {
  title: "Extension/Files/Overview",
  decorators: [
    moduleMetadata({
      imports: [
        CognosAttachChipComponent,
        CognosAudioNoteComponent,
        CognosDocAttachmentComponent,
        CognosDropzoneComponent,
        CognosFileBadgeComponent,
        CognosProgressComponent,
        CognosUploadRowComponent,
      ],
    }),
  ],
};

export default meta;
type Story = StoryObj;

export const Showcase: Story = {
  render: () => ({
    template: `
      <div style="display:grid; gap:24px; width:100%; max-width:840px; color:var(--cog-text);">
        <section style="display:flex; gap:12px; flex-wrap:wrap; align-items:center;">
          <cog-file-badge ext="pdf" />
          <cog-file-badge ext="csv" [size]="30" [radius]="4" />
          <cog-file-badge ext="jpg" [size]="44" [radius]="4" />
        </section>
        <section style="display:grid; gap:10px; max-width:320px;"><cog-progress [value]="42" /><cog-progress [indeterminate]="true" /></section>
        <section style="display:grid; gap:12px; max-width:320px;"><cog-doc-attachment name="Procurement-2026.pdf" size="2.4 MB" meta="PDF · 18 pages" /><cog-doc-attachment name="Tenancy-agreement.pdf" [state]="'encrypting'" [progress]="67" /></section>
        <section style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;"><cog-attach-chip name="lease.pdf" [removeable]="true" /><cog-attach-chip name="rent-ledger.csv" [state]="'encrypting'" /></section>
        <section style="max-width:520px;"><cog-dropzone /></section>
        <section style="display:grid; gap:10px; max-width:420px;"><cog-upload-row name="Tenancy-agreement.pdf" [progress]="42" [cancellable]="true" /><cog-upload-row name="Passport-scan.jpg" [progress]="100" [done]="true" /></section>
        <section style="max-width:320px;"><cog-audio-note duration="0:42" /></section>
      </div>
    `,
  }),
};
