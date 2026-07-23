// データ比較 (#256): 2つの結果セット (テーブル / クエリ結果) をキーカラムで突き合わせ、
// added / removed / modified / identical に分類する UI 非依存の純粋 diff エンジン。
//
// 仕様:
// - キーカラム: ユーザー選択 (未指定時は共通カラムの先頭 1 つ)。複合キー対応。
// - カラム集合が異なる場合は共通カラム (A のカラム順) のみ比較し、片側のみのカラムは報告する。
// - NULL と空文字列は区別する (SQL の NULL semantics に合わせ null !== '')。
// - キー重複時は警告を出し、同一キー内では出現順 (位置) で対応付けて比較する。
// - 計算量はキーの Map 構築により O(n)。MAX_COMPARE_ROWS (100,000 行/片側) を超えた分は
//   打ち切って警告する。diffResultSetsAsync はチャンク処理で UI スレッドを塞がない。

export interface DiffColumn {
  name: string;
  type: string;
}

export interface DiffResultSet {
  columns: DiffColumn[];
  rows: (string | null)[][];
}

export type DiffRowStatus = 'added' | 'removed' | 'modified' | 'identical';

export interface DiffRow {
  status: DiffRowStatus;
  /** キー値の表示用文字列 (NULL は "NULL"、複合キーは " | " 区切り) */
  keyDisplay: string;
  /** 共通カラム順に射影した A 側の値。added 行は null */
  a: (string | null)[] | null;
  /** 共通カラム順に射影した B 側の値。removed 行は null */
  b: (string | null)[] | null;
  /** modified 行のみ: 共通カラムごとの変更フラグ。それ以外の status では null */
  changedCells: boolean[] | null;
}

export interface DiffSummary {
  added: number;
  removed: number;
  modified: number;
  identical: number;
}

export interface DataDiffResult {
  /** 比較対象となった共通カラム名 (A のカラム順) */
  columns: string[];
  /** 実際に使用したキーカラム */
  keyColumns: string[];
  /** removed/modified/identical は A の行順、added は末尾に B の行順で並ぶ */
  rows: DiffRow[];
  summary: DiffSummary;
  warnings: string[];
  aOnlyColumns: string[];
  bOnlyColumns: string[];
  /** 行数上限 (maxRows) により一部のみ比較した場合 true */
  truncated: boolean;
}

export interface DiffOptions {
  /** キーカラム名。省略時は共通カラムの先頭 1 つ */
  keyColumns?: string[];
  /** 片側あたりの比較上限行数 (デフォルト MAX_COMPARE_ROWS) */
  maxRows?: number;
}

/** 片側あたりの比較上限行数。超過分は打ち切って warning を出す */
export const MAX_COMPARE_ROWS = 100_000;

/** diffResultSetsAsync の 1 チャンクで処理する行数 */
export const DIFF_CHUNK_SIZE = 5_000;

/** 警告メッセージに列挙する重複キーの最大数 */
const MAX_LISTED_DUPLICATE_KEYS = 5;

interface KeyBucket {
  /** B 側の行 index (昇順) */
  indices: number[];
  /** 位置対応付けで消費済みの数 */
  used: number;
}

interface DiffSession {
  readonly done: boolean;
  /** 最大 budget 行分の処理を進める */
  step(budget: number): void;
  /** done 後に呼び出して結果を得る */
  result(): DataDiffResult;
}

function makeKey(row: (string | null)[], keyIndices: number[]): string {
  // JSON 化により null と '' 、区切り文字を含む値を衝突なく区別する
  return JSON.stringify(keyIndices.map((i) => row[i]));
}

function makeKeyDisplay(row: (string | null)[], keyIndices: number[]): string {
  return keyIndices.map((i) => row[i] ?? 'NULL').join(' | ');
}

function project(row: (string | null)[], indices: number[]): (string | null)[] {
  return indices.map((i) => row[i]);
}

function listKeys(keys: string[]): string {
  const listed = keys.slice(0, MAX_LISTED_DUPLICATE_KEYS).join(', ');
  return keys.length > MAX_LISTED_DUPLICATE_KEYS ? `${listed}, ...` : listed;
}

