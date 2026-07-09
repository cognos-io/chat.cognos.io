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

  it('filters weak lowercase compromise false positives', async () => {
    await expect(detectNlpEntities('den')).resolves.toEqual([]);
    await expect(detectNlpEntities('gen und')).resolves.toEqual([]);
    await expect(detectNlpEntities('nur')).resolves.toEqual([]);
    await expect(detectNlpEntities('darin')).resolves.toEqual([]);
    await expect(detectNlpEntities('co-')).resolves.toEqual([]);
    await expect(detectNlpEntities('ernst nehmen')).resolves.toEqual([]);

    await expect(detectNlpEntities('Jane Doe')).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'person',
          value: 'Jane Doe',
        }),
      ]),
    );
  });
});
