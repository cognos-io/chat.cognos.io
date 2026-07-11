import fc from 'fast-check';
import { strToU8, zipSync } from 'fflate';

import {
  extractConversationJsonFiles,
  inspectZip,
  validateZipPath,
} from './zip-archive';

describe('ZIP archive boundary', () => {
  it.each([
    '../secret',
    'a/../../secret',
    '/absolute',
    'C:/drive',
    '\\\\server',
    'a\\b',
  ])('rejects unsafe path %s', (path) => expect(validateZipPath(path)).toBe(false));

  it('allows a safe directory entry', () => {
    expect(validateZipPath('assets/images/')).toBe(true);
  });

  it('accepts and streams only conversation JSON', async () => {
    const archive = zipSync({
      'conversations.json': strToU8('[{"synthetic":true}]'),
      'account.json': strToU8('{"ignored":true}'),
    });

    expect(inspectZip(archive).map((entry) => entry.name)).toEqual([
      'conversations.json',
      'account.json',
    ]);
    await expect(extractConversationJsonFiles(archive)).resolves.toEqual([
      '[{"synthetic":true}]',
    ]);
  });

  it('never accepts a path that normalises outside the archive root', () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { minLength: 1, maxLength: 8 }), (parts) => {
        const path = parts.join('/');
        if (validateZipPath(path)) {
          expect(path.split('/')).not.toContain('..');
          expect(path).not.toMatch(/^\/?[a-zA-Z]:|^\//);
        }
      }),
    );
  });

  it('rejects arbitrary bytes without an uncaught exception type', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 2_048 }), (bytes) => {
        try {
          inspectZip(bytes);
        } catch (error) {
          expect(error).toMatchObject({ name: 'ImportParseError' });
        }
      }),
    );
  });
});
