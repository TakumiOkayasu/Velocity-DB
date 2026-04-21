import type { InsertTarget } from './insertHintExtractor';
import {
  type Assignment,
  readAssignments,
  readColumnList,
  readValueTuple,
  type ValuePosition,
} from './sqlDmlParser';
import {
  normalizeForParsing,
  readIdentifier,
  readKeyword,
  readQualifiedName,
  skipWs,
  unwrapIdentifier,
} from './sqlTokenParser';
import type { UpdateTarget } from './updateHintExtractor';

const MERGE_RE = /\bMERGE\s+/gi;

/**
 * MERGE の WHEN 句群の終端キーワード。
 * - SQL Server: `OUTPUT`, `OPTION`
 * - PostgreSQL: `RETURNING`
 * - 共通: `;` / EOF (呼び出し側でも判定)
 */
const MERGE_END_KEYWORDS = ['OUTPUT', 'OPTION', 'RETURNING'] as const;

function isMergeEnd(scan: string, i: number): boolean {
  if (i >= scan.length) return true;
  if (scan[i] === ';') return true;
  for (const kw of MERGE_END_KEYWORDS) {
    if (readKeyword(scan, i, kw) !== null) return true;
  }
  return false;
}

/**
 * WHEN 句内 UPDATE SET の終端: 次の `WHEN` 句、MERGE 全体の終端、または `;`。
 */
function isMergeSetTerminator(scan: string, i: number): boolean {
  if (i >= scan.length) return true;
  if (scan[i] === ';') return true;
  if (readKeyword(scan, i, 'WHEN') !== null) return true;
  for (const kw of MERGE_END_KEYWORDS) {
    if (readKeyword(scan, i, kw) !== null) return true;
  }
  return false;
}

/**
 * `(` から対応する `)` の直後までスキップ。ネスト対応。
 * `)` が見つからない場合は終端 (length) を返す。
 */
function skipParenBlock(scan: string, i: number): number {
  if (scan[i] !== '(') return i;
  let cur = i + 1;
  let depth = 1;
  while (cur < scan.length && depth > 0) {
    const c = scan[cur];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    cur++;
  }
  return cur;
}

/**
 * `WITH ( ... )` テーブルヒントまたはエイリアス (`AS alias` / `alias`) をスキップする。
 * USING キーワードの手前まで進める。
 */
function skipToUsing(scan: string, i: number): number | null {
  let cur = i;
  while (cur < scan.length) {
    cur = skipWs(scan, cur);
    const afterUsing = readKeyword(scan, cur, 'USING');
    if (afterUsing !== null) return afterUsing;
    if (scan[cur] === '(') {
      cur = skipParenBlock(scan, cur);
      continue;
    }
    const ident = readIdentifier(scan, cur);
    if (ident) {
      cur = ident.end;
      continue;
    }
    return null;
  }
  return null;
}

/**
 * USING 句以降の `ON <condition>` をスキップし、最初の `WHEN` キーワードの位置を返す。
 * MERGE 終端 (`;` / `OUTPUT` / `OPTION` / `RETURNING` / EOF) に先に到達した場合は null。
 */
function skipToFirstWhen(scan: string, startIdx: number): number | null {
  let cur = startIdx;
  let depth = 0;
  while (cur < scan.length) {
    const c = scan[cur];
    if (c === '(') {
      depth++;
      cur++;
      continue;
    }
    if (c === ')') {
      if (depth > 0) depth--;
      cur++;
      continue;
    }
    if (depth === 0) {
      if (isMergeEnd(scan, cur)) return null;
      const afterWhen = readKeyword(scan, cur, 'WHEN');
      if (afterWhen !== null) return cur;
    }
    cur++;
  }
  return null;
}

/**
 * `WHEN [NOT] MATCHED [BY TARGET|BY SOURCE] [AND <cond>] THEN` を読み飛ばし、
 * THEN の直後のオフセットを返す。`WHEN` キーワード位置 `whenStart` を受け取る。
 * 解析失敗時は null。
 */
function skipWhenHeader(scan: string, whenStart: number): number | null {
  const afterWhen = readKeyword(scan, whenStart, 'WHEN');
  if (afterWhen === null) return null;
  let cur = skipWs(scan, afterWhen);

  const afterNot = readKeyword(scan, cur, 'NOT');
  if (afterNot !== null) cur = skipWs(scan, afterNot);

  const afterMatched = readKeyword(scan, cur, 'MATCHED');
  if (afterMatched === null) return null;
  cur = skipWs(scan, afterMatched);

  const afterBy = readKeyword(scan, cur, 'BY');
  if (afterBy !== null) {
    cur = skipWs(scan, afterBy);
    const afterTarget = readKeyword(scan, cur, 'TARGET');
    const afterSource = afterTarget === null ? readKeyword(scan, cur, 'SOURCE') : null;
    if (afterTarget !== null) cur = skipWs(scan, afterTarget);
    else if (afterSource !== null) cur = skipWs(scan, afterSource);
    else return null;
  }

  // THEN まで識別子/括弧/演算子を読み飛ばす (AND cond を含む)
  let depth = 0;
  while (cur < scan.length) {
    if (scan[cur] === '(') {
      depth++;
      cur++;
      continue;
    }
    if (scan[cur] === ')') {
      if (depth > 0) depth--;
      cur++;
      continue;
    }
    if (depth === 0) {
      const afterThen = readKeyword(scan, cur, 'THEN');
      if (afterThen !== null) return afterThen;
    }
    cur++;
  }
  return null;
}

