import { Page, expect } from '@playwright/test';

import { TestAccount } from './fixtures';

export async function gotoRegister(page: Page): Promise<void> {
  await page.goto('/auth/register');
  await expect(
    page.getByRole('heading', { name: /create your cognos account/i }),
  ).toBeVisible();
}

export async function gotoLogin(page: Page): Promise<void> {
  await page.goto('/auth/login');
  await expect(page.getByRole('heading', { name: /privacy-first ai/i })).toBeVisible();
}

export async function fillRegisterForm(
  page: Page,
  account: TestAccount,
): Promise<void> {
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByLabel('Confirm password').fill(account.password);
}

export async function submitRegister(page: Page): Promise<void> {
  await page.getByRole('button', { name: /create account/i }).click();
}

export async function fillLoginForm(page: Page, account: TestAccount): Promise<void> {
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
}

export async function submitLogin(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^log in$/i }).click();
}

/**
 * After registration or login, the keypair-required guard blocks the route
 * transition to `/` until the vault password is provided — the URL stays on
 * the previous page while the dialog overlay is shown. We assert the dialog
 * is up, then complete it, then check the final URL separately.
 */
export async function expectVaultDialogForNewUser(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: /vault locked/i })).toBeVisible();
  await expect(
    page.getByText(/different from your login password/i).first(),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /create vault/i })).toBeVisible();
}

export async function expectVaultDialogForExistingUser(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: /vault locked/i })).toBeVisible();
  await expect(page.getByText(/never leave your device/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /unlock vault/i })).toBeVisible();
}

export async function setVaultPassword(
  page: Page,
  vaultPassword: string,
): Promise<void> {
  // The dev environment pre-fills the dialog with 'password' — wipe it.
  const input = page.getByLabel(/vault password/i);
  await input.fill(vaultPassword);
}

export async function createVault(page: Page, vaultPassword: string): Promise<void> {
  await setVaultPassword(page, vaultPassword);
  await page.getByRole('button', { name: /create vault/i }).click();
  await expect(page.getByRole('heading', { name: /vault locked/i })).toBeHidden();
  await expect(page).toHaveURL(/\/$/);
}

export async function unlockVault(page: Page, vaultPassword: string): Promise<void> {
  await setVaultPassword(page, vaultPassword);
  await page.getByRole('button', { name: /unlock vault/i }).click();
  await expect(page.getByRole('heading', { name: /vault locked/i })).toBeHidden();
  await expect(page).toHaveURL(/\/$/);
}

export async function logout(page: Page): Promise<void> {
  await page.goto('/auth/logout');
  await expect(page).toHaveURL(/\/auth\/login/);
}
