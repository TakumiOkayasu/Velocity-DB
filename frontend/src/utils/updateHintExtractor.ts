import {
  normalizeForParsing,
  readIdentifier,
  readKeyword,
  readQualifiedName,
  skipWs,
  unwrapIdentifier,
  WS,
} from './sqlTokenParser';

export interface UpdateValuePosition {
  offset: number;
  length: number;
}

export interface UpdateAssignment {
  columnName: string;
  value: UpdateValuePosition;
}

export interface UpdateTarget {
  tableName: string;
  assignments: UpdateAssignment[];
}

const UPDATE_RE = /\bUPDATE\s+/gi;
// ORDER は `ORDER BY` の先頭のみを検出 (word boundary で単独 ORDER も同等に扱う)
// LIMIT / ORDER は MySQL UPDATE 構文の終端
const END_KEYWORDS = ['FROM', 'WHERE', 'RETURNING', 'LIMIT', 'ORDER'] as const;

function isSetClauseTerminator(scan: string, i: number): boolean {
  if (i >= scan.length) return true;
  const c = scan[i];
  if (c === ';') return true;
  for (const kw of END_KEYWORDS) {
    if (readKeyword(scan, i, kw) !== null) return true;
  }
  return false;
}

function skipToSetKeyword(scan: string, i: number): number | null {
  let cur = i;
  while (cur < scan.length) {
    const afterSet = readKeyword(scan, cur, 'SET');
    if (afterSet !== null) return afterSet;
    if (WS.test(scan[cur])) {
      cur++;
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

function findValueEnd(scan: string, start: number): number {
  let cur = start;
  let depth = 0;
  while (cur < scan.length) {
    const c = scan[cur];
    if (c === '(') {
      depth++;
      cur++;
      continue;
    }
    if (c === ')') {
      if (depth === 0) return cur;
      depth--;
      cur++;
      continue;
    }
    if (depth === 0) {
      if (c === ',' || c === ';') return cur;
      if (isSetClauseTerminator(scan, cur)) return cur;
    }
    cur++;
  }
  return cur;
}

interface ReadAssignmentResult {
  assignment: UpdateAssignment | null;
  next: number;
  done: boolean;
}

function readSingleAssignment(scan: string, original: string, cur: number): ReadAssignmentResult {
  const idResult = readIdentifier(scan, cur);
  if (!idResult) return { assignment: null, next: cur, done: true };
  const columnName = unwrapIdentifier(idResult.ident);
  const afterId = skipWs(scan, idResult.end);

  if (scan[afterId] !== '=') {
    const skipTo = findValueEnd(scan, afterId);
    if (scan[skipTo] !== ',') return { assignment: null, next: skipTo, done: true };
    return { assignment: null, next: skipWs(scan, skipTo + 1), done: false };
  }

  const valStart = skipWs(original, afterId + 1);
  const valEnd = findValueEnd(scan, valStart);

  let trimmedEnd = valEnd;
  while (trimmedEnd > valStart && WS.test(original[trimmedEnd - 1])) trimmedEnd--;

  const assignment =
    trimmedEnd > valStart
      ? { columnName, value: { offset: valStart, length: trimmedEnd - valStart } }
      : null;

  if (scan[valEnd] === ',') {
    return { assignment, next: skipWs(scan, valEnd + 1), done: false };
  }
  return { assignment, next: valEnd, done: true };
}

function readAssignments(scan: string, original: string, startIdx: number): UpdateAssignment[] {
  const assignments: UpdateAssignment[] = [];
  let cur = skipWs(scan, startIdx);

  while (cur < scan.length) {
    if (isSetClauseTerminator(scan, cur)) break;
    const { assignment, next, done } = readSingleAssignment(scan, original, cur);
    if (assignment) assignments.push(assignment);
    if (done) break;
    cur = next;
  }

  return assignments;
}

/**
 * SQL から UPDATE 文の SET 句を解析し、各代入の左辺カラム名と右辺値の位置情報を返す。
 * コメント・文字列リテラルは normalize 時に空白化され、値区切りとして誤認しない。
 * 終端キーワード: WHERE / FROM / RETURNING / LIMIT / ORDER / ;
 */
export function extractUpdateTargets(sql: string): UpdateTarget[] {
  if (!sql) return [];

  const scan = normalizeForParsing(sql);
  const targets: UpdateTarget[] = [];

  for (const match of scan.matchAll(UPDATE_RE)) {
    const start = match.index + match[0].length;
    let cur = skipWs(scan, start);

    const nameResult = readQualifiedName(scan, cur);
    if (!nameResult) continue;
    const tableName = nameResult.parts.map(unwrapIdentifier).join('.');
    cur = skipWs(scan, nameResult.end);

    const afterSet = skipToSetKeyword(scan, cur);
    if (afterSet === null) continue;

    const assignments = readAssignments(scan, sql, afterSet);
    if (assignments.length === 0) continue;

    targets.push({ tableName, assignments });
  }

  return targets;
}
