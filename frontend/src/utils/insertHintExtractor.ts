import {
  normalizeForParsing,
  readIdentifier,
  readKeyword,
  readQualifiedName,
  skipWs,
  unwrapIdentifier,
  WS,
} from './sqlTokenParser';

export interface InsertValuePosition {
  offset: number;
  length: number;
}

export interface InsertTarget {
  tableName: string;
  columnNames: string[] | null;
  valueRows: InsertValuePosition[][];
}

function readColumnList(s: string, i: number): { columns: string[]; end: number } | null {
  if (s[i] !== '(') return null;
  let cur = skipWs(s, i + 1);
  const columns: string[] = [];
  while (cur < s.length && s[cur] !== ')') {
    const r = readIdentifier(s, cur);
    if (!r) return null;
    columns.push(unwrapIdentifier(r.ident));
    cur = skipWs(s, r.end);
    if (s[cur] === ',') {
      cur = skipWs(s, cur + 1);
      continue;
    }
    if (s[cur] === ')') break;
    return null;
  }
  if (s[cur] !== ')') return null;
  return { columns, end: cur + 1 };
}

function readValueTuple(
  scan: string,
  original: string,
  i: number
): { values: InsertValuePosition[]; end: number } | null {
  if (scan[i] !== '(') return null;
  let cur = i + 1;
  cur = skipWs(original, cur);
  let valueStart = cur;
  const values: InsertValuePosition[] = [];
  let depth = 1;

  const flush = (end: number) => {
    let valueEnd = end;
    while (valueEnd > valueStart && WS.test(original[valueEnd - 1])) valueEnd--;
    if (valueEnd > valueStart) {
      values.push({ offset: valueStart, length: valueEnd - valueStart });
    }
  };

  while (cur < scan.length) {
    const c = scan[cur];
    if (c === '(') {
      depth++;
      cur++;
      continue;
    }
    if (c === ')') {
      depth--;
      if (depth === 0) {
        flush(cur);
        return { values, end: cur + 1 };
      }
      cur++;
      continue;
    }
    if (c === ',' && depth === 1) {
      flush(cur);
      cur++;
      cur = skipWs(original, cur);
      valueStart = cur;
      continue;
    }
    cur++;
  }
  return null;
}

const INSERT_INTO_RE = /\bINSERT\s+INTO\s+/gi;

/**
 * SQL から INSERT 文の VALUES 句を解析し、テーブル名・カラム名リスト・各値行の位置情報を返す。
 * カラムリストが省略されたときは schemaStore から取得する前提で `columnNames: null` を返す。
 * コメント・文字列リテラルは normalize 時に空白化され、値区切りとして誤認しない。
 */
export function extractInsertTargets(sql: string): InsertTarget[] {
  if (!sql) return [];

  const scan = normalizeForParsing(sql);
  const targets: InsertTarget[] = [];

  for (const match of scan.matchAll(INSERT_INTO_RE)) {
    const start = match.index + match[0].length;
    let cur = skipWs(scan, start);

    const nameResult = readQualifiedName(scan, cur);
    if (!nameResult) continue;
    const tableName = nameResult.parts.map(unwrapIdentifier).join('.');
    cur = skipWs(scan, nameResult.end);

    let columnNames: string[] | null = null;
    if (scan[cur] === '(') {
      const colResult = readColumnList(scan, cur);
      if (!colResult) continue;
      columnNames = colResult.columns;
      cur = skipWs(scan, colResult.end);
    }

    const afterValues = readKeyword(scan, cur, 'VALUES');
    if (afterValues === null) continue;
    cur = skipWs(scan, afterValues);

    const valueRows: InsertValuePosition[][] = [];
    let parseFailed = false;
    while (cur < scan.length && scan[cur] === '(') {
      const tuple = readValueTuple(scan, sql, cur);
      if (!tuple) {
        parseFailed = true;
        break;
      }
      valueRows.push(tuple.values);
      cur = skipWs(scan, tuple.end);
      if (scan[cur] === ',') {
        cur = skipWs(scan, cur + 1);
        continue;
      }
      break;
    }
    if (parseFailed || valueRows.length === 0) continue;

    targets.push({ tableName, columnNames, valueRows });
  }

  return targets;
}
