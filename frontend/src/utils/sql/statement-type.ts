// SQL ステートメント種別判定 (操作層)。
// SQL 文字列を解析し、先頭の主動詞からステートメント種別を返す。
// CTE (WITH 句) は配下の主動詞を返す。コメント・先頭空白は剥離する。

export type StatementType =
  | 'SELECT'
  | 'INSERT'
  | 'UPDATE'
  | 'DELETE'
  | 'TRUNCATE'
  | 'DROP'
  | 'CREATE'
  | 'ALTER'
  | 'OTHER';

const STATEMENT_VERBS: ReadonlySet<StatementType> = new Set([
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'DROP',
  'CREATE',
  'ALTER',
]);

function stripLeadingComments(sql: string): string {
  let s = sql;
  for (;;) {
    const before = s.length;
    s = s.replace(/^\s+/, '');
    s = s.replace(/^--[^\n]*\n?/, '');
    s = s.replace(/^\/\*[\s\S]*?\*\//, '');
    if (s.length === before) return s;
  }
}

/**
 * SQL 文の先頭動詞からステートメント種別を判定する。
 * WITH (CTE) は配下の主動詞を返す。コメント・先頭空白は剥離。
 */
export function getStatementType(sql: string): StatementType {
  let body = stripLeadingComments(sql);
  if (body.length === 0) return 'OTHER';

  // CTE 配下に現れる動詞は WITH 自身ではなく後続の主動詞を返す。
  // (`WITH cte AS (SELECT 1) UPDATE t ...` → UPDATE)
  // カッコ深度を追跡して CTE 定義群を飛ばし、主動詞を探す。
  if (/^WITH\b/i.test(body)) {
    body = skipCteDefinitions(body);
  }

  const m = body.match(/^[A-Za-z]+/);
  if (!m) return 'OTHER';
  const verb = m[0].toUpperCase() as StatementType;
  return STATEMENT_VERBS.has(verb) ? verb : 'OTHER';
}

// 各 CTE 定義は `name [(cols)] AS (subquery)` の形。複数 CTE は `,` 区切り。
// この関数は WITH 直後から始め、CTE 群を全て読み飛ばし、主動詞 (UPDATE/DELETE/SELECT 等) の
// 直前まで s を進めて返す。途中で形式が崩れたらその時点の s を返し、呼び出し側で OTHER fallback。
function skipCteDefinitions(body: string): string {
  let s = body.replace(/^WITH\b\s*/i, '');
  for (;;) {
    // (1) CTE 名 (識別子) を消費
    s = stripLeadingComments(s);
    const nameMatch = s.match(/^(?:\[[^\]]+\]|"[^"]+"|`[^`]+`|\w+)\s*/);
    if (!nameMatch) return s;
    s = s.slice(nameMatch[0].length);

    // (2) 任意の (col, ...) を消費
    s = stripLeadingComments(s);
    if (s.startsWith('(')) {
      const after = skipBalancedParens(s);
      if (after === null) return s;
      s = after;
    }

    // (3) AS キーワードを消費
    s = stripLeadingComments(s);
    if (!/^AS\b/i.test(s)) return s;
    s = s.slice(2);

    // (4) (subquery) を消費
    s = stripLeadingComments(s);
    if (!s.startsWith('(')) return s;
    const afterSub = skipBalancedParens(s);
    if (afterSub === null) return s;
    s = afterSub;

    // (5) `,` があれば次 CTE、なければ主動詞へ
    s = stripLeadingComments(s);
    if (!s.startsWith(',')) return s;
    s = s.slice(1);
  }
}

function skipBalancedParens(s: string): string | null {
  if (!s.startsWith('(')) return null;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return s.slice(i + 1);
    }
  }
  return null;
}
