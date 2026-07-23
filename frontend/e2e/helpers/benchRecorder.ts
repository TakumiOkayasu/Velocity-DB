import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * #515 E2E パフォーマンスベンチマーク結果の JSON 記録ヘルパー。
 *
 * perf-baseline.spec.ts の各シナリオが計測直後 (assertion より前) に recordBenchResults を
 * 呼び出し、`docs/perf/e2e-benchmark.json` を read-modify-write で更新する。
 *
 * - キーは scenario + metric。再実行時は同一キーのエントリを上書きするため、
 *   ベンチ spec 全体を実行すれば全エントリが最新値に置き換わる (決定的な "latest" ファイル)。
 * - 計測値の記録は assertion (リグレッション上限) の成否に依存しない。
 *   上限超過でテスト自体が fail しても JSON には実測値が残る。
 * - 並列安全性: perf-baseline.spec.ts は単一ファイルのため Playwright の既定設定
 *   (fullyParallel なし) では 1 worker で逐次実行される。他 spec は本ヘルパーを
 *   使用しないため、同一ファイルへの並行書き込みは発生しない。
 */

export type BenchEntry = {
  /** シナリオ識別子 (例: 'app-mount', 'er-diagram', 'result-grid') */
  scenario: string;
  /** performance measure 名 (例: 'startup', 'er-diagram-50', 'result-grid-1k') */
  metric: string;
  /** 計測値 (ms)。measure entry が取得できなかった場合は null */
  durationMs: number | null;
  /** リグレッション上限 (ms)。上限 assertion のないメトリクスでは省略 */
  targetMs?: number;
};

type BenchFileMeta = {
  generatedAt: string;
  gitCommit: string;
  playwrightVersion: string;
  environment: string;
  note: string;
};

type BenchFile = {
  meta: BenchFileMeta;
  results: BenchEntry[];
};

const NOTE =
  'Vite dev server + mocked window.invoke (page.addInitScript) による frontend レンダリングのみの' +
  'リグレッション基準値。production WebView2 / 実 DB の実測値ではない。';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const outputPath = path.join(repoRoot, 'docs', 'perf', 'e2e-benchmark.json');

function detectGitCommit(): string {
  const fromEnv = process.env.VELOCITYDB_GIT_COMMIT;
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    return fromEnv.trim();
  }
  try {
    // Docker コンテナ内では .git が参照できない / dubious ownership で失敗することがある。
    // その場合は VELOCITYDB_GIT_COMMIT (docker run -e で注入) か 'unknown' にフォールバック。
    return execSync('git rev-parse --short HEAD', {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

function detectEnvironment(): string {
  const fromEnv = process.env.VELOCITYDB_BENCH_ENV;
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    return fromEnv.trim();
  }
  if (fs.existsSync('/.dockerenv')) {
    return 'docker';
  }
  return process.platform;
}

function detectPlaywrightVersion(): string {
  try {
    const nodeRequire = createRequire(import.meta.url);
    const pkg = nodeRequire('@playwright/test/package.json') as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function isBenchEntry(value: unknown): value is BenchEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return typeof entry.scenario === 'string' && typeof entry.metric === 'string';
}

function readExistingResults(): BenchEntry[] {
  try {
    const raw = fs.readFileSync(outputPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<BenchFile>;
    if (Array.isArray(parsed.results)) {
      return parsed.results.filter(isBenchEntry);
    }
  } catch {
    // ファイル未作成 or 壊れている場合は新規作成する
  }
  return [];
}

/**
 * ベンチ結果を docs/perf/e2e-benchmark.json に記録する。
 * 同一 scenario + metric のエントリは上書き、それ以外は保持する。
 */
export function recordBenchResults(entries: BenchEntry[]): void {
  const merged = new Map<string, BenchEntry>();
  for (const entry of readExistingResults()) {
    merged.set(`${entry.scenario}::${entry.metric}`, entry);
  }
  for (const entry of entries) {
    merged.set(`${entry.scenario}::${entry.metric}`, entry);
  }
  const results = [...merged.values()].sort(
    (a, b) => a.scenario.localeCompare(b.scenario) || a.metric.localeCompare(b.metric)
  );
  const file: BenchFile = {
    meta: {
      generatedAt: new Date().toISOString(),
      gitCommit: detectGitCommit(),
      playwrightVersion: detectPlaywrightVersion(),
      environment: detectEnvironment(),
      note: NOTE,
    },
    results,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
}
