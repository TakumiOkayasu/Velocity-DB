export const WS = /\s/;

export const QUOTE_CLOSE: Record<string, string> = { '[': ']', '`': '`', '"': '"' };

export function normalizeForParsing(sql: string): string {
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

export function unwrapIdentifier(ident: string): string {
  if (!ident) return ident;
  const close = QUOTE_CLOSE[ident[0]];
  if (close && ident[ident.length - 1] === close) return ident.slice(1, -1);
  return ident;
}

export function skipWs(s: string, i: number): number {
  while (i < s.length && WS.test(s[i])) i++;
  return i;
}

export function readIdentifier(s: string, i: number): { ident: string; end: number } | null {
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

export function readQualifiedName(s: string, i: number): { parts: string[]; end: number } | null {
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

export function readKeyword(s: string, i: number, keyword: string): number | null {
  const upper = keyword.toUpperCase();
  const slice = s.slice(i, i + upper.length).toUpperCase();
  if (slice !== upper) return null;
  const after = s[i + upper.length];
  if (after !== undefined && /[A-Za-z0-9_$]/.test(after)) return null;
  return i + upper.length;
}
