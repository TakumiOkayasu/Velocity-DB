export interface InsertValuePosition {
  offset: number;
  length: number;
}

export interface InsertTarget {
  tableName: string;
  columnNames: string[] | null;
  valueRows: InsertValuePosition[][];
}

const WS = /\s/;

function normalizeForParsing(sql: string): string {
  const out: string[] = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (c === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') {
        out.push(' ');
        i++;
      }
      continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      out.push(' ', ' ');
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) {
        out.push(sql[i] === '\n' ? '\n' : ' ');
        i++;
      }
      if (i < n) {
        out.push(' ', ' ');
        i += 2;
      }
      continue;
    }
    if (c === "'") {
      out.push(' ');
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          out.push(' ', ' ');
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          out.push(' ');
          i++;
          break;
        }
        out.push(sql[i] === '\n' ? '\n' : ' ');
        i++;
      }
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join('');
}

const QUOTE_CLOSE: Record<string, string> = { '[': ']', '`': '`', '"': '"' };

function unwrapIdentifier(ident: string): string {
  if (!ident) return ident;
  const close = QUOTE_CLOSE[ident[0]];
  if (close && ident[ident.length - 1] === close) return ident.slice(1, -1);
  return ident;
}

function skipWs(s: string, i: number): number {
  while (i < s.length && WS.test(s[i])) i++;
  return i;
}

function readIdentifier(s: string, i: number): { ident: string; end: number } | null {
  const c = s[i];
  const close = QUOTE_CLOSE[c];
  if (close) {
    const end = s.indexOf(close, i + 1);
    if (end < 0) return null;
    return { ident: s.slice(i, end + 1), end: end + 1 };
  }
  if (/[A-Za-z_]/.test(c)) {
    let j = i + 1;
    while (j < s.length && /[A-Za-z0-9_$]/.test(s[j])) j++;
    return { ident: s.slice(i, j), end: j };
  }
  return null;
}

function readQualifiedName(s: string, i: number): { parts: string[]; end: number } | null {
  const parts: string[] = [];
  let cur = i;
  while (true) {
    const r = readIdentifier(s, cur);
    if (!r) return parts.length === 0 ? null : { parts, end: cur };
    parts.push(r.ident);
    cur = r.end;
    const afterWs = skipWs(s, cur);
    if (s[afterWs] !== '.') return { parts, end: cur };
    cur = skipWs(s, afterWs + 1);
  }
}

function readKeyword(s: string, i: number, keyword: string): number | null {
  const upper = keyword.toUpperCase();
  const slice = s.slice(i, i + upper.length).toUpperCase();
  if (slice !== upper) return null;
  const after = s[i + upper.length];
  if (after !== undefined && /[A-Za-z0-9_$]/.test(after)) return null;
  return i + upper.length;
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
  while (cur < scan.length && WS.test(original[cur])) cur++;
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
      while (cur < scan.length && WS.test(original[cur])) cur++;
      valueStart = cur;
      continue;
    }
    cur++;
  }
  return null;
}

const INSERT_INTO_RE = /\bINSERT\s+INTO\s+/gi;

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
