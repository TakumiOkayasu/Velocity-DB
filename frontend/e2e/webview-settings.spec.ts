import { expect, test } from '@playwright/test';
import { mockData } from '../src/api/mockData';
import type { AppSettings } from '../src/api/providers/app-settings';

// Browser-only UI contract check. This does not exercise native WebView2 painting.
test('WebView settings persist without changing the running startup snapshot', async ({ page }) => {
  await page.addInitScript((defaults: AppSettings) => {
    const desired = { ...defaults.webview };
    const startup = { ...defaults.webviewStartup };
    window.invoke = async (requestString: string) => {
      const request = JSON.parse(requestString);
      if (request.method === 'getSettings') {
        return JSON.stringify({
          success: true,
          data: {
            ...defaults,
            webview: desired,
            webviewStartup: startup,
            webviewRestartRequired: Object.keys(startup).some(
              (key) => desired[key as keyof typeof desired] !== startup[key as keyof typeof startup]
            ),
          },
        });
      }
      if (request.method === 'updateSettings') {
        Object.assign(desired, JSON.parse(request.params).webview ?? {});
        return JSON.stringify({ success: true, data: { saved: true } });
      }
      return JSON.stringify({
        success: true,
        data: request.method === 'getConnectionProfiles' ? { profiles: [] } : {},
      });
    };
  }, mockData.getSettings as AppSettings);
  await page.goto('/');
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByRole('button', { name: 'WebView', exact: true }).click();
  const gpuOption = page.getByRole('checkbox', { name: 'GPU 合成を許可する' });
  await expect(gpuOption).not.toBeChecked();
  await expect(page.locator('#setting-webview-gpuCompositing-startup')).toContainText('無効');
  await gpuOption.check();
  await expect(page.getByText('今回の起動設定と異なります。', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: '設定', exact: true })).not.toBeVisible();

  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByRole('button', { name: 'WebView', exact: true }).click();
  await expect(gpuOption).toBeChecked();
  await expect(page.locator('#setting-webview-gpuCompositing-startup')).toContainText('無効');
  await expect(
    page.getByText('保存済みの WebView 設定は未適用です。', { exact: false })
  ).toBeVisible();
});