function createDiffSession(a: DiffResultSet, b: DiffResultSet, options?: DiffOptions): DiffSession {
  const maxRows = options?.maxRows ?? MAX_COMPARE_ROWS;

  const aNames = a.columns.map((c) => c.name);
  const bNames = b.columns.map((c) => c.name);
  const aNameSet = new Set(aNames);
  const bNameSet = new Set(bNames);

  const columns = aNames.filter((n) => bNameSet.has(n));
  if (columns.length === 0) {
    throw new Error('共通カラムが存在しないため比較できません');
  }
  const aOnlyColumns = aNames.filter((n) => !bNameSet.has(n));
  const bOnlyColumns = bNames.filter((n) => !aNameSet.has(n));

  const requestedKeys = options?.keyColumns ?? [];
  const keyColumns = requestedKeys.length > 0 ? [...requestedKeys] : [columns[0]];
  for (const key of keyColumns) {
    if (!columns.includes(key)) {
      throw new Error(`キーカラム "${key}" は両方の結果セットに存在する必要があります`);
    }
  }

  const aIndexByName = new Map(aNames.map((n, i) => [n, i]));
  const bIndexByName = new Map(bNames.map((n, i) => [n, i]));
  const lookup = (map: Map<string, number>, name: string): number => map.get(name) ?? -1;
  const aCommonIdx = columns.map((n) => lookup(aIndexByName, n));
  const bCommonIdx = columns.map((n) => lookup(bIndexByName, n));
  const aKeyIdx = keyColumns.map((n) => lookup(aIndexByName, n));
  const bKeyIdx = keyColumns.map((n) => lookup(bIndexByName, n));

  const aTruncated = a.rows.length > maxRows;
  const bTruncated = b.rows.length > maxRows;
  const aRows = aTruncated ? a.rows.slice(0, maxRows) : a.rows;
  const bRows = bTruncated ? b.rows.slice(0, maxRows) : b.rows;

  const buckets = new Map<string, KeyBucket>();
  const bConsumed = new Uint8Array(bRows.length);
  const aKeyCounts = new Map<string, number>();
  const duplicateKeysA: string[] = [];
  const duplicateKeysB: string[] = [];

  const rows: DiffRow[] = [];
  const summary: DiffSummary = { added: 0, removed: 0, modified: 0, identical: 0 };

  // phase 0: B をキーで index / 1: A を走査 / 2: B の未消費行を added として収集 / 3: 完了
  let phase = 0;
  let cursor = 0;
  let finalResult: DataDiffResult | null = null;

  const indexBRows = (budget: number): number => {
    const end = Math.min(cursor + budget, bRows.length);
    let used = 0;
    for (; cursor < end; cursor++, used++) {
      const key = makeKey(bRows[cursor], bKeyIdx);
      const bucket = buckets.get(key);
      if (bucket === undefined) {
        buckets.set(key, { indices: [cursor], used: 0 });
      } else {
        if (bucket.indices.length === 1) {
          duplicateKeysB.push(makeKeyDisplay(bRows[cursor], bKeyIdx));
        }
        bucket.indices.push(cursor);
      }
    }
    return used;
  };

  const walkARows = (budget: number): number => {
    const end = Math.min(cursor + budget, aRows.length);
    let used = 0;
    for (; cursor < end; cursor++, used++) {
      const row = aRows[cursor];
      const key = makeKey(row, aKeyIdx);
      const seen = aKeyCounts.get(key) ?? 0;
      if (seen === 1) {
        duplicateKeysA.push(makeKeyDisplay(row, aKeyIdx));
      }
      aKeyCounts.set(key, seen + 1);

      const keyDisplay = makeKeyDisplay(row, aKeyIdx);
      const aValues = project(row, aCommonIdx);
      const bucket = buckets.get(key);
      if (bucket !== undefined && bucket.used < bucket.indices.length) {
        const bRowIndex = bucket.indices[bucket.used];
        bucket.used += 1;
        bConsumed[bRowIndex] = 1;
        const bValues = project(bRows[bRowIndex], bCommonIdx);
        let anyChanged = false;
        const changedCells = aValues.map((v, i) => {
          const changed = v !== bValues[i];
          if (changed) anyChanged = true;
          return changed;
        });
        if (anyChanged) {
          summary.modified += 1;
          rows.push({ status: 'modified', keyDisplay, a: aValues, b: bValues, changedCells });
        } else {
          summary.identical += 1;
          rows.push({
            status: 'identical',
            keyDisplay,
            a: aValues,
            b: bValues,
            changedCells: null,
          });
        }
      } else {
        summary.removed += 1;
        rows.push({ status: 'removed', keyDisplay, a: aValues, b: null, changedCells: null });
      }
    }
    return used;
  };

  const collectAdded = (budget: number): number => {
    const end = Math.min(cursor + budget, bRows.length);
    let used = 0;
    for (; cursor < end; cursor++, used++) {
      if (bConsumed[cursor] === 1) continue;
      const row = bRows[cursor];
      summary.added += 1;
      rows.push({
        status: 'added',
        keyDisplay: makeKeyDisplay(row, bKeyIdx),
        a: null,
        b: project(row, bCommonIdx),
        changedCells: null,
      });
    }
    return used;
  };

  const buildResult = (): DataDiffResult => {
    const warnings: string[] = [];
    if (aTruncated || bTruncated) {
      const sides = [aTruncated ? 'A' : null, bTruncated ? 'B' : null].filter(
        (s): s is string => s !== null
      );
      warnings.push(
        `${sides.join(' / ')} 側が ${maxRows.toLocaleString()} 行を超えたため、先頭 ${maxRows.toLocaleString()} 行のみ比較しました`
      );
    }
    if (duplicateKeysA.length > 0) {
      warnings.push(
        `A 側でキーが重複しています (${duplicateKeysA.length} キー: ${listKeys(duplicateKeysA)})。重複キーは出現順に対応付けて比較しました`
      );
    }
    if (duplicateKeysB.length > 0) {
      warnings.push(
        `B 側でキーが重複しています (${duplicateKeysB.length} キー: ${listKeys(duplicateKeysB)})。重複キーは出現順に対応付けて比較しました`
      );
    }
    if (aOnlyColumns.length > 0) {
      warnings.push(`A 側のみに存在するカラムは比較対象外です: ${aOnlyColumns.join(', ')}`);
    }
    if (bOnlyColumns.length > 0) {
      warnings.push(`B 側のみに存在するカラムは比較対象外です: ${bOnlyColumns.join(', ')}`);
    }
    return {
      columns,
      keyColumns,
      rows,
      summary,
      warnings,
      aOnlyColumns,
      bOnlyColumns,
      truncated: aTruncated || bTruncated,
    };
  };

  return {
    get done() {
      return phase === 3;
    },
    step(budget: number): void {
      let remaining = budget;
      while (remaining > 0 && phase < 3) {
        if (phase === 0) {
          remaining -= indexBRows(remaining);
          if (cursor >= bRows.length) {
            phase = 1;
            cursor = 0;
          }
        } else if (phase === 1) {
          remaining -= walkARows(remaining);
          if (cursor >= aRows.length) {
            phase = 2;
            cursor = 0;
          }
        } else {
          remaining -= collectAdded(remaining);
          if (cursor >= bRows.length) {
            phase = 3;
          }
        }
      }
    },
    result(): DataDiffResult {
      if (phase !== 3) {
        throw new Error('diff が完了していません');
      }
      if (finalResult === null) {
        finalResult = buildResult();
      }
      return finalResult;
    },
  };
}