interface WhenActionResult {
  update?: { assignments: Assignment[] };
  insert?: { columnNames: string[] | null; values: ValuePosition[] };
  next: number;
}

function parseWhenAction(
  scan: string,
  original: string,
  afterThen: number
): WhenActionResult | null {
  let cur = skipWs(scan, afterThen);

  const afterUpdate = readKeyword(scan, cur, 'UPDATE');
  if (afterUpdate !== null) {
    cur = skipWs(scan, afterUpdate);
    const afterSet = readKeyword(scan, cur, 'SET');
    if (afterSet === null) return null;
    const assignments = readAssignments(scan, original, afterSet, isMergeSetTerminator);
    // 終端位置を求めるため走査
    let next = skipWs(scan, afterSet);
    while (next < scan.length && !isMergeSetTerminator(scan, next)) next++;
    return { update: { assignments }, next };
  }

  const afterInsert = readKeyword(scan, cur, 'INSERT');
  if (afterInsert !== null) {
    cur = skipWs(scan, afterInsert);
    let columnNames: string[] | null = null;
    if (scan[cur] === '(') {
      const colResult = readColumnList(scan, cur);
      if (!colResult) return null;
      columnNames = colResult.columns;
      cur = skipWs(scan, colResult.end);
    }
    const afterValues = readKeyword(scan, cur, 'VALUES');
    if (afterValues === null) return null;
    cur = skipWs(scan, afterValues);
    const tuple = readValueTuple(scan, original, cur);
    if (!tuple) return null;
    return {
      insert: { columnNames, values: tuple.values },
      next: tuple.end,
    };
  }

  // DELETE / DO NOTHING / 不明 - 次の WHEN / 終端までスキップ
  while (cur < scan.length) {
    if (isMergeEnd(scan, cur) || readKeyword(scan, cur, 'WHEN') !== null) break;
    cur++;
  }
  return { next: cur };
}

export interface MergeExtractResult {
  insertTargets: InsertTarget[];
  updateTargets: UpdateTarget[];
}

/**
 * SQL から MERGE 文を解析し、各 WHEN 句の UPDATE SET / INSERT VALUES を
 * 既存の InsertTarget / UpdateTarget 型で返す。tableName は MERGE INTO のターゲット名を継承。
 * DELETE / DO NOTHING 句は無視。
 * 対応方言: SQL Server (OUTPUT/OPTION 終端), PostgreSQL 15+ (RETURNING 終端)。
 */
export function extractMergeTargets(sql: string): MergeExtractResult {
  const result: MergeExtractResult = { insertTargets: [], updateTargets: [] };
  if (!sql) return result;

  const scan = normalizeForParsing(sql);

  for (const match of scan.matchAll(MERGE_RE)) {
    const start = match.index + match[0].length;
    let cur = skipWs(scan, start);

    const afterInto = readKeyword(scan, cur, 'INTO');
    if (afterInto !== null) cur = skipWs(scan, afterInto);

    const nameResult = readQualifiedName(scan, cur);
    if (!nameResult) continue;
    const tableName = nameResult.parts.map(unwrapIdentifier).join('.');
    cur = skipWs(scan, nameResult.end);

    const usingStart = skipToUsing(scan, cur);
    if (usingStart === null) continue;

    const whenStart = skipToFirstWhen(scan, usingStart);
    if (whenStart === null) continue;

    cur = whenStart;
    while (cur < scan.length && !isMergeEnd(scan, cur)) {
      const afterThen = skipWhenHeader(scan, cur);
      if (afterThen === null) break;

      const action = parseWhenAction(scan, sql, afterThen);
      if (!action) break;

      if (action.update && action.update.assignments.length > 0) {
        result.updateTargets.push({
          tableName,
          assignments: action.update.assignments,
        });
      }
      if (action.insert) {
        result.insertTargets.push({
          tableName,
          columnNames: action.insert.columnNames,
          valueRows: [action.insert.values],
        });
      }

      cur = skipWs(scan, action.next);
    }
  }

  return result;
}
