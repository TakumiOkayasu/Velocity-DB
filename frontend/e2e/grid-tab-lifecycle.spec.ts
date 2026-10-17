import { expect, type Page, test } from '@playwright/test';
import { mockData } from '../src/api/mockData';

// #779: 固定した IPC 応答で実際の ResultGrid / virtualizer を検証する。
// 対象はブラウザーの配置・内容であり、ネイティブ WebView2 の合成描画は検証できない。
const TABLES = {
  WideRows: { rowCount: 1000, columnCount: 18 },
  NarrowRows: { rowCount: 800, columnCount: 3 },
  SmallRows: { rowCount: 3, columnCount: 2 },
  LoadingRows: { rowCount: 900, columnCount: 16 },
};
type TableName = keyof typeof TABLES;
type Position = { top: number; left: number };
const ORIGIN: Position = { top: 0, left: 0 };
const SCROLLER = '[class*="tableContainer"]';

async function startApp(page: Page) {
  await page.addInitScript(
    ({ tables, defaults }) => {
      const results = Object.fromEntries(
        Object.entries(tables).map(([name, { rowCount, columnCount }]) => [
          name,
          {
            columns: Array.from({ length: columnCount }, (_, c) => ({
              name: `col_${c}`,
              type: 'nvarchar',
            })),
            rows: Array.from({ length: rowCount }, (_, r) =>
              Array.from({ length: columnCount }, (_, c) => `${name}:${r}:${c}`)
            ),
            affectedRows: 0,
            executionTimeMs: 1,
          },
        ])
      );
      const queries = new Map<string, string>();
      let nextId = 0;
      let loadingReleased = false;
      window.addEventListener('hold-grid-fixture', () => {
        loadingReleased = false;
      });
      window.addEventListener('release-grid-fixture', () => {
        loadingReleased = true;
      });
      window.invoke = async (requestString: string) => {
        const request = JSON.parse(requestString);
        const params = JSON.parse(request.params);
        let data: unknown;
        switch (request.method) {
          case 'loadSession':
            data = { queries: [], activeQueryId: null, connectionProfiles: [], window: {} };
            break;
          case 'connectAsync':
            data = { requestId: 'grid-connection-request' };
            break;
          case 'getConnectResult':
            data = { status: 'connected', connectionId: 'grid-connection' };
            break;
          case 'getConnectionProfiles':
            // ObjectTree に表示される保存済みプロファイル経由の接続を使う。
            data = {
              profiles: [
                {
                  id: 'grid-profile',
                  name: 'Grid lifecycle fixture',
                  server: 'localhost',
                  database: 'fixture',
                  username: '',
                  useWindowsAuth: true,
                  savePassword: false,
                  dbType: 'sqlserver',
                },
              ],
            };
            break;
          case 'getTables':
            data = Object.keys(tables).map((name) => ['dbo', name, 'TABLE', '']);
            break;
          case 'buildDataViewSql':
            data = { sql: `SELECT * FROM ${params.tableName}` };
            break;
          case 'getColumns': {
            const name = Object.keys(tables).find((key) => params.table.includes(key));
            data = name
              ? results[name].columns.map((column) => [
                  column.name,
                  column.type,
                  255,
                  false,
                  false,
                  '',
                ])
              : [];
            break;
          }
          case 'executeAsyncQuery': {
            const name = Object.keys(tables).find((key) => params.sql.includes(key));
            if (!name) throw new Error(`Unexpected fixture SQL: ${params.sql}`);
            const queryId = `grid-query-${nextId++}`;
            queries.set(queryId, name);
            data = { queryId };
            break;
          }
          case 'getAsyncQueryResult': {
            const name = queries.get(params.queryId);
            if (!name) throw new Error(`Unknown fixture query: ${params.queryId}`);
            data =
              name === 'LoadingRows' && !loadingReleased
                ? { queryId: params.queryId, status: 'running' }
                : { queryId: params.queryId, status: 'completed', ...results[name] };
            break;
          }
          case 'getForeignKeys':
          case 'getReferencingForeignKeys':
          case 'getActiveQueries':
            data = [];
            break;
          case 'cancelAsyncQuery':
            data = { cancelled: true };
            break;
          default:
            data = defaults[request.method] ?? {};
        }
        return JSON.stringify({ success: true, data });
      };
    },
    { tables: TABLES, defaults: mockData }
  );
  await page.goto('/');
  await page.getByTestId('profile-node').click();
  await page.getByRole('dialog').getByRole('button', { name: '接続', exact: true }).click();
  await expect(page.getByText('データベースに接続', { exact: true })).toHaveCount(0);
  await page.getByRole('treeitem', { name: /Tables \(4\)/ }).click();
  await expect(page.getByRole('treeitem').filter({ hasText: 'WideRows' })).toBeVisible();
}

