import { expect, type Page, test } from '@playwright/test';

/**
 * #494 Frontend 計測基盤 — 初回マウント duration ベースライン取得 (自動化)
 *
 * useFirstRenderMark (frontend/src/utils/perfMarks.ts) が記録する
 * `startup` / `object-tree` / `sql-editor` の measure entry を取得する。
 * dev server (Vite) 経由のため duration は production preview / WebView2 と
 * 一致しない。リグレッション検出の基準値として記録する。
 *
 * 実行方法: CLAUDE.md「E2Eテスト (Playwright)」参照 (image タグは bun.lock の @playwright/test バージョンに合わせること)
 *
 * `result-grid` (BottomPanel) はクエリ実行後にのみ mount されるため本 spec では取得しない。
 * 実機で接続 + クエリ実行後に DevTools Console で取得すること:
 *   performance.getEntriesByType('measure').filter(e => e.name === 'result-grid')
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

/**
 * 取得対象 marks (3 件):
 * - `startup`: App ルート初回マウント。README #1 (起動 < 0.3s) ベースライン用
 * - `object-tree`: ObjectTree 初回マウント (LeftPanel は起動時に常時表示)
 * - `sql-editor`: SqlEditor (Monaco) 初回マウント (Ctrl+N で新規タブ作成後)
 *
 * 取得しない marks:
 * - `result-grid`: BottomPanel はクエリ実行後にのみ表示。実機で手動取得
 * - `er-diagram-50`: 50 テーブル以上のフィクスチャが別タスク (#597)
 */
const TARGETS = ['startup', 'object-tree', 'sql-editor'] as const;
type TargetName = (typeof TARGETS)[number];

/**
 * README #1「アプリ起動 < 0.3s」に対応するリグレッション上限 (Playwright Chromium headless 基準)。
 * 実測ベースライン 151.9ms の ~1.5x。300ms は README 目標値だが headless CI には粗すぎるため絞っている。
 */
const STARTUP_TARGET_MS = 230;

type DurationEntry = { name: TargetName; duration_ms: number | null };

async function collectDurations(page: Page): Promise<DurationEntry[]> {
  await page.addInitScript(MOCK_INVOKE_SCRIPT);
  await page.goto('/');

  // startup mark が記録されるまで待機してから Ctrl+N を送る (networkidle 不使用:
  // Vite dev の HMR WebSocket が networkidle 到達を妨げる場合があるため)
  await page.waitForFunction(() => performance.getEntriesByName('startup', 'measure').length > 0, {
    timeout: 15_000,
  });

  // SqlEditor は新規タブ作成でマウントされる (#391 spec と同じ手法)。
  await page.keyboard.press('Control+n');

  await page.waitForFunction(
    (names) =>
      (names as readonly string[]).every(
        (n) => performance.getEntriesByName(n, 'measure').length > 0
      ),
    TARGETS,
    { timeout: 30_000 }
  );

  return page.evaluate((names) => {
    return (names as readonly string[]).map((n) => ({
      name: n as TargetName,
      duration_ms: (() => {
        const entry = performance.getEntriesByName(n, 'measure')[0];
        return entry ? Number(entry.duration.toFixed(2)) : null;
      })(),
    }));
  }, TARGETS);
}

test.describe('#494 perf baseline', () => {
  test('should_record_positive_durations_for_all_targets_when_app_mounts', async ({ page }) => {
    const durations = await collectDurations(page);

    // stdout に集計可能な形で出力 (docs 転記用)。PERFORMANCE_VALIDATION.md 更新時に参照。
    console.log(`[#494 baseline] ${JSON.stringify(durations)}`);

    for (const d of durations) {
      expect(d.duration_ms).not.toBeNull();
      // 0.1ms 未満は mark 未記録の可能性がある (getEntriesByName が空を返した場合のフォールバック検出)
      expect(d.duration_ms).toBeGreaterThan(0.1);
      test
        .info()
        .annotations.push({ type: 'perf-baseline', description: `${d.name}=${d.duration_ms}ms` });
    }
  });

  test('startup_should_be_under_target_ms_when_app_mounts', async ({ page }) => {
    const durations = await collectDurations(page);
    const startup = durations.find((d) => d.name === TARGETS[0]);
    expect(startup?.duration_ms).not.toBeNull();
    expect(startup?.duration_ms).toBeLessThan(STARTUP_TARGET_MS);
  });
});
