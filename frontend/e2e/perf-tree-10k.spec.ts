import { expect, type Page, test } from '@playwright/test';

import { recordBenchResults } from './helpers/benchRecorder';

/**
 * #502 スキーマツリー 1万ノード規模の展開操作ベンチマーク
 *
 * mocked window.invoke (page.addInitScript) で 5,000 テーブル + 5,000 ビュー (計 10,000
 * table/view ノード + カラム) のスキーマを返し、以下の 2 つの展開操作の応答時間を
 * `tree-expand` measure (frontend/src/utils/perfMarks.ts) から取得する:
 *
 * 1. tree-expand-tables-5000: "Tables (5000)" フォルダ展開 (クリック → 5,000 行 commit 完了)。
 *    展開後ツリーの初回レンダリングに相当する。
 * 2. tree-expand-columns-50: 5,000 行表示中に先頭テーブルを展開 (カラム 50 件の遅延ロード込み)。
 *
 * 実行方法: CLAUDE.md「E2Eテスト (Playwright)」参照。
 * 結果は docs/perf/e2e-benchmark.json (scenario: tree-10k) に記録する。
 */

const TABLE_COUNT = 5000;
const VIEW_COUNT = 5000;
const COLUMN_COUNT = 50;

/**
 * IPC mock: フィクスチャは JSON 埋め込みではなくページ内で生成する
 * (10,000 件を addInitScript の文字列に埋め込むと ~700KB になるため)。
 */
const MOCK_INVOKE_SCRIPT = `
  const TABLE_COUNT = ${TABLE_COUNT};
  const VIEW_COUNT = ${VIEW_COUNT};
  const COLUMN_COUNT = ${COLUMN_COUNT};
  const pad4 = (n) => String(n).padStart(4, '0');
  window.invoke = async (requestStr) => {
    let method = '';
    try { method = JSON.parse(requestStr).method; } catch (_e) {}
    if (method === 'loadSession') {
      return JSON.stringify({
        success: true,
        data: { queries: [], activeQueryId: null, connectionProfiles: [], window: {} },
      });
    }
    if (method === 'getConnectionProfiles') {
      return JSON.stringify({
        success: true,
        data: {
          profiles: [
            {
              id: 'prof-tree-10k',
              name: 'PerfTree',
              server: 'localhost',
              port: 1433,
              database: 'bench',
              username: 'sa',
              useWindowsAuth: true,
              savePassword: false,
              isProduction: false,
              isReadOnly: false,
              environment: 'development',
              dbType: 'sqlserver',
              folderPath: '',
            },
          ],
        },
      });
    }
    if (method === 'connectAsync') {
      return JSON.stringify({ success: true, data: { requestId: 'req-tree-10k' } });
    }
    if (method === 'getConnectResult') {
      return JSON.stringify({
        success: true,
        data: { status: 'connected', connectionId: 'conn-tree-10k' },
      });
    }
    if (method === 'getDatabases') {
      return JSON.stringify({ success: true, data: ['bench'] });
    }
    if (method === 'getTables') {
      const tables = [];
      for (let i = 0; i < TABLE_COUNT; i++) {
        tables.push({ schema: 'dbo', name: 'table_' + pad4(i), type: 'TABLE', comment: '' });
      }
      for (let i = 0; i < VIEW_COUNT; i++) {
        tables.push({ schema: 'dbo', name: 'view_' + pad4(i), type: 'VIEW', comment: '' });
      }
      return JSON.stringify({ success: true, data: tables });
    }
    if (method === 'getColumns') {
      const columns = [];
      for (let i = 0; i < COLUMN_COUNT; i++) {
        columns.push({
          name: 'col_' + i,
          type: 'int',
          size: 4,
          nullable: i !== 0,
          isPrimaryKey: i === 0,
        });
      }
      return JSON.stringify({ success: true, data: columns });
    }
    return JSON.stringify({ success: true, data: {} });
  };
`;

/** tree-expand measure が index 件以上記録されるまで待ち、指定 index の duration を返す */
async function waitForTreeExpandMeasure(page: Page, index: number): Promise<number | null> {
  await page.waitForFunction(
    (minCount) => performance.getEntriesByName('tree-expand', 'measure').length >= minCount,
    index + 1,
    { timeout: 300_000 }
  );
  return page.evaluate((i) => {
    const entry = performance.getEntriesByName('tree-expand', 'measure')[i];
    return entry ? Number(entry.duration.toFixed(2)) : null;
  }, index);
}

test.describe('#502 tree 10k-node expand benchmark', () => {
  test('should_record_tree_expand_durations_when_10k_node_schema_loaded', async ({ page }) => {
    // 仮想化前のベースライン計測では 5,000 行の再帰レンダリングに数分かかるため長めに取る
    test.setTimeout(600_000);
    await page.addInitScript(MOCK_INVOKE_SCRIPT);
    await page.goto('/');

    await page.waitForFunction(
      () => performance.getEntriesByName('startup', 'measure').length > 0,
      { timeout: 15_000 }
    );

    // プロファイルをクリック → 接続確認ダイアログ → 接続
    await page.locator('[data-testid="profile-node"]').click();
    await page.getByRole('dialog').getByRole('button', { name: '接続', exact: true }).click();

    // 接続完了後、DB ノードが自動展開され Tables/Views フォルダが表示される
    const tablesFolder = page.getByText(`Tables (${TABLE_COUNT})`);
    await expect(tablesFolder).toBeVisible({ timeout: 15_000 });

    // --- 計測 1: Tables フォルダ展開 (5,000 行の commit 完了まで) ---
    await tablesFolder.click();
    const expandTablesMs = await waitForTreeExpandMeasure(page, 0);
    await expect(page.getByText('table_0000')).toBeVisible();

    // 仮想化の効果確認用に、マウント済み treeitem 行数を stdout へ残す (assertion はしない)
    const mountedRowCount = await page.locator('[role="treeitem"]').count();

    // --- 計測 2: 5,000 行表示中に先頭テーブルを展開 (カラム 50 件の遅延ロード込み) ---
    await page
      .locator('[role="treeitem"]')
      .filter({ hasText: 'table_0000' })
      .getByRole('button')
      .click();
    const expandColumnsMs = await waitForTreeExpandMeasure(page, 1);
    await expect(page.getByText('col_0 (int, PK, NOT NULL)')).toBeVisible();

    console.log(
      `[#502 tree-10k] tables-5000=${expandTablesMs}ms columns-50=${expandColumnsMs}ms ` +
        `mountedRows=${mountedRowCount}`
    );

    // assertion より前に docs/perf/e2e-benchmark.json へ記録 (fail しても実測値を残す)
    recordBenchResults([
      { scenario: 'tree-10k', metric: 'tree-expand-tables-5000', durationMs: expandTablesMs },
      { scenario: 'tree-10k', metric: 'tree-expand-columns-50', durationMs: expandColumnsMs },
    ]);
    test.info().annotations.push({
      type: 'perf-baseline',
      description:
        `tree-expand-tables-5000=${expandTablesMs}ms ` +
        `tree-expand-columns-50=${expandColumnsMs}ms mountedRows=${mountedRowCount}`,
    });

    expect(expandTablesMs).not.toBeNull();
    expect(expandTablesMs).toBeGreaterThan(0.1);
    expect(expandColumnsMs).not.toBeNull();
    expect(expandColumnsMs).toBeGreaterThan(0.1);
  });
});
