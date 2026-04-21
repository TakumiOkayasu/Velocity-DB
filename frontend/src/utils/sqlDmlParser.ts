import { readIdentifier, skipWs, unwrapIdentifier, WS } from './sqlTokenParser';

export interface ValuePosition {
  offset: number;
  length: number;
}

export interface Assignment {
  columnName: string;
  value: ValuePosition;
}

export type TerminatorCheck = (scan: string, i: number) => boolean;

export function readColumnList(s: string, i: number): { columns: string[]; end: number } | null {
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

export function readValueTuple(
  scan: string,
  original: string,
  i: number
): { values: ValuePosition[]; end: number } | null {
  if (scan[i] !== '(') return null;
  let cur = i + 1;
  cur = skipWs(original, cur);
  let valueStart = cur;
  const values: ValuePosition[] = [];
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

function findValueEnd(scan: string, start: number, isTerminator: TerminatorCheck): number {
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
      if (isTerminator(scan, cur)) return cur;
    }
    cur++;
  }
  return cur;
}

interface ReadAssignmentResult {
  assignment: Assignment | null;
  next: number;
  done: boolean;
}

function readSingleAssignment(
  scan: string,
  original: string,
  cur: number,
  isTerminator: TerminatorCheck
): ReadAssignmentResult {
  const idResult = readIdentifier(scan, cur);
  if (!idResult) return { assignment: null, next: cur, done: true };
  const columnName = unwrapIdentifier(idResult.ident);
  const afterId = skipWs(scan, idResult.end);

  if (scan[afterId] !== '=') {
    const skipTo = findValueEnd(scan, afterId, isTerminator);
    if (scan[skipTo] !== ',') return { assignment: null, next: skipTo, done: true };
    return { assignment: null, next: skipWs(scan, skipTo + 1), done: false };
  }

  const valStart = skipWs(original, afterId + 1);
  const valEnd = findValueEnd(scan, valStart, isTerminator);

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

/**
 * SET 句の代入リストを解析する。`col = expr, col = expr, ...` を走査し、
 * `isTerminator` が true を返す位置または `;` / EOF で停止する。
 * `=` のない項目はスキップ、値が空の項目も除外される。
 */
export function readAssignments(
  scan: string,
  original: string,
  startIdx: number,
  isTerminator: TerminatorCheck
): Assignment[] {
  const assignments: Assignment[] = [];
  let cur = skipWs(scan, startIdx);

  while (cur < scan.length) {
    if (isTerminator(scan, cur)) break;
    const { assignment, next, done } = readSingleAssignment(scan, original, cur, isTerminator);
    if (assignment) assignments.push(assignment);
    if (done) break;
    cur = next;
  }

  return assignments;
}
