import { expect, type Page, test } from '@playwright/test';

import { recordBenchResults } from './helpers/benchRecorder';

/**
 * #494/#597 Frontend 計測基盤 — 初回マウント duration ベースライン取得 (自動化)
 *
 * useFirstRenderMark / useERDiagramRenderMark (frontend/src/utils/perfMarks.ts) が記録する
 * measure entry を取得する。dev server (Vite) 経由のため duration は production preview /
 * WebView2 と一致しない。リグレッション検出の基準値として記録する。
 *
 * 実行方法: CLAUDE.md「E2Eテスト (Playwright)」参照 (image タグは bun.lock の @playwright/test バージョンに合わせること)
 *
 */

/**
 * ResultGrid 計測用フィクスチャ (1000行 × 10列) を生成する。
 * getAsyncQueryResult IPC の mock レスポンスとして使用する。
 */
function buildResultGridFixture({ rowCount, colCount }: { rowCount: number; colCount: number }) {
  const columns = Array.from({ length: colCount }, (_, i) => ({
    name: `col_${i}`,
    type: 'nvarchar',
  }));
  const rows = Array.from({ length: rowCount }, (_, r) =>
    Array.from({ length: colCount }, (_, c) => `v${r}_${c}`)
  );
  return {
    queryId: 'mock-q-1',
    status: 'completed',
    columns,
    rows,
    affectedRows: 0,
    executionTimeMs: 10,
  };
}

/**
 * ER 図フィクスチャ (50テーブル) を生成する。
 * frontend/e2e/fixtures/er-diagram-50tables.json と同等のデータ (parseERDiagram IPC の mock レスポンス)。
 * ESM 環境で __dirname が使えないため fs.readFileSync の代わりにプログラマチックに生成する。
 */
function buildERFixture() {
  const tables = Array.from({ length: 50 }, (_, i) => ({
    name: `table_${String(i + 1).padStart(3, '0')}`,
    logicalName: `Table ${String(i + 1).padStart(3, '0')}`,
    comment: '',
    columns: [
      {
        name: 'id',
        logicalName: 'id',
        type: 'INT',
        size: 0,
        scale: 0,
        nullable: false,
        isPrimaryKey: true,
        defaultValue: '',
        comment: '',
        color: '',
      },
      {
        name: 'name',
        logicalName: 'name',
        type: 'NVARCHAR',
        size: 100,
        scale: 0,
        nullable: false,
        isPrimaryKey: false,
        defaultValue: '',
        comment: '',
        color: '',
      },
      {
        name: 'value',
        logicalName: 'value',
        type: 'NVARCHAR',
        size: 255,
        scale: 0,
        nullable: true,
        isPrimaryKey: false,
        defaultValue: '',
        comment: '',
        color: '',
      },
    ],
    indexes: [],
    posX: (i % 10) * 200,
    posY: Math.floor(i / 10) * 250,
    page: 'MAIN',
    color: '',
    bkColor: '',
  }));

  const relations = Array.from({ length: 49 }, (_, i) => ({
    name: `FK_table_${String(i + 2).padStart(3, '0')}_table_${String(i + 1).padStart(3, '0')}`,
    parentTable: `table_${String(i + 1).padStart(3, '0')}`,
    childTable: `table_${String(i + 2).padStart(3, '0')}`,
    parentColumn: 'id',
    childColumn: 'id',
    cardinality: '1:N',
  }));

  return {
    name: 'Fixture50Tables',
    databaseType: 'SQLServer',
    tables,
    relations,
    shapes: [],
    ddl: '',
  };
}

const resultGridFixture1k = buildResultGridFixture({ rowCount: 1000, colCount: 10 });

const erFixture = buildERFixture();

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

/** ER 図計測用: loadSession で ER 図タブを初期ロードし、parseERDiagram を mock する */
const MOCK_INVOKE_SCRIPT_ER = `
  const ER_FIXTURE = ${JSON.stringify(erFixture)};
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
    if (method === 'parseERDiagram') {
      return JSON.stringify({ success: true, data: ER_FIXTURE });
    }
    return JSON.stringify({ success: true, data: {} });
  };
`;

