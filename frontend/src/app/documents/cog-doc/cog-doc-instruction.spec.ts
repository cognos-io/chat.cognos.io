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

  it('covers all v1 formats and the optional spec keys', () => {
    expect(COG_DOC_INSTRUCTION).toContain('"docx"');
    expect(COG_DOC_INSTRUCTION).toContain('"pdf"');
    expect(COG_DOC_INSTRUCTION).toContain('"xlsx"');
    for (const key of ['"page"', '"header"', '"footer"', '"lang"']) {
      expect(COG_DOC_INSTRUCTION).toContain(key);
    }
  });

  it('describes the xlsx body as JSON with typed cells and formulas', () => {
    // The xlsx body is sheet-spec JSON, not markdown (spec §6.3) — this is
    // the one clause models most need spelled out, since every other format
    // rule assumes a markdown body.
    expect(COG_DOC_INSTRUCTION).toContain('the body is JSON, not markdown');
    expect(COG_DOC_INSTRUCTION).toContain('"sheets"');
    expect(COG_DOC_INSTRUCTION).toContain('"freezeHeader"');
    expect(COG_DOC_INSTRUCTION).toContain('{"f":"SUM(B2:B2)"}');
    expect(COG_DOC_INSTRUCTION).toContain('never precomputed numbers');
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
