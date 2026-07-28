// Run with: node --test scripts/
//
// The script rewrites files in place during pre-commit, so its scope needs to be
// pinned. The rules it enforces are prose rules; a hyphen in a Go comment is not
// an improvement, and churn in code files pollutes unrelated commits.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'remove-ai-slop.mjs');
// Escapes, never literals: this file is itself staged, so a literal em dash or
// zero-width character here would be rewritten by the very script under test.
const EM_DASH = '\u2014';
const ZERO_WIDTH = '\u200B';

/** Write `content` to `name` in a fresh temp dir, run the script over it, and
 *  return the exit status plus the file as the script left it. */
function run(name, content, ...flags) {
  const path = join(mkdtempSync(join(tmpdir(), 'slop-')), name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  const result = spawnSync('node', [SCRIPT, ...flags, path], { encoding: 'utf8' });
  return { status: result.status, text: readFileSync(path, 'utf8'), stderr: result.stderr };
}

test('em dashes are rewritten in English prose', () => {
  const md = run('doc.md', `A sentence ${EM_DASH} with an em dash.\n`);
  assert.equal(md.text, 'A sentence - with an em dash.\n');

  const en = run('i18n/en.json', `{"a":"one ${EM_DASH} two"}\n`);
  assert.equal(en.text, '{"a":"one - two"}\n');
});

test('em dashes are left alone outside English prose', () => {
  // Code comments and translated catalogues are not ours to restyle: rewriting
  // them churns unrelated files into whatever commit happens to touch them.
  for (const [name, body] of [
    ['handler.go', `// A comment ${EM_DASH} with an em dash.\n`],
    ['app.ts', `// A comment ${EM_DASH} with an em dash.\n`],
    ['i18n/de.json', `{"a":"eins ${EM_DASH} zwei"}\n`],
  ]) {
    assert.equal(run(name, body).text, body, name);
  }
});

test('zero-width characters are stripped everywhere', () => {
  // Unlike the em dash this is not a style rule. Invisible characters survive
  // review and are a watermarking vector, so every text file is in scope.
  for (const name of ['handler.go', 'doc.md', 'i18n/de.json', 'style.css']) {
    assert.equal(run(name, `before${ZERO_WIDTH}after\n`).text, 'beforeafter\n', name);
  }
});

test('--invisible-only strips zero-width and nothing else', () => {
  const result = run('doc.md', `Dash ${EM_DASH} and${ZERO_WIDTH} space.\n`, '--invisible-only');
  assert.equal(result.text, `Dash ${EM_DASH} and space.\n`);
  assert.equal(result.status, 0);
});

test('--invisible-only never fails on phrasing', () => {
  const result = run('doc.md', 'It is worth noting that we leverage this.\n', '--invisible-only');
  assert.equal(result.status, 0);
});

test('phrasing failures are reported for English prose only', () => {
  const md = run('doc.md', 'It is worth noting that this is robust.\n');
  assert.equal(md.status, 1);
  assert.match(md.stderr, /filler opener/);

  // Pin: code comments legitimately phrase things that read as filler in
  // marketing copy, so they are deliberately out of scope.
  assert.equal(run('handler.go', '// It is worth noting that this is robust.\n').status, 0);
});
