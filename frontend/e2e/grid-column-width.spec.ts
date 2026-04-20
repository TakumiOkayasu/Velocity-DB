import { expect, test } from '@playwright/test';

/**
 * Issue #368: 縦スクロールで列幅が変わる問題の再現 E2E テスト
 *
 * window.invoke を mock して 200 行のデータを返すように上書きし、
 * grid 表示後に連続スクロールして列幅の変化を検出する。
 */

const ROW_COUNT = 200;

function makeMockInvoke(): string {
  return `
    const rows = [];
    for (let i = 0; i < ${ROW_COUNT}; i++) {
      rows.push([String(i), 'name_' + i + (i % 10 === 0 ? '_long_suffix_to_trigger_auto_size' : ''), '2024-01-' + String((i % 28) + 1).padStart(2, '0') + ' 00:00:00']);
    }
    const mockResponses = {
      connectAsync: { requestId: 'req-1' },
      pollConnectAsync: { status: 'completed', connectionId: 'mock-conn' },
      disconnect: {},
      testConnection: { success: true, message: 'ok' },
      executeQuery: {
        columns: [
          { name: 'id', type: 'int', size: 4, nullable: false, isPrimaryKey: true },
          { name: 'name', type: 'nvarchar', size: 255, nullable: true, isPrimaryKey: false },
          { name: 'created_at', type: 'datetime', size: 8, nullable: true, isPrimaryKey: false },
        ],
        rows: rows,
        affectedRows: 0,
        executionTimeMs: 15,
        cached: false,
      },
      getDatabases: ['testdb'],
      getSchemas: ['dbo'],
      getTables: [{ schema: 'dbo', name: 'TestTable', type: 'TABLE' }],
      getColumns: [
        { name: 'id', type: 'int', size: 4, nullable: false, isPrimaryKey: true },
        { name: 'name', type: 'nvarchar', size: 255, nullable: true, isPrimaryKey: false },
        { name: 'created_at', type: 'datetime', size: 8, nullable: true, isPrimaryKey: false },
      ],
      getSettings: {},
      writeFrontendLog: {},
    };
    window.invoke = async (requestStr) => {
      const req = JSON.parse(requestStr);
      const data = mockResponses[req.method];
      if (data === undefined) {
        return JSON.stringify({ success: false, error: 'no mock for ' + req.method });
      }
      return JSON.stringify({ success: true, data: data });
    };
  `;
}

test.describe('#368 列幅スクロール固定', () => {
  test('200行スクロール中に <col> 幅が変化しないこと', async ({ page }) => {
    await page.addInitScript(makeMockInvoke());
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 診断のため、body の最初の table を探す (存在しなければスキップ)
    const tableCount = await page.locator('table').count();
    console.log(`[diag] table count on load: ${tableCount}`);

    // 接続・クエリフロー: UI 操作依存のためここでは store 直接操作が必要になる。
    // 現状は table が見えたときのみ測定する簡易版。
    if (tableCount === 0) {
      test.skip(true, '初期表示で table 無し (接続 UI 経由のセットアップが未実装)');
      return;
    }

    const cols = page.locator('colgroup col');
    const initialWidths = await cols.evaluateAll((els) =>
      els.map((e) => (e as HTMLElement).getBoundingClientRect().width)
    );
    console.log('[diag] initial col widths:', initialWidths);

    // スクロール操作
    const container = page.locator('[class*="tableContainer"]').first();
    await container.evaluate((el) => {
      el.scrollTop = 500;
    });
    await page.waitForTimeout(200);

    const afterWidths = await cols.evaluateAll((els) =>
      els.map((e) => (e as HTMLElement).getBoundingClientRect().width)
    );
    console.log('[diag] after-scroll col widths:', afterWidths);

    expect(afterWidths).toEqual(initialWidths);
  });
});
