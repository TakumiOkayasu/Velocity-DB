import { expect, test } from '@playwright/test';
import { mockData } from '../src/api/mockData';
import type { AppSettings } from '../src/api/providers/app-settings';

const defaultSettings = mockData.getSettings as AppSettings;

// ブラウザー内の設定契約を検証する。ネイティブ WebView2 の描画は対象外。
test.beforeEach(async ({ page }) => {
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
        const updates = JSON.parse(request.params).webview;
        // 簡易モックでは既知の真偽値だけを反映し、それ以外の入力は無視する。
        for (const key of [
          'gpuCompositing',
          'rendererBackgrounding',
          'cacheEnabled',
          'openDevToolsOnStartup',
        ] as const) {
          if (typeof updates?.[key] === 'boolean') {
            desired[key] = updates[key];
          }
        }
        return JSON.stringify({ success: true, data: { saved: true } });
      }
      return JSON.stringify({
        success: true,
        data: request.method === 'getConnectionProfiles' ? { profiles: [] } : {},
      });
    };
  }, defaultSettings);
  await page.goto('/');
});

test('WebView 設定を保存しても今回の起動設定は変わらない', async ({ page }) => {
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

test('設定モックは既知の真偽値だけを更新して未指定項目と起動設定を保持する', async ({ page }) => {
  const updateAndRead = async (params: string) =>
    page.evaluate(async (updateParams: string) => {
      if (!window.invoke) throw new Error('設定モックが初期化されていません');
      const saved = JSON.parse(
        await window.invoke(JSON.stringify({ method: 'updateSettings', params: updateParams }))
      );
      const settings = JSON.parse(
        await window.invoke(JSON.stringify({ method: 'getSettings', params: '{}' }))
      );
      return { saved, settings: settings.data as AppSettings };
    }, params);

  const enabled = {
    gpuCompositing: true,
    rendererBackgrounding: true,
    cacheEnabled: true,
    openDevToolsOnStartup: true,
  };
  // JSON 文字列で渡し、特殊キーを通常の own property としてパースさせる。
  const first = await updateAndRead(`{"webview":{
    "gpuCompositing":true,"rendererBackgrounding":true,
    "cacheEnabled":true,"openDevToolsOnStartup":true,
    "unexpected":true,"__proto__":{"polluted":true},"constructor":{},"prototype":{}
  }}`);
  expect(first.saved).toEqual({ success: true, data: { saved: true } });
  expect(first.settings.webview).toEqual(enabled);
  expect(first.settings.webviewStartup).toEqual(defaultSettings.webviewStartup);
  expect(first.settings.webviewRestartRequired).toBe(true);

  const partial = await updateAndRead(
    '{"webview":{"gpuCompositing":false,"rendererBackgrounding":"false","cacheEnabled":0,"openDevToolsOnStartup":null}}'
  );
  expect(partial.settings.webview).toEqual({ ...enabled, gpuCompositing: false });
  expect(partial.settings.webviewRestartRequired).toBe(true);
  for (const params of ['{}', '{"webview":{}}']) {
    expect((await updateAndRead(params)).settings).toEqual(partial.settings);
  }

  const restored = await updateAndRead(JSON.stringify({ webview: defaultSettings.webviewStartup }));
  expect(restored.settings.webview).toEqual(defaultSettings.webviewStartup);
  expect(restored.settings.webviewStartup).toEqual(defaultSettings.webviewStartup);
  expect(restored.settings.webviewRestartRequired).toBe(false);
});
