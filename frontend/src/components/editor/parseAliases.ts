export interface AliasInfo {
  alias: string;
  tableName: string;
}

// SQLキーワード。FROM table <keyword> のように直後に出現した場合はエイリアスとみなさない。
const NON_ALIAS_KEYWORDS = new Set([
  'WHERE',
  'ON',
  'GROUP',
  'ORDER',
  'HAVING',
  'INNER',
  'LEFT',
  'RIGHT',
  'OUTER',
  'FULL',
  'JOIN',
  'CROSS',
  'UNION',
  'LIMIT',
  'OFFSET',
  'FETCH',
  'FOR',
  'WITH',
  'SET',
  'VALUES',
  'RETURNING',
]);

// エイリアス位置に来てはいけない SQL キーワード。negative lookahead で alias 候補から除外する
// ことで、正規表現が後続の JOIN/WHERE 等を alias として誤消費しないようにする。
const ALIAS_BLOCKLIST = [
  ...NON_ALIAS_KEYWORDS,
  'FROM',
  'AS',
  'AND',
  'OR',
  'NOT',
  'IN',
  'LIKE',
  'BETWEEN',
  'IS',
  'NULL',
].join('|');

const ALIAS_LOOKAHEAD = `(?!(?:${ALIAS_BLOCKLIST})\\b)`;

export function parseAliases(text: string): AliasInfo[] {
  const aliases: AliasInfo[] = [];

  const pattern = new RegExp(
    String.raw`(?:FROM|JOIN)\s+\[?(\w+)\]?(?:\.\[?(\w+)\]?)?(?:\s+(?:AS\s+)?${ALIAS_LOOKAHEAD}(\w+))?`,
    'gi'
  );

  const matches = text.matchAll(pattern);
  for (const match of matches) {
    const schema = match[2] ? match[1] : null;
    const table = match[2] ?? match[1];
    const rawAlias = match[3];
    if (!table) continue;

    const hasValidAlias = rawAlias !== undefined && rawAlias.toLowerCase() !== table.toLowerCase();
    const alias = hasValidAlias ? (rawAlias as string).toLowerCase() : table.toLowerCase();
    const tableName = schema ? `${schema}.${table}` : table;
    aliases.push({ alias, tableName });
  }

  return aliases;
}
