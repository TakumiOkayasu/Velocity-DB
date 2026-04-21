import { type Assignment, readAssignments, type ValuePosition } from './sqlDmlParser';
import {
  normalizeForParsing,
  readIdentifier,
  readKeyword,
  readQualifiedName,
  skipWs,
  unwrapIdentifier,
  WS,
} from './sqlTokenParser';

export type UpdateValuePosition = ValuePosition;
export type UpdateAssignment = Assignment;

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

    const assignments = readAssignments(scan, sql, afterSet, isSetClauseTerminator);
    if (assignments.length === 0) continue;

    targets.push({ tableName, assignments });
  }

  return targets;
}
