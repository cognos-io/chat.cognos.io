import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('skip link targets the main landmark on the homepage', async ({ page }) => {
  await page.goto('/');

  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await skipLink.focus();
  await expect(skipLink).toBeFocused();

  await skipLink.click();
  await expect(page.locator('#main-content')).toBeVisible();
  await expect(page).toHaveURL(/#main-content$/);

  const accessibilityScanResults = await new AxeBuilder({ page })
    .include('.skip-link')
    .include('#main-content')
    .analyze();
  expect(accessibilityScanResults.violations).toEqual([]);
});

test('navbar toggle has an accessible name', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/de/');

  const toggle = page.getByRole('button', { name: 'Toggle navigation' });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});
