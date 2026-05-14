import { expect, test } from '@playwright/test';

/**
 * #494 Frontend 計測基盤 — 初回マウント duration ベースライン取得 (自動化)
 *
 * useFirstRenderMark (frontend/src/utils/perfMarks.ts) が記録する
 * `result-grid` / `object-tree` / `sql-editor` の measure entry を取得する。
 * dev server (Vite) 経由のため duration は production preview / WebView2 と
 * 一致しない。リグレッション検出の基準値として記録する。
 */

const MOCK_INVOKE_SCRIPT = `
  window.invoke = async (requestStr) => {
    let method = '';
    try {
      method = JSON.parse(requestStr).method;
    } catch (_e) {
      method = '';
    }
    if (method === 'loadSession') {
      return JSON.stringify({
        success: true,
        data: { queries: [], activeQueryId: null, connectionProfiles: [], window: {} },
      });
    }
    return JSON.stringify({ success: true, data: {} });
  };
`;

const TARGETS = ['result-grid', 'object-tree', 'sql-editor'] as const;

test.describe('#494 perf baseline', () => {
  test('useFirstRenderMark の duration を 3 画面で取得', async ({ page }) => {
    await page.addInitScript(MOCK_INVOKE_SCRIPT);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // SqlEditor は新規タブ作成でマウントされる (#391 spec と同じ手法)。
    await page.keyboard.press('Control+n');

    await page.waitForFunction(
      (names) =>
        (names as readonly string[]).every(
          (n) => performance.getEntriesByName(n, 'measure').length > 0,
        ),
      TARGETS,
      { timeout: 15_000 },
    );

    const durations = await page.evaluate((names) => {
      return (names as readonly string[]).map((n) => {
        const entry = performance.getEntriesByName(n, 'measure')[0];
        return {
          name: n,
          duration_ms: entry ? Number(entry.duration.toFixed(2)) : null,
        };
      });
    }, TARGETS);

    // stdout に集計可能な形で出力 (docs 転記用)。
    console.log(`[#494 baseline] ${JSON.stringify(durations)}`);

    for (const d of durations) {
      expect(d.duration_ms).not.toBeNull();
      expect(d.duration_ms).toBeGreaterThan(0);
      test
        .info()
        .annotations.push({ type: 'perf-baseline', description: `${d.name}=${d.duration_ms}ms` });
    }
  });
});
