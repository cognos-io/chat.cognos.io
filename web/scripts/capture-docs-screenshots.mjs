// Capture the documentation screenshots under public/docs-media/ by driving the
// running app with Playwright (Chromium). Kept in the repo so screenshots can be
// regenerated when the UI changes.
//
// Usage (app must be running, e.g. `just dev`, at $COGNOS_APP_URL or
// https://cognos.local:4200):
//
//   COGNOS_TEST_EMAIL=you@example.com \
//   COGNOS_TEST_PASSWORD='at least 12 chars' \
//   COGNOS_TEST_ACCOUNT_KEY='XXXX-XXXX-...' \
//   node web/scripts/capture-docs-screenshots.mjs [lang ...]
//
// Create the test account once (sign up in the app, save its Account Key). It
// must be email-verified to reach the composer — on a dev DB that is
// `UPDATE users SET verified=1 WHERE email='…'` in backend/pb_data/data.db.
//
// With no lang args it captures every locale (en de fr es pt it). English shots
// go to public/docs-media/; other locales to public/docs-media/<lang>/, and are
// captured in that language (the app is switched after login). Text-selector
// shots (auth cards, the Tools menu, etc.) are English-only and fall back to the
// English shot for other locales — DocsBlock resolves the localised file first.
//
// Playwright is resolved from e2e/'s install so no extra dependency is added.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), '../../e2e/package.json'));
const { chromium } = require('@playwright/test');

const BASE = process.env.COGNOS_APP_URL || 'https://cognos.local:4200';
const EMAIL = process.env.COGNOS_TEST_EMAIL;
const PASSWORD = process.env.COGNOS_TEST_PASSWORD;
const KEY = process.env.COGNOS_TEST_ACCOUNT_KEY;
const MEDIA = join(dirname(fileURLToPath(import.meta.url)), '../public/docs-media');
const ENDONYM = { en: 'English', de: 'Deutsch', fr: 'Français', es: 'Español', pt: 'Português', it: 'Italiano' };
const ALL = ['en', 'de', 'fr', 'es', 'pt', 'it'];

if (!EMAIL || !PASSWORD || !KEY) {
  console.error('Set COGNOS_TEST_EMAIL, COGNOS_TEST_PASSWORD and COGNOS_TEST_ACCOUNT_KEY.');
  process.exit(1);
}
const langs = process.argv.slice(2).filter((a) => ALL.includes(a));
const targets = langs.length ? langs : ALL;

// ---- helpers ---------------------------------------------------------------
async function dismiss(p) {
  await p.keyboard.press('Escape').catch(() => {});
  await p.locator('.cdk-overlay-backdrop').first().click({ force: true, timeout: 500 }).catch(() => {});
  await p.waitForTimeout(200);
}
const clipShot = (p, path, c, pad = 14) =>
  p.screenshot({ path, clip: { x: Math.max(0, c.x - pad), y: Math.max(0, c.y - pad), width: c.w + pad * 2, height: c.h + pad * 2 } });
async function overlay(p, path) {
  const el = p.locator('.cdk-overlay-pane, [role=dialog]').last();
  const box = await el.boundingBox();
  if (!box || box.height < 80) throw new Error('overlay too small');
  await el.screenshot({ path });
}
async function contentClip(p, path, h = 840) {
  const c = await p.evaluate(() => {
    const el = document.querySelector('.settings__content') || document.querySelector('main');
    const r = el.getBoundingClientRect();
    return { x: r.x, w: r.width };
  });
  await p.screenshot({ path, clip: { x: Math.max(0, c.x - 8), y: 8, width: c.w + 16, height: h } });
}
async function cardByHeading(p, path, re, pad = 16) {
  const c = await p.evaluate((src) => {
    const rx = new RegExp(src);
    const h = [...document.querySelectorAll('h1,h2,h3')].find((n) => rx.test(n.textContent));
    if (!h) return null;
    const el = h.closest('.cog-card') || h.closest('section') || h.parentElement;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: Math.max(0, r.y), w: r.width, h: r.height + Math.min(0, r.y) };
  }, re.source);
  if (!c || c.h < 80) throw new Error('card not found: ' + re);
  await clipShot(p, path, c, pad);
}
async function send(p, text) {
  const ta = p.locator('textarea').first();
  await ta.click();
  await ta.fill(text);
  await p.keyboard.press('Meta+Enter');
  await p.waitForTimeout(500);
  if (await ta.inputValue()) await p.keyboard.press('Control+Enter'); // non-mac fallback
  await p.waitForTimeout(6000);
}

