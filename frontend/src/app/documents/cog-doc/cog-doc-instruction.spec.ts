import { describe, expect, it } from 'vitest';

import { COG_DOC_INSTRUCTION } from './cog-doc-instruction';

// Pin tests: the instruction is a wire contract between the prompt and the
// parser. These assert the load-bearing clauses exist, so removing one is a
// conscious decision (and a prompt-cache-busting event), never an accident.
describe('COG_DOC_INSTRUCTION', () => {
  it('shows the exact tag form the parser accepts', () => {
    expect(COG_DOC_INSTRUCTION).toContain("<cog-doc spec='");
    expect(COG_DOC_INSTRUCTION).toContain('</cog-doc>');
    expect(COG_DOC_INSTRUCTION).toContain('no code fence');
  });

  it('covers both v1 formats and the optional spec keys', () => {
    expect(COG_DOC_INSTRUCTION).toContain('"docx"');
    expect(COG_DOC_INSTRUCTION).toContain('"pdf"');
    for (const key of ['"page"', '"header"', '"footer"', '"lang"']) {
      expect(COG_DOC_INSTRUCTION).toContain(key);
    }
  });

  it('requires full-replacement re-emission for document revisions', () => {
    // Round-trip editing ("remove that paragraph", "rewrite the intro")
    // only works if the model re-emits the whole updated document as a new
    // block — a diff or prose description cannot be rendered.
    expect(COG_DOC_INSTRUCTION).toContain('complete updated document');
    expect(COG_DOC_INSTRUCTION).toContain('never a fragment');
  });

  it('scopes usage to explicit file requests', () => {
    expect(COG_DOC_INSTRUCTION).toContain('otherwise answer normally');
  });
});
