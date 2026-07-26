import { expect, test } from '@playwright/test';

test('skip link targets the main landmark on the homepage', async ({ page }) => {
  await page.goto('/');

  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await skipLink.focus();
  await expect(skipLink).toBeFocused();

  await skipLink.click();
  await expect(page.locator('#main-content')).toBeVisible();
  await expect(page).toHaveURL(/#main-content$/);
});

test('navbar toggle has an accessible name', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/de/');

  // The accessible name is translated (nav.toggle) — on /de/ it must be the
  // German label, not the English fallback.
  const toggle = page.getByRole('button', { name: 'Menü öffnen' });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});
