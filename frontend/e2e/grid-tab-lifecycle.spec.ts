import { expect, type Page, test } from '@playwright/test';
import { mockData } from '../src/api/mockData';

// #779: 固定した IPC 応答で実際の ResultGrid / virtualizer を検証する。
// 対象はブラウザーの配置・内容であり、ネイティブ WebView2 の合成描画は検証できない。
const DIAGNOSTIC_SECRETS = {
  table: 'DiagnosticSecretRows',
  column: 'diagnostic_secret_column',
  cell: 'DIAGNOSTIC_PRIVATE_CELL',
  connection: 'diagnostic-private-connection',
  server: 'diagnostic-private-server',
  database: 'diagnostic-private-database',
  sql: 'DIAGNOSTIC_PRIVATE_SQL',
  reservedColumn: '__originalIndex',
  reservedValue: '123456789',
};
const TABLES = {
  WideRows: { rowCount: 1000, columnCount: 18 },
  NarrowRows: { rowCount: 800, columnCount: 3 },
  SmallRows: { rowCount: 3, columnCount: 2 },
  LoadingRows: { rowCount: 900, columnCount: 16 },
  EmptyRows: { rowCount: 0, columnCount: 2 },
  DiagnosticSecretRows: { rowCount: 12000, columnCount: 48 },
};
type TableName = keyof typeof TABLES;
type Position = { top: number; left: number };
const ORIGIN: Position = { top: 0, left: 0 };
const SCROLLER = '[class*="tableContainer"]';