/** ResultGrid 計測用: connectAsync → getAsyncQueryResult で 1000行を返し result-grid measure を取得 */
const MOCK_INVOKE_SCRIPT_RESULT_GRID = `
  const RESULT_FIXTURE = ${JSON.stringify(resultGridFixture1k)};
  const RESULT_RESPONSE_STR = JSON.stringify({ success: true, data: RESULT_FIXTURE });
  window.invoke = async (requestStr) => {
    let method = '';
    try { method = JSON.parse(requestStr).method; } catch (_e) {}
    if (method === 'loadSession') {
      return JSON.stringify({
        success: true,
        data: { queries: [], activeQueryId: null, connectionProfiles: [], window: {} },
      });
    }
    if (method === 'connectAsync') {
      return JSON.stringify({ success: true, data: { requestId: 'req-1' } });
    }
    if (method === 'getConnectResult') {
      return JSON.stringify({ success: true, data: { status: 'connected', connectionId: 'mock-conn-1' } });
    }
    if (method === 'getDatabases') {
      return JSON.stringify({ success: true, data: ['master'] });
    }
    if (method === 'getTables') {
      return JSON.stringify({ success: true, data: [] });
    }
    if (method === 'executeAsyncQuery') {
      return JSON.stringify({ success: true, data: { queryId: 'mock-q-1' } });
    }
    if (method === 'getAsyncQueryResult') {
      return RESULT_RESPONSE_STR;
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
 * 取得しない marks (collectDurations の TARGETS 外):
 * - (なし。result-grid は #501 describe で個別取得)
 */
const TARGETS = ['startup', 'object-tree', 'sql-editor'] as const;
type TargetName = (typeof TARGETS)[number];

/**
 * README #1「アプリ起動 < 0.3s」に対応するリグレッション上限 (Playwright Chromium headless 基準)。
 * 実測ベースライン 191.7ms の ~1.2x。300ms は README 目標値だが headless CI には粗すぎるため絞っている。
 */
const STARTUP_TARGET_MS = 230;

/** README #9「ER 図レンダリング (50テーブル) < 500ms」に対応するリグレッション上限 */
const ER_DIAGRAM_TARGET_MS = 500;

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

    // #515: assertion より前に docs/perf/e2e-benchmark.json へ記録 (fail しても実測値を残す)
    recordBenchResults(
      durations.map((d) => ({
        scenario: 'app-mount',
        metric: d.name,
        durationMs: d.duration_ms,
        targetMs: d.name === 'startup' ? STARTUP_TARGET_MS : undefined,
      }))
    );

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

test.describe('#597 ER diagram baseline', () => {
  test('should_record_er_diagram_50_duration_when_50tables_loaded', async ({ page }) => {
    await page.addInitScript(MOCK_INVOKE_SCRIPT_ER);
    await page.goto('/');

    // startup mark 待機後、+ ボタン → 新規ER図 → ER 図タブを開く
    await page.waitForFunction(
      () => performance.getEntriesByName('startup', 'measure').length > 0,
      {
        timeout: 15_000,
      }
    );
    await page.click('button[title="新規タブ (Ctrl+N)"]');
    await page.click('button:has-text("新規ER図")');

    // ER 図タブが active になり「ER図ファイルを読み込む」ボタンが表示されるまで待機
    await page.waitForSelector('button:has-text("ER図ファイルを読み込む")', { timeout: 10_000 });

    // ER 図インポートダイアログを開く
    await page.click('button:has-text("ER図ファイルを読み込む")');
    await page.waitForSelector('text=ER図ファイルをインポート', { timeout: 5_000 });

    // input[type="file"] に dummy ファイルをセット → handleFileSelect → parseERDiagram mock が呼ばれる
    await page.setInputFiles('input[type="file"]', {
      name: 'fixture.a5er',
      mimeType: 'text/plain',
      buffer: Buffer.from('# A5:ER FORMAT:19\n'),
    });

    // parseERDiagram の mock レスポンスが反映されるまで待機 (「ER図にインポート」が有効化)
    await page.waitForSelector('button:has-text("ER図にインポート"):not([disabled])', {
      timeout: 10_000,
    });

    // インポート実行
    await page.click('button:has-text("ER図にインポート")');

    // er-diagram-50 measure entry が記録されるまで待機 (50 テーブルが描画されると hook が発火)
    await page.waitForFunction(
      () => performance.getEntriesByName('er-diagram-50', 'measure').length > 0,
      { timeout: 30_000 }
    );

    const durationMs = await page.evaluate(() => {
      const entry = performance.getEntriesByName('er-diagram-50', 'measure')[0];
      return entry ? Number(entry.duration.toFixed(2)) : null;
    });

    console.log(`[#597 baseline] er-diagram-50=${durationMs}ms`);

    // #515: assertion より前に docs/perf/e2e-benchmark.json へ記録 (fail しても実測値を残す)
    recordBenchResults([
      {
        scenario: 'er-diagram',
        metric: 'er-diagram-50',
        durationMs,
        targetMs: ER_DIAGRAM_TARGET_MS,
      },
    ]);
    test
      .info()
      .annotations.push({ type: 'perf-baseline', description: `er-diagram-50=${durationMs}ms` });

    expect(durationMs).not.toBeNull();
    expect(durationMs).toBeGreaterThan(0.1);
    expect(durationMs).toBeLessThan(ER_DIAGRAM_TARGET_MS);
  });
});

