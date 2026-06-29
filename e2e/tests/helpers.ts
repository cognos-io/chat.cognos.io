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
  // Single password entry — there is no confirmation field (a typo is
  // recoverable via password reset, which no longer affects encrypted data).
  await page.getByLabel('Password', { exact: true }).fill(account.password);
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

export async function expectAccountKeyDialogForNewUser(page: Page): Promise<void> {
  await expect(
    page.getByRole('heading', { name: /secure your encrypted backup/i }),
  ).toBeVisible();
  await expect(page.getByText(/generated a one-time account key/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /copy account key/i })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /download emergency kit/i }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /create encrypted backup/i }),
  ).toBeDisabled();
}

export async function expectUnlockDialog(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: /unlock backup/i })).toBeVisible();
  // v2 unlock asks for the Account Key alone — there is no password field.
  await expect(page.getByLabel('Account password')).toHaveCount(0);
  await expect(page.getByLabel('Account Key')).toBeVisible();
  await expect(
    page.getByRole('button', { name: /unlock encrypted backup/i }),
  ).toBeVisible();
}

export async function expectLockedDialog(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: /account locked/i })).toBeVisible();
  await expect(page.getByText(/account locked on this device/i)).toBeVisible();
}

export async function captureGeneratedAccountKey(page: Page): Promise<string> {
  const value = await page
    .locator('.vault-password-dialog__account-key-value')
    .textContent();
  expect(value?.trim()).toBeTruthy();
  return value!.trim();
}

export async function copyAccountKey(page: Page): Promise<void> {
  await page.getByRole('button', { name: /copy account key/i }).click();
  await expect(page.getByText(/account key copied/i)).toBeVisible();
  await expect(
    page.getByText(/store it somewhere safe before you continue/i),
  ).toBeVisible();
}

export async function acknowledgeAccountKey(page: Page): Promise<void> {
  // Match a stable prefix of the label so minor copy tweaks (e.g.
  // "acknowledge" → "understand") don't silently break account provisioning
  // across the whole browser suite.
  await page
    .getByRole('checkbox', {
      name: /i have copied my account key to a safe place/i,
    })
    .check();
}

// Creating the v2 backup needs no password (the acknowledgement enables the
// button). This also exercises POST /api/v1/user-key-pair end to end, so a
// backend rejection of the unlock scheme fails the test here.
export async function createEncryptedBackup(page: Page): Promise<void> {
  await expect(
    page.getByRole('button', { name: /create encrypted backup/i }),
  ).toBeEnabled();
  await page.getByRole('button', { name: /create encrypted backup/i }).click();
  await expect(
    page.getByRole('heading', { name: /secure your encrypted backup/i }),
  ).toBeHidden();
  await expect(page).toHaveURL(/\/$/);
}

export async function unlockAccount(page: Page, accountKey: string): Promise<void> {
  const accountKeyField = page.getByLabel('Account Key');
  await accountKeyField.click();
  await accountKeyField.fill(accountKey);
  await page.getByRole('button', { name: /unlock encrypted backup/i }).click();
  await expect(page.getByRole('heading', { name: /unlock backup/i })).toBeHidden();
  await expect(page.getByRole('heading', { name: /account locked/i })).toBeHidden();
  await expect(page).toHaveURL(/\/$/);
}

export async function openMobileDrawer(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /open navigation/i }).click();
  await expect(page.getByRole('button', { name: /^lock$/i })).toBeVisible();
}

export async function lockFromDrawer(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^lock$/i }).click();
  await expect(
    page.locator('cog-toast-host').getByText(/^account locked$/i),
  ).toBeVisible();
  await expect(
    page.getByText(/this device now needs your account key to unlock again/i),
  ).toBeVisible();
}

export async function logout(page: Page): Promise<void> {
  await page.goto('/auth/logout');
  await expect(page).toHaveURL(/\/auth\/login/);
}