async function startApp(page: Page) {
  await page.addInitScript(
    ({ tables, defaults, secrets }) => {
      const results = Object.fromEntries(
        Object.entries(tables).map(([name, { rowCount, columnCount }]) => [
          name,
          {
            columns: Array.from({ length: columnCount }, (_, c) => ({
              name:
                name !== secrets.table
                  ? `col_${c}`
                  : c === columnCount - 1
                    ? secrets.reservedColumn
                    : `${secrets.column}_${c}`,
              type: 'nvarchar',
            })),
            rows: Array.from({ length: rowCount }, (_, r) =>
              Array.from({ length: columnCount }, (_, c) =>
                name !== secrets.table
                  ? `${name}:${r}:${c}`
                  : c === columnCount - 1
                    ? secrets.reservedValue
                    : `${secrets.cell}:${r}:${c}`
              )
            ),
            affectedRows: 0,
            executionTimeMs: 1,
          },
        ])
      );
      const queries = new Map<string, string>();
      const frontendLogs: string[] = [];
      Object.defineProperty(window, 'gridFixtureLogs', { value: frontendLogs });
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
            data = { status: 'connected', connectionId: secrets.connection };
            break;
          case 'getConnectionProfiles':
            // ObjectTree に表示される保存済みプロファイル経由の接続を使う。
            data = {
              profiles: [
                {
                  id: 'grid-profile',
                  name: 'Grid lifecycle fixture',
                  server: secrets.server,
                  database: secrets.database,
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
            data = { sql: `SELECT * FROM ${params.tableName} /* ${secrets.sql} */` };
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
          case 'writeFrontendLog':
            frontendLogs.push(params.content);
            data = {};
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
    { tables: TABLES, defaults: mockData, secrets: DIAGNOSTIC_SECRETS }
  );
  await page.goto('/');
  await page.getByTestId('profile-node').click();
  await page.getByRole('dialog').getByRole('button', { name: '接続', exact: true }).click();
  await expect(page.getByText('データベースに接続', { exact: true })).toHaveCount(0);
  await page
    .getByRole('treeitem', { name: new RegExp(`Tables \\(${Object.keys(TABLES).length}\\)`) })
    .click();
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

const DIAGNOSTIC_MARKER = '[GridRenderDiagnostic]';
type LoggedGridDiagnostic = {
  schemaVersion: number;
  build: { frontendSource: string };
  model: {
    rowCount: number;
    virtualItemCount: number;
    virtualItems: unknown[];
    virtualizer: { scrollOffset: number };
  };
  truncated: { rows: boolean; virtualItems: boolean; bytes: boolean };
  dom: {
    container: { scrollTop: number; scrollLeft: number } | null;
    rowCount: number;
    rows: { cells: unknown[] }[];
  };
};

async function readDiagnostics(page: Page) {
  const lines = await page.evaluate(() => {
    const logs = Reflect.get(window, 'gridFixtureLogs') as string[];
    return logs.join('\n').split('\n');
  });
  return lines
    .filter((line) => line.includes(DIAGNOSTIC_MARKER))
    .map((line) => {
      const json = line.slice(line.indexOf(DIAGNOSTIC_MARKER) + DIAGNOSTIC_MARKER.length).trim();
      return { json, payload: JSON.parse(json) as LoggedGridDiagnostic };
    });
}

async function expectDiagnosticCount(page: Page, count: number) {
  await expect
    .poll(async () => (await readDiagnostics(page)).length, {
      message: 'Each manual capture must reach the existing writeFrontendLog IPC exactly once',
    })
    .toBe(count);
  return readDiagnostics(page);
}

test.describe('#779 手動のグリッド表示診断', () => {
  test('繰り返し採取してもスクロール位置と同じ DOM ノードを維持する', async ({ page }) => {
    await startApp(page);
    await openTable(page, 'WideRows');
    await expectGrid(page, 'WideRows');
    const position = { top: 5600, left: 900 };
    await scrollGrid(page, position);
    await expectGrid(page, 'WideRows', position);
    expect(await readDiagnostics(page)).toEqual([]);

    const before = await page.locator(SCROLLER).evaluateHandle((container) => ({
      container,
      table: container.querySelector('table'),
      rows: Array.from(container.querySelectorAll('tr[data-row-index]')),
      cells: Array.from(container.querySelectorAll('tr[data-row-index] td')),
    }));
    const capture = page.getByRole('button', { name: '表示診断', exact: true });
    await expect(capture).toHaveAttribute('title', '表示診断をログに記録（セル値なし）');

    for (let attempt = 1; attempt <= 4; attempt++) {
      await capture.click();
      const diagnostics = await expectDiagnosticCount(page, attempt);
      const diagnostic = diagnostics[attempt - 1].payload;
      expect(diagnostic.schemaVersion).toBe(1);
      expect(diagnostic.dom.container).toMatchObject({
        scrollTop: position.top,
        scrollLeft: position.left,
      });
      expect(diagnostic.model.rowCount).toBe(TABLES.WideRows.rowCount);
      expect(diagnostic.dom.rows.length).toBeGreaterThan(0);
      expect(
        await before.evaluate((snapshot) => {
          const currentRows = Array.from(snapshot.container.querySelectorAll('tr[data-row-index]'));
          const currentCells = Array.from(
            snapshot.container.querySelectorAll('tr[data-row-index] td')
          );
          return (
            snapshot.container.isConnected &&
            snapshot.table === snapshot.container.querySelector('table') &&
            snapshot.rows.length === currentRows.length &&
            snapshot.rows.every((row, index) => row === currentRows[index]) &&
            snapshot.cells.length === currentCells.length &&
            snapshot.cells.every((cell, index) => cell === currentCells[index])
          );
        })
      ).toBe(true);
      await expectGrid(page, 'WideRows', position);
    }
    await before.dispose();
  });

  test('編集中の値・入力要素・フォーカス・選択範囲を変えずに採取する', async ({ page }) => {
    await startApp(page);
    await openTable(page, 'WideRows');
    await expectGrid(page, 'WideRows');
    await scrollGrid(page, { top: 5600, left: 900 });
    const rowIndex = await page.locator(SCROLLER).evaluate((container) => {
      const headerBottom = container.querySelector('thead')?.getBoundingClientRect().bottom;
      if (headerBottom === undefined) throw new Error('Missing fixture header');
      const row = Array.from(
        container.querySelectorAll<HTMLTableRowElement>('tr[data-row-index]')
      ).find((element) => element.getBoundingClientRect().top >= headerBottom);
      if (!row) throw new Error('Missing visible fixture row');
      return row.dataset.rowIndex;
    });
    await page.locator(`tr[data-row-index="${rowIndex}"] td[data-field="col_7"]`).dblclick();
    const input = page.locator(`${SCROLLER} input[type="text"]`);
    const draft = 'DIAGNOSTIC_PRIVATE_UNSAVED_EDIT';
    await expect(input).toBeFocused();
    await input.fill(draft);
    await input.evaluate((element: HTMLInputElement) => element.setSelectionRange(3, 9));
    await settleFrames(page);
    const before = await input.evaluateHandle((element: HTMLInputElement) => ({
      input: element,
      selectionStart: element.selectionStart,
      selectionEnd: element.selectionEnd,
      container: element.closest('[class*="tableContainer"]'),
    }));
    const position = await page.locator(SCROLLER).evaluate((element) => ({
      top: element.scrollTop,
      left: element.scrollLeft,
    }));

    for (let attempt = 1; attempt <= 3; attempt++) {
      // 実際の pointer 操作で onBlur による確定が起きないことも検証する。
      await page.getByRole('button', { name: '表示診断', exact: true }).click();
      const diagnostics = await expectDiagnosticCount(page, attempt);
      await expect(input).toBeFocused();
      await expect(input).toHaveValue(draft);
      expect(
        await before.evaluate((snapshot) => ({
          sameInput:
            snapshot.input.isConnected &&
            snapshot.input === document.activeElement &&
            snapshot.container?.contains(snapshot.input),
          selectionStart: snapshot.input.selectionStart,
          selectionEnd: snapshot.input.selectionEnd,
          top: snapshot.container?.scrollTop,
          left: snapshot.container?.scrollLeft,
        }))
      ).toEqual({
        sameInput: true,
        selectionStart: 3,
        selectionEnd: 9,
        ...position,
      });
      expect(diagnostics[attempt - 1].json).not.toContain(draft);
    }
    await before.dispose();
    await input.press('Escape');
  });

  test('開いているコンテキストメニューを閉じずに採取する', async ({ page }) => {
    await startApp(page);
    await openTable(page, 'WideRows');
    await expectGrid(page, 'WideRows');
    await page.locator('tr[data-row-index="0"] td[data-field="col_1"]').click({ button: 'right' });
    const menuItem = page.getByRole('button', { name: 'セル値をコピー', exact: true });
    await expect(menuItem).toBeVisible();
    // ContextMenu の遅延登録された document mousedown リスナーも有効な状態にする。
    await settleFrames(page);
    const before = await menuItem.evaluateHandle((element) => ({
      item: element,
      menu: element.parentElement,
    }));

    for (let attempt = 1; attempt <= 2; attempt++) {
      await page.getByRole('button', { name: '表示診断', exact: true }).click();
      await expectDiagnosticCount(page, attempt);
      await expect(menuItem).toBeVisible();
      expect(
        await before.evaluate(
          (snapshot) => snapshot.item.isConnected && snapshot.menu === snapshot.item.parentElement
        )
      ).toBe(true);
      await expectGrid(page, 'WideRows');
    }
    await before.dispose();
  });

  test('大きい結果でも採取量を制限しセル値・列名・テーブル名・接続情報・SQLを含めない', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 3000 });
    await startApp(page);
    await openTable(page, 'DiagnosticSecretRows');
    await expect(page.locator(SCROLLER)).toBeVisible();
    await expect(
      page.locator(`td[data-field="${DIAGNOSTIC_SECRETS.column}_0"]`).first()
    ).toContainText(DIAGNOSTIC_SECRETS.cell);
    await scrollGrid(page, { top: 180000, left: 900 });
    await expect.poll(async () => page.locator('tr[data-row-index]').count()).toBeGreaterThan(80);
    const renderedCount = await page.locator('tr[data-row-index]').count();

    await page.getByRole('button', { name: '表示診断', exact: true }).click();
    const [{ json, payload }] = await expectDiagnosticCount(page, 1);
    expect(payload.schemaVersion).toBe(1);
    expect(typeof payload.build.frontendSource).toBe('string');
    expect(payload.build.frontendSource).toMatch(/^[0-9a-f]{12,40}(?:-dirty)?$/);
    expect(payload.model.rowCount).toBe(TABLES.DiagnosticSecretRows.rowCount);
    expect(payload.dom.rowCount).toBe(renderedCount);
    expect(payload.model.virtualItemCount).toBe(renderedCount);
    expect(payload.model.virtualizer.scrollOffset).toBe(180000);
    expect(payload.truncated.rows).toBe(true);
    expect(payload.truncated.virtualItems).toBe(true);
    expect(payload.dom.rows.length).toBeGreaterThan(0);
    expect(payload.dom.rows.length).toBeLessThanOrEqual(40);
    for (const row of payload.dom.rows) {
      expect(row.cells.length).toBeGreaterThan(0);
      expect(row.cells.length).toBeLessThanOrEqual(3);
    }
    expect(payload.model.virtualItems.length).toBeGreaterThan(0);
    expect(payload.model.virtualItems.length).toBeLessThanOrEqual(80);
    expect(Buffer.byteLength(json, 'utf8')).toBeLessThanOrEqual(64 * 1024);
    for (const secret of Object.values(DIAGNOSTIC_SECRETS)) {
      expect(json).not.toContain(secret);
    }
    expect(json).not.toContain('SELECT *');
    expect(json).not.toContain('grid-query-');
    expect(json).not.toContain('textContent');
    expect(json).not.toContain('innerHTML');
  });

  test('空結果・読込中・タブを閉じた後も安全で自動採取しない', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await startApp(page);
    const capture = page.getByRole('button', { name: '表示診断', exact: true });
    await expect(capture).toHaveCount(0);
    await openTable(page, 'EmptyRows');
    await expect(capture).toBeVisible();
    await capture.click();
    const [{ payload }] = await expectDiagnosticCount(page, 1);
    expect(payload.model.rowCount).toBe(0);
    expect(payload.dom.rowCount).toBe(0);
    expect(payload.dom.rows).toEqual([]);
    expect(payload.model.virtualItems).toEqual([]);
    await closeTable(page, 'EmptyRows');
    await expect(capture).toHaveCount(0);

    await openTable(page, 'LoadingRows');
    await expect(page.getByText('クエリ実行中...', { exact: true })).toBeVisible();
    await expect(capture).toHaveCount(0);
    await closeTable(page, 'LoadingRows');
    await page.evaluate(() => window.dispatchEvent(new Event('release-grid-fixture')));
    await settleFrames(page);
    await expect(capture).toHaveCount(0);
    expect(await readDiagnostics(page)).toHaveLength(1);

    await openTable(page, 'LoadingRows');
    await expectGrid(page, 'LoadingRows');
    await capture.click();
    const diagnostics = await expectDiagnosticCount(page, 2);
    expect(diagnostics[1].payload.model.rowCount).toBe(TABLES.LoadingRows.rowCount);
    expect(errors).toEqual([]);
  });
});
