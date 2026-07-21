#!/usr/bin/env node
// Post-build analytics verification (docs/specs/product-analytics.md §10):
//  (a) the production build carries the Plausible script tag + queue shim,
//  (b) the built homepage carries data-track attributes on the key CTAs,
//  (c) grep guardrail: `plausible.io` appears in src/ only in the two
//      files allowed to know about the vendor.
// Plain Node, no dependencies. Run `pnpm build` first.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(webRoot, 'dist');
const srcDir = join(webRoot, 'src');
const frontendRoot = join(webRoot, '..', 'frontend');

const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${message}`);
};

if (!existsSync(distDir)) {
  console.error('dist/ not found — run `pnpm --filter @cognos/web build` first.');
  process.exit(1);
}

// (a) Plausible script tag + queue shim in the built homepage.
const indexHtml = readFileSync(join(distDir, 'index.html'), 'utf8');
check(
  indexHtml.includes('https://plausible.io/js/script.js') &&
    indexHtml.includes('data-domain="cognos.io"'),
  'dist/index.html contains the Plausible script tag',
);
check(
  indexHtml.includes('window.plausible.q = window.plausible.q || []'),
  'dist/index.html contains the queue shim',
);

// (b) data-track attributes on the key CTAs.
check(
  indexHtml.includes('data-track="cta_click"') &&
    indexHtml.includes('data-track-location="hero"') &&
    indexHtml.includes('data-track-location="navbar"'),
  'dist/index.html tracks the hero and navbar CTAs',
);

// (c) Grep guardrail: vendor string confined to the two adapter files.
const allowed = new Set(['src/lib/analytics.ts', 'src/layouts/BaseLayout.astro']);
const offenders = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walk(path);
    } else if (readFileSync(path, 'utf8').includes('plausible.io')) {
      const rel = relative(webRoot, path);
      if (!allowed.has(rel)) offenders.push(rel);
    }
  }
};
walk(srcDir);
check(
  offenders.length === 0,
  `"plausible.io" appears in src/ only in the allowed files${
    offenders.length ? ` (offenders: ${offenders.join(', ')})` : ''
  }`,
);

// (d) App analytics stays fail-closed until the external Plausible site/goals
// and live event smoke are evidenced in docs/operations/analytics-dashboard.md.
const productionEnvironment = readFileSync(
  join(frontendRoot, 'src/environments/environment.ts'),
  'utf8',
);
const appHeaders = readFileSync(join(frontendRoot, 'src/_headers'), 'utf8');
check(
  /analytics:\s*\{\s*enabled:\s*false,/.test(productionEnvironment),
  'app production analytics is disabled pending the external enablement gate',
);
check(
  !appHeaders.match(/connect-src[^;]*https:\/\/plausible\.io/),
  'app CSP does not allow Plausible while app analytics is disabled',
);

if (failures.length > 0) {
  console.error(`\n${failures.length} analytics check(s) failed.`);
  process.exit(1);
}
console.log('\nAll analytics checks passed.');
