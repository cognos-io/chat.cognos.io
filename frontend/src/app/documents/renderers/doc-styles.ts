// Shared layout/typography constants for every document renderer (spec
// docs/specs/document-generation.md §7). Kept in one framework-free module so
// docx and pdfmake stay visually consistent and the type scale changes in one
// place. No Angular imports — this module runs inside the render worker as
// well as the main thread.

// Generated files carry no user-identifying metadata (spec §7 metadata
// hygiene): core properties are set to the document title only, and
// creator/producer strings are always this fixed value.
export const DOCUMENT_CREATOR = 'Cognos';

// A4 portrait, 1-inch margins. docx measures layout in twips (1/1440 inch);
// pdfmake measures in points (1/72 inch).
export const PAGE_SIZE_TWIPS = { width: 11906, height: 16838 } as const;
export const PAGE_MARGIN_TWIPS = 1440;
export const USABLE_WIDTH_TWIPS = PAGE_SIZE_TWIPS.width - 2 * PAGE_MARGIN_TWIPS;

export const PAGE_MARGIN_PT: [number, number, number, number] = [72, 72, 72, 72];
// A4 at 72pt/inch, usable width after the left/right margins above.
export const PAGE_WIDTH_PT = 595.28;
export const USABLE_WIDTH_PT = PAGE_WIDTH_PT - PAGE_MARGIN_PT[0] - PAGE_MARGIN_PT[2];

// docx font name for code; pdfmake's standard-14 font family name is
// different casing/spelling, so the two are kept separate.
export const CODE_FONT_DOCX = 'Courier New';
export const CODE_FONT_PDF = 'Courier';

export const CODE_SHADING_FILL = 'F2F2F2';
export const QUOTE_INDENT_TWIPS = 720; // 0.5"

export interface StyleSpec {
  readonly pt: number;
  readonly halfPt: number; // docx `size` options are in half-points
  readonly bold?: boolean;
  readonly italics?: boolean;
  readonly color?: string;
}

// Type scale: pt for pdfmake, half-points for docx. Headings 5-6 reuse the
// Heading4 spec (headingStyleName below caps at 4) — the spec calls for no
// distinct size beyond heading level 4.
export const TYPE_SCALE = {
  Title: { pt: 26, halfPt: 52, bold: true },
  Heading1: { pt: 20, halfPt: 40, bold: true },
  Heading2: { pt: 16, halfPt: 32, bold: true },
  Heading3: { pt: 13, halfPt: 26, bold: true },
  Heading4: { pt: 11, halfPt: 22, bold: true },
  Normal: { pt: 11, halfPt: 22 },
  Quote: { pt: 11, halfPt: 22, italics: true },
  Code: { pt: 10, halfPt: 20 },
  Caption: { pt: 9, halfPt: 18, color: '888888' },
} as const satisfies Record<string, StyleSpec>;

export type HeadingStyleName = 'Heading1' | 'Heading2' | 'Heading3' | 'Heading4';

// Headings 5-6 visually reuse the Heading4 scale.
export const headingStyleName = (level: 1 | 2 | 3 | 4 | 5 | 6): HeadingStyleName =>
  level <= 4 ? (`Heading${level}` as HeadingStyleName) : 'Heading4';

// documentDateRoundedToDay strips time-of-day so generated file metadata
// cannot be used to infer precisely when a user was active (a .docx is a zip
// of XML; its metadata is read by anyone the user sends it to). Returns
// midnight UTC on the same calendar day as `now`.
export const documentDateRoundedToDay = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