async function openTable(page: Page, name: TableName) {
  await page.getByRole('treeitem').filter({ hasText: name }).click();
  await expect(page.getByRole('tab').filter({ hasText: name })).toBeVisible();
}

async function closeTable(page: Page, name: TableName) {
  await page.getByRole('tab').filter({ hasText: name }).getByTitle('タブを閉じる').click();
  await expect(page.getByRole('tab').filter({ hasText: name })).toHaveCount(0);
}

async function settleFrames(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        );
      })
  );
}

async function expectGrid(page: Page, name: TableName, position: Position = ORIGIN) {
  const scroller = page.locator(SCROLLER);
  await expect(scroller).toBeVisible();
  // tbody が空でなくても上半分に欠落が残り得るため、固定ヘッダー直下からの
  // 実データ行の連続性、行番号・セル内容、ヒットテストを確認する。
  await expect
    .poll(
      async () => {
        return scroller.evaluate(
          (element, { name, shape, position }) => {
            const problems: string[] = [];
            const bounds = element.getBoundingClientRect();
            const header = element.querySelector('thead')?.getBoundingClientRect();
            const rows = Array.from(
              element.querySelectorAll<HTMLTableRowElement>('tr[data-row-index]')
            );
            if (!header || rows.length === 0) return ['Missing header or real rows'];
            const panel = element.parentElement?.getBoundingClientRect();
            if (!panel || bounds.bottom > panel.bottom + 1 || bounds.right > panel.right + 1)
              problems.push('Scroller escaped its flex panel');
            if (bounds.height < 100 || bounds.bottom > window.innerHeight)
              problems.push('Scroller has invalid viewport height');
            if (shape.rowCount > 100 && rows.length > 100)
              problems.push(`Virtualization rendered too many rows: ${rows.length}`);
            if (Math.abs(header.top - bounds.top) > 1)
              problems.push('Sticky header left the viewport top');
            if (Math.abs(element.scrollTop - position.top) > 1)
              problems.push(`scrollTop=${element.scrollTop}, expected ${position.top}`);
            if (Math.abs(element.scrollLeft - position.left) > 1)
              problems.push(`scrollLeft=${element.scrollLeft}, expected ${position.left}`);
            if (element.querySelectorAll('thead th').length !== shape.columnCount + 1)
              problems.push('Wrong column count');

            const top = header.bottom;
            const bottom = bounds.top + element.clientHeight;
            const visible = rows.filter((row) => {
              const rect = row.getBoundingClientRect();
              return rect.bottom > top && rect.top < bottom;
            });
            if (visible.length === 0) return [...problems, 'No real rows in viewport'];
            let coveredUntil = top;
            let previousIndex: number | undefined;
            for (const row of visible) {
              const index = Number(row.dataset.rowIndex);
              const rect = row.getBoundingClientRect();
              if (rect.top > coveredUntil + 1) problems.push(`Gap before row ${index}`);
              if (previousIndex !== undefined && index !== previousIndex + 1)
                problems.push(`Nonconsecutive row ${index}`);
              if (rect.height < 1) problems.push(`Zero-height row ${index}`);
              for (let c = 0; c < shape.columnCount; c++) {
                if (
                  row.querySelector(`[data-field="col_${c}"]`)?.textContent !==
                  `${name}:${index}:${c}`
                )
                  problems.push(`Wrong content in row ${index}, column ${c}`);
              }
              coveredUntil = Math.max(coveredUntil, rect.bottom);
              previousIndex = index;
            }
            if (previousIndex !== shape.rowCount - 1 && coveredUntil < bottom - 1)
              problems.push('Real rows do not cover viewport bottom');
            if (position.top === 0 && visible[0]?.dataset.rowIndex !== '0')
              problems.push('First row is missing at origin');
            if (shape.rowCount === 3 && visible.length !== 3)
              problems.push('Small table lost rows');

            const tableRight =
              element.querySelector('table')?.getBoundingClientRect().right ?? bounds.right;
            const x = Math.min(bounds.left + 100, tableRight - 10);
            for (let y = top + 2; y < Math.min(bottom, coveredUntil) - 1; y += 16) {
              const hit = document.elementFromPoint(x, y)?.closest('tr[data-row-index]');
              if (!hit || !element.contains(hit)) problems.push(`Blank/covered row at y=${y}`);
            }
            return problems;
          },
          { name, shape: TABLES[name], position }
        );
      },
      { message: `${name} must have contiguous visible rows at its own scroll position` }
    )
    .toEqual([]);
  await settleFrames(page);
}

async function scrollGrid(page: Page, position: Position) {
  await page.locator(SCROLLER).evaluate((element, value) => {
    element.scrollTop = value.top;
    element.scrollLeft = value.left;
  }, position);
  await settleFrames(page);
}