async function run(lang) {
  const dir = lang === 'en' ? MEDIA : join(MEDIA, lang);
  mkdirSync(dir, { recursive: true });
  const out = (name) => join(dir, name);
  const ok = [], fail = [];
  const step = async (n, langsAllowed, f) => {
    if (langsAllowed !== 'all' && !langsAllowed.includes(lang)) return;
    try { await dismiss(p); await f(); ok.push(n); } catch (e) { fail.push(`${n}: ${e.message.split('\n')[0]}`); }
  };

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light' });
  const p = await ctx.newPage();
  p.setDefaultTimeout(15000);

  // Auth screenshots (English only — the login page is pre-locale). en run captures them.
  if (lang === 'en') {
    await step('login', 'all', async () => { await p.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(500); await cardByHeading(p, out('login.png'), /privacy-first AI|Get started/); });
    await step('forgot-password', 'all', async () => { await p.goto(`${BASE}/auth/forgot-password`, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(500); await cardByHeading(p, out('forgot-password.png'), /Reset your password|Forgot/); });
  }

  // Log in + unlock (English UI; account is reset to en at the end of each run).
  await p.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
  await p.locator('input[type=email]').first().fill(EMAIL);
  await p.locator('input[type=password]').first().fill(PASSWORD);
  await p.getByRole('button', { name: /log in|sign in/i }).click();
  await p.getByText(/Unlock backup/i).waitFor({ timeout: 20000 });
  if (lang === 'en') { try { await p.locator('[role=dialog]').first().screenshot({ path: out('unlock-dialog.png') }); ok.push('unlock-dialog'); } catch { fail.push('unlock-dialog'); } }
  const ki = p.locator('#account-key');
  await ki.evaluate((el) => el.removeAttribute('readonly'));
  await ki.fill(KEY);
  await p.locator('[role=dialog] button, .cdk-overlay-pane button').last().click();
  await p.waitForTimeout(2500);

  // Switch app language for localised captures.
  if (lang !== 'en') {
    await p.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(800);
    await p.locator('button', { hasText: /^(EN|DE|FR|ES|PT|IT)$/ }).first().click();
    await p.waitForTimeout(400);
    await p.getByText(ENDONYM[lang], { exact: true }).first().click();
    await p.waitForTimeout(1800);
  }

  // ---- language-agnostic captures (all locales, structural selectors) ----
  await step('privacy-tiers', 'all', async () => {
    await p.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
    await p.locator('.data-processing').first().waitFor();
    await p.evaluate(() => { document.querySelector('.data-processing').scrollIntoView({ block: 'start' }); window.scrollBy(0, -24); });
    await p.waitForTimeout(600);
    const c = await p.evaluate(() => { const s = document.querySelector('.data-processing'); const rg = s.querySelector('[role=radiogroup]'); const a = s.getBoundingClientRect(), g = rg.getBoundingClientRect(); const y = Math.max(0, a.y); return { x: a.x, y, w: a.width, h: g.bottom - y }; });
    await clipShot(p, out('privacy-tiers.png'), c);
  });
  await step('personas', 'all', async () => { await p.goto(`${BASE}/personas`, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1100); await p.screenshot({ path: out('personas.png'), clip: { x: 120, y: 80, width: 1040, height: 640 } }); });
  await step('pricing', 'all', async () => { await p.goto(`${BASE}/pricing`, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1200); await p.screenshot({ path: out('pricing.png'), clip: { x: 120, y: 90, width: 1040, height: 720 } }); });
  await step('import', 'all', async () => { await p.goto(`${BASE}/import`, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1000); await p.screenshot({ path: out('import.png'), clip: { x: 150, y: 70, width: 980, height: 720 } }); });
  await step('memory', 'all', async () => { await p.goto(`${BASE}/account/memory`, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(900); await contentClip(p, out('memory.png')); });
  await step('billing', 'all', async () => { await p.goto(`${BASE}/account/billing`, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1200); await contentClip(p, out('billing.png')); });
  await step('team', 'all', async () => { await p.goto(`${BASE}/account/team`, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1000); await contentClip(p, out('team.png')); });
  await step('projects', 'all', async () => { await p.goto(`${BASE}/account/projects`, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1000); await contentClip(p, out('projects.png')); });
  await step('model-picker', 'all', async () => {
    await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('textarea'); await p.waitForTimeout(900);
    await p.locator('button', { hasText: /\d+\s?B\b|Apertus|Gemma|Kimi|Llama|Mistral|Ministral|GPT|Claude/ }).first().click();
    await p.waitForTimeout(900); await overlay(p, out('model-picker.png'));
  });
  await step('first-chat-composer', 'all', async () => {
    await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('textarea'); await p.waitForTimeout(1000);
    const r = await p.evaluate(() => { const ta = document.querySelector('textarea'); const b = ta.getBoundingClientRect(); return { x: b.x, y: b.y, right: b.right, bottom: b.bottom }; });
    await p.screenshot({ path: out('first-chat-composer.png'), clip: { x: Math.max(0, r.x - 24), y: Math.max(0, r.y - 96), width: Math.min(1280, r.right - r.x + 48), height: r.bottom - r.y + 150 } });
  });
  await step('chat-exchange', 'all', async () => {
    await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('textarea'); await p.waitForTimeout(800);
    await send(p, 'Explain the water cycle in two short sentences.');
    const c = await p.evaluate(() => { const items = [...document.querySelectorAll('.message-list-item')]; if (!items.length) return null; const f = items[0].getBoundingClientRect(); const l = items[items.length - 1].getBoundingClientRect(); const ml = document.querySelector('.message-list').getBoundingClientRect(); return { x: ml.x, y: Math.max(0, f.top), w: ml.width, h: Math.min(760, l.bottom - Math.max(0, f.top)) }; });
    if (!c) throw new Error('no messages'); await clipShot(p, out('chat-exchange.png'), c, 10);
  });
  await step('redaction', 'all', async () => {
    await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('textarea'); await p.waitForTimeout(800);
    const ta = p.locator('textarea').first(); await ta.click();
    await ta.fill('Please review the account for IBAN CH93 0076 2011 6238 5295 7 and email anna.keller@example.com before Friday.');
    await p.waitForTimeout(1600);
    // Reveal the highlighted values so the screenshot shows what will be redacted.
    for (const t of [p.getByRole('button', { name: /Show what will be redacted/i }), p.getByRole('button', { name: /redact/i }), p.locator('[class*="redact" i] button, button[aria-label*="redact" i], button[title*="redact" i]')]) {
      if (await t.first().count()) { await t.first().click({ timeout: 3000 }).catch(() => {}); break; }
    }
    await p.waitForTimeout(900);
    const r = await p.evaluate(() => { const ta = document.querySelector('textarea'); const b = ta.getBoundingClientRect(); return { x: b.x, y: b.y, right: b.right, bottom: b.bottom }; });
    await p.screenshot({ path: out('redaction-composer.png'), clip: { x: Math.max(0, r.x - 24), y: Math.max(0, r.y - 110), width: Math.min(1280, r.right - r.x + 48), height: r.bottom - r.y + 210 } });
  });
  await step('reasoning-effort', ['en'], async () => {
    await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('textarea'); await p.waitForTimeout(800);
    // Reasoning controls only appear for reasoning-capable models; try a few, then open the control.
    await p.locator('button', { hasText: /\d+\s?B\b|Apertus|Gemma|Kimi|Llama|Mistral|Ministral|GPT|Claude/ }).first().click().catch(() => {});
    await p.waitForTimeout(600);
    for (const name of [/Kimi/, /GPT/, /Claude/, /Mistral Small/]) { const m = p.getByRole('option', { name }).or(p.getByRole('button', { name })); if (await m.first().count()) { await m.first().click().catch(() => {}); break; } }
    await dismiss(p); await p.waitForTimeout(600);
    const rc = p.getByRole('button', { name: /reasoning effort/i }).first();
    if (!(await rc.count())) throw new Error('no reasoning control for this model');
    await rc.click(); await p.waitForTimeout(600); await overlay(p, out('reasoning-effort.png'));
  });
  await step('redaction-reveal', 'all', async () => {
    await send(p, 'Please file my IBAN CH93 0076 2011 6238 5295 7 against the March invoice.');
    await p.locator('.cog-user-message .cog-redacted-text').first().click({ timeout: 6000 });
    await p.waitForTimeout(700); await overlay(p, out('redaction-reveal.png'));
  });

  // ---- English-only captures (text selectors; other locales fall back) ----
  await step('emergency-kit', ['en'], async () => {
    const kctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light' });
    const kp = await kctx.newPage(); kp.setDefaultTimeout(15000);
    await kp.goto(`${BASE}/auth/register`, { waitUntil: 'domcontentloaded' });
    await kp.getByText('Create your Cognos account').waitFor(); await kp.waitForTimeout(300);
    await cardByHeading(kp, out('create-account-register.png'), /Create your Cognos account/);
    await kp.locator('input[type=email]').first().fill(`docs-shot-${Date.now()}@example.com`);
    await kp.locator('input[type=password]').first().fill('DocsKit-2026-Cognos!');
    await kp.getByRole('button', { name: /create account/i }).click();
    await kp.getByText(/Secure your encrypted backup/i).waitFor({ timeout: 20000 }); await kp.waitForTimeout(500);
    await kp.evaluate(() => document.querySelectorAll('code, pre, [class*="key"], [class*="mono"]').forEach((n) => { if ((n.textContent || '').trim().length >= 16) n.style.filter = 'blur(7px)'; }));
    await kp.waitForTimeout(150);
    await kp.locator('[role=dialog]').first().screenshot({ path: out('emergency-kit-dialog.png') });
    await kctx.close();
  });
  await step('mfa-setup', ['en'], async () => { await p.goto(`${BASE}/account/security`, { waitUntil: 'domcontentloaded' }); await p.getByText(/Two-factor authentication/i).first().waitFor(); await p.waitForTimeout(500); await cardByHeading(p, out('mfa-setup.png'), /Two-factor authentication/); });
  await step('sign-out-devices', ['en'], async () => { await p.goto(`${BASE}/account/security`, { waitUntil: 'domcontentloaded' }); await p.getByText(/Sign out other devices/i).first().waitFor(); await p.getByText(/Sign out other devices/i).first().scrollIntoViewIfNeeded(); await p.waitForTimeout(400); await cardByHeading(p, out('sign-out-devices.png'), /Sign out other devices/); });
  await step('account-key-settings', ['en'], async () => { await p.goto(`${BASE}/account/security`, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700); await cardByHeading(p, out('account-key-settings.png'), /Account Key|Emergency Kit|Encrypted backup/i); });
  await step('delete-account', ['en'], async () => { await p.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' }); await p.getByText(/Danger zone/i).first().waitFor(); await p.getByText(/Danger zone/i).first().scrollIntoViewIfNeeded(); await p.waitForTimeout(400); await cardByHeading(p, out('delete-account.png'), /Danger zone/i); });
  await step('export-data', ['en'], async () => { await p.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' }); await p.getByText(/Your data|Export|Download your data/i).first().waitFor(); await p.getByText(/Your data|Export|Download your data/i).first().scrollIntoViewIfNeeded(); await p.waitForTimeout(400); await cardByHeading(p, out('export-data.png'), /Your data|Export your data|Download your data/i); });
  await step('bookmarks', ['en'], async () => { await p.goto(`${BASE}/account/bookmarks`, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(900); await contentClip(p, out('bookmarks.png'), 520); });
  await step('trial-credit', ['en'], async () => { await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1400); const c = await p.evaluate(() => { const el = [...document.querySelectorAll('*')].find((n) => /trial/i.test(n.className || '') && n.getBoundingClientRect().width > 150 && n.getBoundingClientRect().width < 360); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }); if (!c) throw new Error('no trial card'); await clipShot(p, out('trial-credit.png'), c, 10); });
  await step('chat-tools-menu', ['en'], async () => { await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('textarea'); await p.waitForTimeout(800); await p.getByRole('button', { name: /^Tools$/ }).click(); await p.waitForTimeout(700); await overlay(p, out('chat-tools-menu.png')); });
  await step('search', ['en'], async () => {
    await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1200);
    const s = p.getByPlaceholder(/^Search$/i).first(); await s.click({ timeout: 6000 }); await s.fill('water'); await p.waitForTimeout(1200);
    await p.screenshot({ path: out('search.png'), clip: { x: 0, y: 0, width: 340, height: 820 } });
  });
  await step('temporary-chat', ['en'], async () => {
    await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('textarea'); await p.waitForTimeout(800);
    const c = await p.evaluate(() => { const t = [...document.querySelectorAll('*')].find((n) => /Temporary chat/i.test(n.textContent || '') && n.children.length < 3); const dis = [...document.querySelectorAll('button')].find((b) => /Disappearing messages/i.test(b.textContent)); if (!t && !dis) return null; const a = (t || dis).getBoundingClientRect(); const d = (dis || t).getBoundingClientRect(); return { x: Math.min(a.left, d.left), y: Math.min(a.top, d.top), w: Math.max(a.right, d.right) - Math.min(a.left, d.left), h: Math.max(a.bottom, d.bottom) - Math.min(a.top, d.top) }; });
    if (!c) throw new Error('no temporary toggle'); await clipShot(p, out('temporary-chat.png'), c, 18);
  });
  await step('disappearing-dialog', ['en'], async () => { await p.getByRole('button', { name: /Disappearing messages/i }).first().click({ timeout: 6000 }); await p.waitForTimeout(700); await overlay(p, out('disappearing-dialog.png')); });
  await step('forked-chats', ['en'], async () => {
    await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('textarea'); await p.waitForTimeout(800);
    await send(p, 'Explain the water cycle in two short sentences.');
    const um = p.locator('.cog-user-message').first(); await um.hover();
    await p.getByRole('button', { name: /Edit message/i }).first().click({ timeout: 6000 }); await p.waitForTimeout(500);
    await p.locator('textarea').last().fill('Explain the water cycle in three short sentences.');
    await p.getByRole('button', { name: /^Send$|Save|Update/ }).first().click(); await p.waitForTimeout(6000);
    const c = await p.evaluate(() => { const sw = [...document.querySelectorAll('*')].find((n) => /\b[12]\s*\/\s*2\b/.test(n.textContent || '') && n.getBoundingClientRect().width < 320); const item = sw ? sw.closest('.message-list-item') : document.querySelector('.message-list-item'); const r = item.getBoundingClientRect(); return { x: r.x, y: Math.max(0, r.top), w: r.width, h: Math.min(520, r.height) }; });
    await clipShot(p, out('forked-chats.png'), c, 10);
  });
  await step('share-dialog', ['en'], async () => {
    await p.getByRole('button', { name: /^Share$/ }).click({ timeout: 6000 }); await p.waitForTimeout(900); await overlay(p, out('share-dialog.png'));
    const url = await p.evaluate(() => [...document.querySelectorAll('a,input')].map((e) => e.value || e.href || '').find((v) => /\/p\//.test(v)) || null);
    await dismiss(p);
    if (url) { const sc = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light' }); const sp = await sc.newPage(); await sp.goto(url, { waitUntil: 'domcontentloaded' }); await sp.waitForTimeout(2500); await sp.screenshot({ path: out('share-public.png'), clip: { x: 160, y: 60, width: 960, height: 760 } }); await sc.close(); ok.push('share-public'); }
  });

  // Reset account language back to English so the next run starts clean.
  if (lang !== 'en') {
    try {
      await p.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(800);
      await p.locator('button', { hasText: /^(EN|DE|FR|ES|PT|IT)$/ }).first().click(); await p.waitForTimeout(400);
      await p.getByText('English', { exact: true }).first().click(); await p.waitForTimeout(1200);
    } catch { /* best effort */ }
  }

  await browser.close();
  console.log(`[${lang}] ok=${ok.length} (${ok.join(', ')})`);
  if (fail.length) console.log(`[${lang}] fail=${fail.length}\n  ${fail.join('\n  ')}`);
}

for (const lang of targets) await run(lang);
console.log('\nAll done.');
