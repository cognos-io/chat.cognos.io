import { expect, test } from '@playwright/test';

// The language switcher must work for logged-out visitors (auth pages) since
// there's no account preference yet — it falls back to localStorage + the
// browser's languages, then persists the explicit choice locally.
test.describe('language switcher (auth pages)', () => {
  test('switches the login page language and persists the choice', async ({ page }) => {
    await page.goto('/auth/login');

    // Defaults to English (Playwright's chromium reports en-US).
    await expect(
      page.getByRole('heading', { name: 'Get started with privacy-first AI' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');

    // Open the switcher and pick German.
    await page.getByRole('button', { name: 'Language' }).click();
    await page.getByRole('menuitem', { name: 'Deutsch' }).click();

    // The page is now German, <html lang> tracks it, and the choice is stored.
    await expect(page.getByRole('button', { name: 'Anmelden' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Get started with privacy-first AI' }),
    ).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('de');
    expect(await page.evaluate(() => localStorage.getItem('cognos:lang'))).toBe('de');

    // The choice survives a reload (resolved from localStorage before paint).
    await page.reload();
    await expect(page.getByRole('button', { name: 'Anmelden' })).toBeVisible();
  });
});