test.describe('#501 ResultGrid baseline', () => {
  test('should_record_result_grid_duration_when_1k_rows_loaded', async ({ page }) => {
    await page.addInitScript(MOCK_INVOKE_SCRIPT_RESULT_GRID);
    await page.goto('/');

    // startup mark 待機
    await page.waitForFunction(
      () => performance.getEntriesByName('startup', 'measure').length > 0,
      { timeout: 15_000 }
    );

    // 接続ダイアログを開く
    await page.click('button[title="新規接続"]');
    await page.waitForSelector('#conn-server', { timeout: 10_000 });

    // 接続フォーム入力 (SQL Server, localhost/master)
    await page.fill('#conn-name', 'Baseline Test');
    await page.fill('#conn-server', 'localhost');
    await page.fill('#conn-database', 'master');

    // ConnectionDialog フッターの接続ボタン (data-testid="conn-submit" で一意に識別)
    await page.locator('[data-testid="conn-submit"]').click();

    // 接続ダイアログが閉じるまで待機 (#conn-server が DOM から消える)
    await page.waitForSelector('#conn-server', { state: 'detached', timeout: 15_000 });

    // 接続後は SQL エディタタブが自動で開かないため Ctrl+N で開く
    await page.keyboard.press('Control+n');
    await page.waitForSelector('.monaco-editor', { timeout: 10_000 });

    // クエリ入力・実行 (実行ショートカットは F9)
    await page.click('.monaco-editor');
    await page.keyboard.press('Control+a');
    await page.keyboard.type('SELECT 1');
    // 実行ボタンが enabled になるまで待機 (接続完了後に connectionId がセットされる)
    await page.waitForSelector('button[title="実行 (F9)"]:not([disabled])', { timeout: 10_000 });
    await page.keyboard.press('F9');

    // result-grid measure が記録されるまで待機
    await page.waitForFunction(
      () => performance.getEntriesByName('result-grid', 'measure').length > 0,
      { timeout: 30_000 }
    );

    const durationMs = await page.evaluate(() => {
      const entry = performance.getEntriesByName('result-grid', 'measure')[0];
      return entry ? Number(entry.duration.toFixed(2)) : null;
    });

    console.log(`[#501 baseline] result-grid-1k=${durationMs}ms`);

    // #515: assertion より前に docs/perf/e2e-benchmark.json へ記録 (fail しても実測値を残す)
    // 上限 assertion 未導入のため targetMs は省略 (#501 最適化完了後に追加)
    recordBenchResults([{ scenario: 'result-grid', metric: 'result-grid-1k', durationMs }]);
    test
      .info()
      .annotations.push({ type: 'perf-baseline', description: `result-grid-1k=${durationMs}ms` });

    expect(durationMs).not.toBeNull();
    expect(durationMs).toBeGreaterThan(0.1);
    // TODO(@TakumiOkayasu): #501 最適化完了後に上限 assertion を追加する
    // expect(durationMs).toBeLessThan(RESULT_GRID_TARGET_MS); // 目標: 100ms
  });
});
