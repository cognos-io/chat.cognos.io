#!/usr/bin/env node
//
// Keep the tells of machine-written prose out of the repository.
//
// Three kinds of rule, each with its own scope:
//
//   UNIVERSAL_FIXES delete characters no file should contain. Zero-width
//   characters are invisible, so they survive review, and they are a
//   text-watermarking vector rather than only a style tell. Every text file.
//
//   PROSE_FIXES rewrite characters that are only wrong in prose. An em dash
//   becomes a hyphen in a document; in a Go comment it is nobody's business, and
//   rewriting it churns unrelated files into whatever commit touches them.
//   English prose only.
//
//   CHECKS are phrasings. There is no mechanical rewrite for "it's worth noting
//   that" that leaves a grammatical sentence behind, so these fail the commit
//   and ask a human to rewrite. A hook that rewrites prose just produces its own
//   slop. English prose only.
//
// English prose means markdown and `en.json`: code comments legitimately say
// things that read as filler in marketing copy, and several banned English words
// are ordinary vocabulary in the languages we ship (French "utilise" is just
// "uses").
//
// Runs first in pre-commit, before the formatters: changing a three-byte
// character for a one-byte one changes line lengths, so prettier and rumdl need
// the last word on wrapping.
//
// Lefthook passes the staged file list, in two jobs: `--invisible-only` over
// every file, then the full pass over prose. Safe to run by hand over
// everything, since the scoping is enforced here rather than by the glob:
//   node scripts/remove-ai-slop.mjs $(git ls-files)
//
// Tests: node --test scripts/*.test.mjs
//
// To land a deliberate exception, commit with --no-verify and say why in the
// commit message.
import { readFileSync, statSync, writeFileSync } from 'node:fs';

// ---------------------------------------------------------------- fixes ------

const UNIVERSAL_FIXES = [
  {
    name: 'zero-width character',
    // ZWSP, ZWNJ, ZWJ, word joiner, ZWNBSP/BOM. These are invisible, so they
    // survive review, and they are a real text-watermarking vector rather than
    // only a style tell.
    //
    // ZWJ (U+200D) is load-bearing in emoji sequences (a family emoji is a ZWJ
    // chain) and ZWNJ (U+200C) is load-bearing in Persian, Arabic and Hindi. We
    // ship code plus six Latin-script European languages and have none of
    // either, so stripping is safe here. Revisit if that ever changes.
    //
    // Escapes, not literals: this file is itself a staged file, so a literal
    // zero-width character in this class would delete itself.
    find: /[\u200B\u200C\u200D\u2060\uFEFF]/g,
    replace: '',
  },
];

const PROSE_FIXES = [
  {
    name: 'em dash',
    // U+2014. Reads as a signature of generated copy, so we write in a register
    // that does not need it. The en dash (U+2013) is left alone: it is doing
    // real work in ranges like "1-5 people".
    //
    // Prose only. A hyphen is no better than an em dash inside a Go comment or a
    // German catalogue, and rewriting either drags noise into unrelated diffs.
    //
    // Written as an escape, never as the literal character: this file is itself
    // a staged file, so a literal em dash here would be rewritten to a hyphen
    // and quietly turn the rule into a no-op.
    find: /\u2014/g,
    replace: '-',
  },
];

// --------------------------------------------------------------- checks ------

