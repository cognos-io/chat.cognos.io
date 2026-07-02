import { expect, test } from '@playwright/test';

import { makeTestAccount } from './fixtures';
import {
  acknowledgeAccountKey,
  captureGeneratedAccountKey,
  createEncryptedBackup,
  expectAccountKeyDialogForNewUser,
  fillRegisterForm,
  gotoRegister,
  submitRegister,
} from './helpers';

test('picking a model persists as the default and survives a reload', async ({
  page,
}) => {
  const account = makeTestAccount();
  await gotoRegister(page);
  await fillRegisterForm(page, account);
  await submitRegister(page, account);
  await expectAccountKeyDialogForNewUser(page);
  await captureGeneratedAccountKey(page);
  await acknowledgeAccountKey(page);
  await createEncryptedBackup(page);

  // The composer shows the active model. Open the picker and choose a different
  // eligible model.
  const trigger = page.locator('.message-form__model');
  await expect(trigger).toBeVisible();
  const initial = (await trigger.textContent())?.trim() ?? '';

  await trigger.click();
  const options = page.getByRole('option');
  await options.first().waitFor();

  let pickedName = '';
  for (let i = 0; i < (await options.count()); i++) {
    const option = options.nth(i);
    const name = (await option.locator('.model-selector__name').textContent())?.trim();
    if (name && name !== initial && !(await option.isDisabled())) {
      pickedName = name;
      await option.click();
      break;
    }
  }
  expect(pickedName).not.toBe('');
  await expect(trigger).toContainText(pickedName);

  // Reload — the active model is read back from the decrypted preferences
  // (the persisted default), not reset to the first eligible model.
  await page.reload();
  await expect(trigger).toBeVisible();
  await expect(trigger).toContainText(pickedName);
});
