import { expect, test } from '@playwright/test';

// Issue #391: Ctrl+W で複数タブが閉じる回帰防止 E2E。
// MainLayout と EditorTabs で keydown を二重登録すると 1 押下で 2 タブ閉じる。
// window.invoke を全 method に対し success 応答で mock し、接続・永続化を排除する。

const MOCK_INVOKE_SCRIPT = `
  window.invoke = async (requestStr) => {
    try {
      const req = JSON.parse(requestStr);
      if (req.method === 'loadSession') {
        return JSON.stringify({
          success: true,
          data: { queries: [], activeQueryId: null, connectionProfiles: [], window: {} },
        });
      }
      return JSON.stringify({ success: true, data: {} });
    } catch (e) {
      return JSON.stringify({ success: true, data: {} });
    }
  };
`;

test.describe('#391 Ctrl+W tab close shortcut', () => {
  test('Ctrl+W 1回押下で閉じるタブは1つのみ', async ({ page }) => {
    await page.addInitScript(MOCK_INVOKE_SCRIPT);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 3タブ以上になるよう Ctrl+N で追加
    await page.keyboard.press('Control+n');
    await page.keyboard.press('Control+n');
    await page.keyboard.press('Control+n');
    await page.waitForTimeout(100);

    const tabs = page.locator('[role="tab"]');
    const before = await tabs.count();
    expect(before).toBeGreaterThanOrEqual(3);

    await page.keyboard.press('Control+w');
    await page.waitForTimeout(200);

    const after = await tabs.count();
    expect(before - after).toBe(1);
  });
});
