import { expect, test } from '@playwright/test';

test.describe('ダイアログ Escapeキー閉じ', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('SettingsDialog: Escapeで閉じる', async ({ page }) => {
    await page.keyboard.press('Control+,');
    await expect(page.locator('h2:text("設定")')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('h2:text("設定")')).not.toBeVisible();
  });

  test('ConnectionDialog: Escapeで閉じる', async ({ page }) => {
    await page.click('button[title="新規接続"]');
    await expect(page.locator('h2:text("DB接続")')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('h2:text("DB接続")')).not.toBeVisible();
  });
});
