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
      getConnectResult: { status: 'connected', connectionId: 'mock-conn' },
      disconnect: {},
      testConnection: { success: true, message: 'ok' },
      executeAsyncQuery: { queryId: 'mock-query' },
      getAsyncQueryResult: {
        queryId: 'mock-query',
        status: 'completed',
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
      // #514 ワイヤ形式: getTables=[schema,name,type,comment], getColumns=[name,type,size,nullable,isPK,comment]
      getTables: [['dbo', 'TestTable', 'TABLE', '']],
      getColumns: [
        ['id', 'int', 4, false, true, ''],
        ['name', 'nvarchar', 255, true, false, ''],
        ['created_at', 'datetime', 8, true, false, ''],
      ],
      getConnectionProfiles: { profiles: [] },
      getSettings: {
        general: {
          autoConnect: false,
          lastConnectionId: '',
          confirmOnExit: true,
          maxQueryHistory: 100,
          maxRecentConnections: 10,
          language: 'ja',
        },
        editor: {
          fontSize: 14,
          fontFamily: 'Consolas',
          wordWrap: false,
          tabSize: 2,
          insertSpaces: true,
          showLineNumbers: true,
          showMinimap: false,
          theme: 'dark',
        },
        grid: {
          defaultPageSize: 100,
          showRowNumbers: true,
          enableCellEditing: true,
          dateFormat: 'yyyy-MM-dd',
          nullDisplay: 'NULL',
        },
        query: { timeoutSeconds: 30 },
      },
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

    await page.click('button[title="新規接続"]');
    await page.waitForSelector('#conn-server', { timeout: 10_000 });
    await page.fill('#conn-name', 'Column Width Test');
    await page.fill('#conn-server', 'localhost');
    await page.fill('#conn-database', 'master');
    await page.locator('[data-testid="conn-submit"]').click();
    await page.waitForSelector('#conn-server', { state: 'detached', timeout: 15_000 });

    await page.keyboard.press('Control+n');
    await page.waitForSelector('.monaco-editor', { timeout: 10_000 });
    await page.click('.monaco-editor');
    await page.keyboard.type('SELECT * FROM TestTable');
    await page.waitForSelector('button[title="実行 (F9)"]:not([disabled])', {
      timeout: 10_000,
    });
    await page.keyboard.press('F9');

    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('name_0_long_suffix_to_trigger_auto_size')).toBeVisible();

    const cols = page.locator('colgroup col');
    await expect(cols).toHaveCount(3);
    const initialWidths = await cols.evaluateAll((els) =>
      els.map((e) => (e as HTMLElement).getBoundingClientRect().width)
    );
    expect(initialWidths.every((width) => width > 0)).toBe(true);
    const visibleRowsBefore = await table.locator('tbody tr').allTextContents();
    console.log('[diag] initial col widths:', initialWidths);

    // スクロール操作
    const container = page.locator('[class*="tableContainer"]').first();
    const scrollTop = await container.evaluate((el) => {
      el.scrollTop = 500;
      return el.scrollTop;
    });
    expect(scrollTop).toBeGreaterThan(0);
    await page.waitForTimeout(200);

    const afterWidths = await cols.evaluateAll((els) =>
      els.map((e) => (e as HTMLElement).getBoundingClientRect().width)
    );
    const visibleRowsAfter = await table.locator('tbody tr').allTextContents();
    console.log('[diag] after-scroll col widths:', afterWidths);

    expect(visibleRowsAfter).not.toEqual(visibleRowsBefore);
    expect(afterWidths.every((width) => width > 0)).toBe(true);
    expect(afterWidths).toEqual(initialWidths);
  });
});
