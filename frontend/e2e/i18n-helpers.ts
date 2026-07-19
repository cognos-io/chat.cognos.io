import { type Page, expect } from '@playwright/test';

// Pin: org billing surfaces must never leak raw i18n key paths (e.g.
// billing.orgLock.titleInactive) into the visible UI.
const RAW_I18N_KEY = /\b[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*){2,}\b/;

export async function expectNoRawI18nKeys(page: Page, where: string): Promise<void> {
  const text = await page.locator('body').innerText();
  const matches = text.match(new RegExp(RAW_I18N_KEY, 'g')) ?? [];
  const allowed = new Set(['e.g. Acme launch']);
  const leaked = matches.filter((match) => !allowed.has(match));
  expect(leaked, `raw i18n keys visible ${where}: ${leaked.join(', ')}`).toEqual([]);
}