const CHECKS = [
  {
    name: 'filler opener',
    hint: 'Cut it. The sentence almost always reads better starting at the point.',
    // Anchored to the start of a line or a sentence, which is the only place
    // these do damage. "Note that X" mid-paragraph is fine and stays legal.
    pattern:
      /(?:^|[.!?]["')\s]\s*)(it'?s worth noting|it is worth noting|it'?s important to (?:note|remember)|it is important to (?:note|remember)|in today'?s (?:fast-paced |modern )?world|let'?s dive in|at its core|needless to say|simply put|in conclusion|when it comes to)\b/gi,
  },
  {
    name: 'hedging stack',
    hint: 'Two hedges cancel out. Pick one, or state the thing plainly.',
    pattern:
      /\b(?:may|might|could|can)\s+(?:potentially|possibly)\b|\b(?:help|helps|helping)\s+to\s+(?:ensure|enable|facilitate|improve)\b|\b(?:serve|serves)\s+to\s+(?:ensure|provide)\b/gi,
  },
  {
    name: 'not-just construction',
    hint: 'The "not just X, but Y" reveal is the most recognisable AI cadence there is.',
    // Matches the contracted form too: "isn't just a blog, it's a statement".
    pattern:
      /(?:\bnot|n['’]t)\s+just\b[^.!?\n]{0,80}?\b(?:but|it'?s|it is)\b|\bnot only\b[^.!?\n]{0,80}?\bbut also\b/gi,
  },
  {
    name: 'triadic flourish',
    hint: 'Three adjectives in a row is rhythm, not information. Keep the one that matters.',
    // Narrow on purpose: a copular verb, three single words, then a full stop.
    // This catches "The interface is fast, simple, and secure." while leaving
    // ordinary lists like "names, numbers and keys stay hidden" alone.
    pattern:
      /\b(?:is|are|was|were|feel|feels|look|looks|become|becomes|remain|remains)\s+\w+,\s+\w+,?\s+and\s+\w+\s*[.!?]/gi,
  },
  {
    name: 'banned word',
    hint: 'Say what it does instead.',
    pattern:
      /\b(?:leverage[sd]?|leveraging|utili[sz]e[sd]?|utili[sz]ing|seamless(?:ly)?|robust|delve[sd]?|delving|tapestry|cutting[- ]edge|game[- ]chang(?:er|ing)|supercharge[sd]?)\b/gi,
  },
];

// ----------------------------------------------------------------- files -----

const EXCLUDED = [
  /^ai\//,
  /^\.claude\//,
  /^\.specify\//,
  /^\.cursor\//,
  /^docs\/checkpoints\//,
];

/**
 * Prose we hold to the phrasing rules: the docs, and the English catalogues only.
 *
 * The patterns are English, and several collide with ordinary words in the
 * languages we ship - French "utilise" and Portuguese "utiliza" are just "uses",
 * not the banned English verb. So translated copy is deliberately out of scope;
 * a slop phrase that survives translation is a translator's call, not a regex's.
 */
function isEnglishProse(path) {
  if (EXCLUDED.some((re) => re.test(path))) return false;
  if (path.endsWith('.md')) return true;
  return path.includes('/i18n/') && /(?:^|\/)en\.json$/.test(path);
}

function isText(path) {
  try {
    if (!statSync(path).isFile()) return false;
  } catch {
    return false; // Removed by an earlier hook.
  }
  // A NUL byte in the first chunk is the same heuristic `grep -I` uses.
  const head = readFileSync(path).subarray(0, 8000);
  return !head.includes(0);
}

/**
 * Line numbers of fenced code blocks in markdown, so a command containing a
 * banned word in a code sample does not fail the commit.
 */
function fencedLines(path, lines) {
  if (!path.endsWith('.md')) return new Set();
  const fenced = new Set();
  let open = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      open = !open;
      fenced.add(i);
    } else if (open) {
      fenced.add(i);
    }
  });
  return fenced;
}

// ------------------------------------------------------------------ run ------

// --invisible-only runs the universal pass and nothing else, so the pre-commit
// hook can sweep every staged file for invisible characters without applying
// prose rules to code.
const args = process.argv.slice(2);
const invisibleOnly = args.includes('--invisible-only');
const paths = args.filter((arg) => !arg.startsWith('--')).filter(isText);
let fixedFiles = 0;
const violations = [];

for (const path of paths) {
  const original = readFileSync(path, 'utf8');
  const prose = !invisibleOnly && isEnglishProse(path);

  let text = original;
  const applied = [];
  for (const fix of prose ? [...UNIVERSAL_FIXES, ...PROSE_FIXES] : UNIVERSAL_FIXES) {
    const next = text.replace(fix.find, fix.replace);
    if (next !== text) applied.push(fix.name);
    text = next;
  }
  if (text !== original) {
    writeFileSync(path, text, 'utf8');
    console.log(`  fixed ${path} (${applied.join(', ')})`);
    fixedFiles += 1;
  }

  if (!prose) continue;

  const lines = text.split('\n');
  const fenced = fencedLines(path, lines);
  lines.forEach((line, i) => {
    if (fenced.has(i)) return;
    for (const check of CHECKS) {
      for (const match of line.matchAll(check.pattern)) {
        violations.push({
          path,
          line: i + 1,
          rule: check.name,
          hint: check.hint,
          text: (match[1] ?? match[0]).trim(),
        });
      }
    }
  });
}

if (fixedFiles === 0) console.log('  no characters to fix');

if (violations.length > 0) {
  console.error(
    `\n  ${violations.length} phrasing problem(s) - rewrite these, they are not auto-fixable:\n`,
  );
  const byRule = new Map();
  for (const v of violations) {
    console.error(`    ${v.path}:${v.line}  ${v.rule}: "${v.text}"`);
    byRule.set(v.rule, v.hint);
  }
  console.error('');
  for (const [rule, hint] of byRule) console.error(`    ${rule} - ${hint}`);
  console.error(
    '\n  A deliberate exception needs --no-verify and a note in the commit message.\n',
  );
  process.exit(1);
}

console.log('  no slop phrasing found');
