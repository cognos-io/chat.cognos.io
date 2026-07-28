#!/usr/bin/env node
// Post-build verification of the markdown twins and the llms.txt indexes
// (https://llmstxt.org/):
//  (a) every page in the sitemap has a `.md` twin, in every locale - so a new
//      page cannot ship without one,
//  (b) every `.md` link in each llms.txt resolves to a file that was built,
//      and points at that index's own locale,
//  (c) no twin leaks an untranslated catalogue key or a surviving HTML tag,
//  (d) each twin's front matter names the URL it mirrors.
// Plain Node, no dependencies. Run `pnpm build` first.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(webRoot, 'dist');
const origin = 'https://cognos.io';
const locales = ['en', 'de', 'fr', 'es', 'pt', 'it'];

const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${message}`);
};

if (!existsSync(distDir)) {
  console.error('dist/ not found - run `pnpm --filter @cognos/web build` first.');
  process.exit(1);
}

/**
 * The dist-relative file a page URL's markdown twin should live at. A homepage
 * has no `.md` of its own, so `/` and `/de/` become `/index.md` and
 * `/de/index.md`.
 */
function twinFile(url) {
  const path = url.replace(origin, '').replace(/\/$/, '');
  const isHome = path === '' || locales.includes(path.slice(1));
  return `${isHome ? `${path}/index` : path}.md`;
}

/** The locale a dist-relative path belongs to (`/de/terms.md` → `de`). */
function localeOf(path) {
  const [, first] = path.split('/');
  return locales.includes(first) ? first : 'en';
}

// -- (a) every page in the sitemap has a twin --------------------------------
// The sitemap is generated independently of `md-routes.ts`, so it is a real
// cross-check: a page added without a markdown route fails here.

const sitemapFiles = readdirSync(distDir).filter((name) => /^sitemap-\d+\.xml$/.test(name));
check(sitemapFiles.length > 0, 'a sitemap was generated');

const pageUrls = sitemapFiles
  .flatMap((name) => [...readFileSync(join(distDir, name), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)])
  .map((match) => match[1])
  // The feeds are in neither the sitemap's remit nor ours.
  .filter((url) => !url.endsWith('rss.xml'));

check(pageUrls.length >= 6 * 40, `sitemap lists ${pageUrls.length} pages`);

const missingTwins = pageUrls.filter((url) => !existsSync(join(distDir, twinFile(url))));
check(
  missingTwins.length === 0,
  missingTwins.length === 0
    ? 'every page in the sitemap has a .md twin'
    : `pages with no .md twin: ${missingTwins.slice(0, 5).join(', ')}`,
);

// Every locale should carry the same number of twins - a page wired up for
// English only would otherwise pass unnoticed.
const twins = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // `public/` ships its own READMEs; they are assets, not page twins.
      if (entry === 'docs-media' || entry === 'blog-media') continue;
      walk(full);
    } else if (entry.endsWith('.md')) {
      twins.push(`/${relative(distDir, full)}`);
    }
  }
};
walk(distDir);

const perLocale = Object.fromEntries(
  locales.map((lang) => [lang, twins.filter((path) => localeOf(path) === lang).length]),
);
const counts = new Set(Object.values(perLocale));
check(
  counts.size === 1,
  counts.size === 1
    ? `all six locales carry ${perLocale.en} twins each`
    : `locales disagree on twin count: ${JSON.stringify(perLocale)}`,
);

// -- (b) the indexes ---------------------------------------------------------

for (const lang of locales) {
  const prefix = lang === 'en' ? '' : `/${lang}`;
  for (const name of ['llms.txt', 'llms-full.txt']) {
    const file = join(distDir, `${prefix}/${name}`);
    check(existsSync(file), `${prefix}/${name} was built`);
    if (!existsSync(file)) continue;

    const body = readFileSync(file, 'utf8');
    check(body.startsWith('# Cognos'), `${prefix}/${name} opens with an H1 name`);
    check(/^> \S/m.test(body), `${prefix}/${name} carries a blockquote summary`);
  }

  const indexFile = join(distDir, `${prefix}/llms.txt`);
  if (!existsSync(indexFile)) continue;
  const index = readFileSync(indexFile, 'utf8');

  const links = [...index.matchAll(/\]\((https:\/\/[^)]+\.md)\)/g)].map((match) => match[1]);
  check(links.length >= 40, `${prefix}/llms.txt lists ${links.length} pages`);

  const broken = links.filter((url) => !existsSync(join(distDir, url.replace(origin, ''))));
  check(
    broken.length === 0,
    broken.length === 0
      ? `${prefix}/llms.txt links only to files that were built`
      : `${prefix}/llms.txt has ${broken.length} dead links (${broken[0]})`,
  );

  const crossLocale = links.filter((url) => localeOf(url.replace(origin, '')) !== lang);
  check(
    crossLocale.length === 0,
    crossLocale.length === 0
      ? `${prefix}/llms.txt stays in its own locale`
      : `${prefix}/llms.txt links out of locale (${crossLocale[0]})`,
  );

  check(
    index.includes('## Optional'),
    `${prefix}/llms.txt has the spec's Optional section`,
  );
}

// -- (c) and (d) the twins themselves ----------------------------------------

// A key that was never translated renders as the key itself (`useTranslations`
// falls back to English, then to the key). In markdown that is invisible unless
// something looks for it.
const keyLeak =
  /(^|[^\w./-])(pages|docs|blog|hero|audience|contrast|features|security|how|redaction|meta|nav|footer|a11y)\.[a-z][\w.]*/i;
// Inline HTML is converted, not passed through; a tag here means an unhandled one.
const htmlTag = /<\/?[a-z][a-z0-9]*(\s[^<>]*)?>/i;

const leaked = [];
const tagged = [];
const badFront = [];

for (const path of twins) {
  const body = readFileSync(join(distDir, path), 'utf8');

  const keyMatch = keyLeak.exec(body);
  if (keyMatch) leaked.push(`${path}: ${keyMatch[0].trim()}`);

  const tagMatch = htmlTag.exec(body);
  if (tagMatch) tagged.push(`${path}: ${tagMatch[0]}`);

  const front = /^---\n([\s\S]*?)\n---\n/.exec(body);
  if (!front) {
    badFront.push(`${path}: no front matter`);
    continue;
  }
  const source = /^source: "([^"]+)"$/m.exec(front[1]);
  const title = /^title: "([^"]*[^"\s][^"]*)"$/m.exec(front[1]);
  if (!title) badFront.push(`${path}: no title`);
  if (!source) {
    badFront.push(`${path}: no source URL`);
    continue;
  }
  // The twin must name the page it mirrors, not another one.
  const expected = twinFile(source[1]);
  if (expected !== path) badFront.push(`${path}: source says ${source[1]}`);
}

check(
  leaked.length === 0,
  leaked.length === 0
    ? 'no twin leaks an untranslated catalogue key'
    : `catalogue keys leaked into ${leaked.length} twins (${leaked[0]})`,
);
check(
  tagged.length === 0,
  tagged.length === 0
    ? 'no twin carries a surviving HTML tag'
    : `HTML survived into ${tagged.length} twins (${tagged[0]})`,
);
check(
  badFront.length === 0,
  badFront.length === 0
    ? 'every twin names its own source URL in front matter'
    : `front-matter problems in ${badFront.length} twins (${badFront[0]})`,
);

if (failures.length > 0) {
  console.error(`\n${failures.length} llms.txt/markdown check(s) failed.`);
  process.exit(1);
}
console.log('\nAll markdown twin and llms.txt checks passed.');