test.use({
  viewport: { width: 1280, height: 800 },
  screenshot: 'only-on-failure',
  trace: 'retain-on-failure',
});

test.describe('#779 グリッドのタブ切替ライフサイクル', () => {
  test('閉じる・再表示を繰り返しても実データ行とタブごとのスクロール位置を維持する', async ({
    page,
  }) => {
    await startApp(page);
    await openTable(page, 'WideRows');
    await expectGrid(page, 'WideRows');
    const widePosition = { top: 5600, left: 900 };
    await scrollGrid(page, widePosition);
    await expectGrid(page, 'WideRows', widePosition);
    await page.setViewportSize({ width: 1000, height: 600 });
    await expectGrid(page, 'WideRows', widePosition);
    await page.setViewportSize({ width: 1280, height: 800 });
    await expectGrid(page, 'WideRows', widePosition);

    await openTable(page, 'NarrowRows');
    await expectGrid(page, 'NarrowRows');
    const narrowPosition = { top: 2400, left: 0 };
    await scrollGrid(page, narrowPosition);
    await expectGrid(page, 'NarrowRows', narrowPosition);

    for (let cycle = 0; cycle < 4; cycle++) {
      await openTable(page, 'SmallRows');
      await expectGrid(page, 'SmallRows');
      await page.getByRole('tab').filter({ hasText: 'WideRows' }).click();
      await expectGrid(page, 'WideRows', widePosition);
      await page.getByRole('tab').filter({ hasText: 'NarrowRows' }).click();
      await expectGrid(page, 'NarrowRows', narrowPosition);
      await page.getByRole('tab').filter({ hasText: 'SmallRows' }).click();
      await closeTable(page, 'SmallRows');
      await expectGrid(page, 'NarrowRows', narrowPosition);
    }

    await closeTable(page, 'NarrowRows');
    await expectGrid(page, 'WideRows', widePosition);
    await openTable(page, 'NarrowRows');
    await expectGrid(page, 'NarrowRows');
    await test.info().attach('reopened-narrow-grid', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });

  test('読込中の閉じる・再表示と再取得で古い復元処理が現在の表示を壊さない', async ({ page }) => {
    await startApp(page);
    await openTable(page, 'WideRows');
    await expectGrid(page, 'WideRows');
    const widePosition = { top: 4800, left: 700 };
    await scrollGrid(page, widePosition);
    await expectGrid(page, 'WideRows', widePosition);

    await openTable(page, 'LoadingRows');
    await expect(page.getByText('クエリ実行中...', { exact: true })).toBeVisible();
    await expect(page.locator(SCROLLER)).toHaveCount(0);
    await closeTable(page, 'LoadingRows');
    await expectGrid(page, 'WideRows', widePosition);

    await openTable(page, 'LoadingRows');
    await expect(page.getByText('クエリ実行中...', { exact: true })).toBeVisible();
    await page.getByRole('tab').filter({ hasText: 'WideRows' }).click();
    await page.evaluate(() => window.dispatchEvent(new Event('release-grid-fixture')));
    await expectGrid(page, 'WideRows', widePosition);
    await page.getByRole('tab').filter({ hasText: 'LoadingRows' }).click();
    await expectGrid(page, 'LoadingRows');

    // 再取得では queryId が変わらず、スクロール要素だけが再作成される。
    const loadingPosition = { top: 3200, left: 600 };
    await scrollGrid(page, loadingPosition);
    await expectGrid(page, 'LoadingRows', loadingPosition);
    await page.evaluate(() => window.dispatchEvent(new Event('hold-grid-fixture')));
    await page.getByTitle('データを再取得 (F5)', { exact: true }).click();
    await expect(page.getByText('クエリ実行中...', { exact: true })).toBeVisible();
    await expect(page.locator(SCROLLER)).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new Event('release-grid-fixture')));
    await expectGrid(page, 'LoadingRows', loadingPosition);

    // 前の復元処理の保存抑止（2 フレーム）が終わる前に、1 フレームごとに切り替える。
    // 最後に選んだタブの状態が維持されることを確認する。
    await page.evaluate(async () => {
      for (const name of ['WideRows', 'LoadingRows', 'WideRows', 'LoadingRows']) {
        const tab = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).find(
          (element) => element.textContent === name
        );
        if (!tab) throw new Error(`Missing tab ${name}`);
        tab.click();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    });
    await expectGrid(page, 'LoadingRows', loadingPosition);
    await page.getByRole('tab').filter({ hasText: 'WideRows' }).click();
    await expectGrid(page, 'WideRows', widePosition);
    await test.info().attach('wide-grid-after-interrupted-loading', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
});