/** 同期版: 全行を一括処理する。テスト・小規模データ向け */
export function diffResultSets(
  a: DiffResultSet,
  b: DiffResultSet,
  options?: DiffOptions
): DataDiffResult {
  const session = createDiffSession(a, b, options);
  while (!session.done) {
    session.step(Number.MAX_SAFE_INTEGER);
  }
  return session.result();
}

/**
 * 非同期版: DIFF_CHUNK_SIZE 行ごとに setTimeout でイベントループへ制御を返し、
 * 大規模データ (〜100k 行) でも UI をフリーズさせない。
 */
export async function diffResultSetsAsync(
  a: DiffResultSet,
  b: DiffResultSet,
  options?: DiffOptions
): Promise<DataDiffResult> {
  const session = createDiffSession(a, b, options);
  while (!session.done) {
    session.step(DIFF_CHUNK_SIZE);
    if (!session.done) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  }
  return session.result();
}

/** 比較結果のサマリをクリップボード用テキストに整形する */
export function formatDiffSummary(
  result: DataDiffResult,
  labels: { a: string; b: string }
): string {
  const lines = [
    '[データ比較結果]',
    `A: ${labels.a}`,
    `B: ${labels.b}`,
    `キーカラム: ${result.keyColumns.join(', ')}`,
    `追加: ${result.summary.added} 行 / 削除: ${result.summary.removed} 行 / 変更: ${result.summary.modified} 行 / 一致: ${result.summary.identical} 行`,
  ];
  if (result.warnings.length > 0) {
    lines.push('警告:');
    for (const warning of result.warnings) {
      lines.push(`- ${warning}`);
    }
  }
  return lines.join('\n');
}
