import { describe, expect, it } from 'vitest';

import { detectNlpEntities } from './redaction-detectors-nlp';

describe('detectNlpEntities', () => {
  it('detects people, organisations and places with offsets', async () => {
    const text = 'Alice Smith met Acme Ltd in Zurich.';
    const candidates = await detectNlpEntities(text);

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'person',
          value: 'Alice Smith',
          start: 0,
          end: 11,
        }),
        expect.objectContaining({
          type: 'org',
          value: 'Acme Ltd',
          start: 16,
          end: 24,
        }),
        expect.objectContaining({
          type: 'place',
          value: 'Zurich',
          start: 28,
          end: 34,
        }),
      ]),
    );
  });
});
