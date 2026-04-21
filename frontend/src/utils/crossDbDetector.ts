// 識別子: bare / [bracket] / `backtick` / "doubleQuote"
const IDENT_SRC = '(?:[A-Za-z_][A-Za-z0-9_$]*|\\[[^\\]]+\\]|`[^`]+`|"[^"]+")';
const THREE_PART_RE = new RegExp(
  `(${IDENT_SRC})\\s*\\.\\s*${IDENT_SRC}\\s*\\.\\s*${IDENT_SRC}`,
  'g'
);

// コメント/文字列リテラルを同幅スペースで置換 (位置保持は不要、単に誤検出回避)
const STRIP_RE = /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'/g;

function unwrapIdentifier(ident: string): string {
  const first = ident.charAt(0);
  if (first === '[' && ident.endsWith(']')) return ident.slice(1, -1);
  if (first === '`' && ident.endsWith('`')) return ident.slice(1, -1);
  if (first === '"' && ident.endsWith('"')) return ident.slice(1, -1);
  return ident;
}

/**
 * SQL から 3-part name (db.schema.table) の DB 名を抽出する。
 * 接続中の DB と一致するものは除外 (大文字小文字無視)。
 *
 * - コメント (-- / block) と文字列リテラルは無視
 * - 識別子 quote: [bracket] / `backtick` / "doubleQuote" / bare 対応
 * - 結果は順序保持・重複排除 (初出の綴りを保持)
 */
export function extractReferencedDatabases(sql: string, currentDb: string): string[] {
  if (!sql.trim()) return [];

  const stripped = sql.replace(STRIP_RE, ' ');
  const currentLower = currentDb.toLowerCase();
  const seen = new Set<string>();
  const result: string[] = [];

  for (const match of stripped.matchAll(THREE_PART_RE)) {
    const db = unwrapIdentifier(match[1]);
    const dbLower = db.toLowerCase();
    if (dbLower === currentLower && currentDb !== '') continue;
    if (seen.has(dbLower)) continue;
    seen.add(dbLower);
    result.push(db);
  }

  return result;
}
