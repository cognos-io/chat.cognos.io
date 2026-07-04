// Shape of a single content block inside a legal-page section. Kept small and
// declarative so the i18n catalogs describe structure (paragraphs, lists, the
// subprocessor table) rather than raw HTML. Inline `<b>`/`<a>` markup inside
// strings is rendered as trusted HTML by `LegalBlock.astro`.
export type LegalBlock =
  | { p: string }
  | { ul: string[] }
  | { table: { head: string[]; rows: string[][] } };

export interface LegalSection {
  heading: string;
  blocks: LegalBlock[];
}
