#!/usr/bin/env node
// Post-build analytics verification (docs/business_processes/product-analytics.md):
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
  indexHtml.includes('https://plausible.io/js/pa-FxSv3tmVTFctFy6HFBkoB.js'),
  'dist/index.html contains the Plausible script tag',
);
check(
  indexHtml.includes('(plausible.q = plausible.q || []).push(arguments)') &&
    indexHtml.includes('plausible.init()'),
  'dist/index.html contains the queue shim and init',
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

// (d) App production analytics is on and CSP allows only the Events API host.
// Dev/e2e environments stay off (asserted by e2e/tests/analytics.spec.ts).
const productionEnvironment = readFileSync(
  join(frontendRoot, 'src/environments/environment.ts'),
  'utf8',
);
const appHeaders = readFileSync(join(frontendRoot, 'src/_headers'), 'utf8');
check(
  /analytics:\s*\{\s*enabled:\s*true,/.test(productionEnvironment),
  'app production analytics is enabled',
);
check(
  Boolean(appHeaders.match(/connect-src[^;]*https:\/\/plausible\.io/)),
  'app CSP connect-src allows https://plausible.io',
);

if (failures.length > 0) {
  console.error(`\n${failures.length} analytics check(s) failed.`);
  process.exit(1);
}
console.log('\nAll analytics checks passed.');
