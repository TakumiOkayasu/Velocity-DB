import type { DatabaseType } from '../types';
import { escapeSingleQuotes, quoteIdentifier } from './sql/quoting';

/** ALTER TABLE ... RENAME COLUMN SQL生成 */
export function buildRenameColumnSql(
  schema: string,
  table: string,
  oldName: string,
  newName: string,
  dbType?: DatabaseType
): string {
  const q = (n: string) => quoteIdentifier(n, dbType);

  switch (dbType) {
    case 'postgresql':
      return `ALTER TABLE ${q(schema)}.${q(table)} RENAME COLUMN ${q(oldName)} TO ${q(newName)}`;
    case 'mysql':
      return `ALTER TABLE ${q(table)} RENAME COLUMN ${q(oldName)} TO ${q(newName)}`;
    default:
      return `EXEC sp_rename '${escapeSingleQuotes(schema)}.${escapeSingleQuotes(table)}.${escapeSingleQuotes(oldName)}', '${escapeSingleQuotes(newName)}', 'COLUMN'`;
  }
}

/** "schema.table" または "table" を DB別クォートして返す */
function qualifyDisplayName(displayName: string, dbType?: DatabaseType): string {
  const q = (n: string) => quoteIdentifier(n, dbType);
  const parts = displayName.split('.');
  return parts.length >= 2 ? `${q(parts[0])}.${q(parts[1])}` : q(parts[0]);
}

/** SELECT * FROM schema.table SQL生成 */
export function buildSelectSql(displayName: string, dbType?: DatabaseType): string {
  return `SELECT * FROM ${qualifyDisplayName(displayName, dbType)}`;
}

/** INSERT INTO schema.table (cols...) VALUES (?, ?, ...); テンプレート生成 */
export function buildInsertTemplateSql(
  displayName: string,
  columnNames: readonly string[],
  dbType?: DatabaseType
): string {
  const q = (n: string) => quoteIdentifier(n, dbType);
  const cols = columnNames.map((c) => q(c)).join(', ');
  const placeholders = columnNames.map(() => '?').join(', ');
  return `INSERT INTO ${qualifyDisplayName(displayName, dbType)} (${cols}) VALUES (${placeholders});`;
}

/** ALTER TABLE ... DROP COLUMN SQL生成 */
export function buildDropColumnSql(
  schema: string,
  table: string,
  column: string,
  dbType?: DatabaseType
): string {
  const q = (n: string) => quoteIdentifier(n, dbType);

  switch (dbType) {
    case 'postgresql':
      return `ALTER TABLE ${q(schema)}.${q(table)} DROP COLUMN ${q(column)}`;
    case 'mysql':
      return `ALTER TABLE ${q(table)} DROP COLUMN ${q(column)}`;
    default:
      return `ALTER TABLE ${q(schema)}.${q(table)} DROP COLUMN ${q(column)}`;
  }
}

// ---------------------------------------------------------------------------
// Table DROP / TRUNCATE
// ---------------------------------------------------------------------------

export interface ReferencingFK {
  name: string;
  referencingTable: string;
  referencingColumns: string[];
  columns: string[];
  onDelete: string;
  onUpdate: string;
}

const FK_ACTION_MAP: Record<string, string> = {
  NO_ACTION: 'NO ACTION',
  CASCADE: 'CASCADE',
  SET_NULL: 'SET NULL',
  SET_DEFAULT: 'SET DEFAULT',
  RESTRICT: 'RESTRICT',
};

function sanitizeFkAction(action: string): string {
  return FK_ACTION_MAP[action.toUpperCase()] ?? 'NO ACTION';
}

export const SQL_BEGIN_TRANSACTION = 'BEGIN TRANSACTION';

function formatQualifiedName(name: string, q: (n: string) => string): string {
  const parts = name.split('.');
  return parts.length >= 2 ? `${q(parts[0])}.${q(parts[1])}` : q(parts[0]);
}

function qualifyTable(schema: string, table: string, q: (n: string) => string): string {
  return schema ? `${q(schema)}.${q(table)}` : q(table);
}

/** DROP TABLE SQL生成（FK制約自動処理付き） */
export function buildDropTableSql(
  schema: string,
  table: string,
  dbType: DatabaseType | undefined,
  referencingFKs: ReferencingFK[]
): string[] {
  const q = (n: string) => quoteIdentifier(n, dbType);
  const qualifiedTable = qualifyTable(schema, table, q);

  if (referencingFKs.length === 0) {
    return [`DROP TABLE ${qualifiedTable}`];
  }

  if (dbType === 'postgresql') {
    return [`DROP TABLE ${qualifiedTable} CASCADE`];
  }

  // SQL Server: FK制約を個別にDROPしてからテーブルDROP
  const dropConstraints = referencingFKs.map(
    (fk) =>
      `ALTER TABLE ${formatQualifiedName(fk.referencingTable, q)} DROP CONSTRAINT ${q(fk.name)}`
  );

  return [...dropConstraints, `DROP TABLE ${qualifiedTable}`];
}

/** TRUNCATE TABLE SQL生成（FK制約自動処理付き） */
export function buildTruncateTableSql(
  schema: string,
  table: string,
  dbType: DatabaseType | undefined,
  referencingFKs: ReferencingFK[]
): string[] {
  const q = (n: string) => quoteIdentifier(n, dbType);
  const qualifiedTable = qualifyTable(schema, table, q);

  if (referencingFKs.length === 0) {
    return [`TRUNCATE TABLE ${qualifiedTable}`];
  }

  if (dbType === 'postgresql') {
    return [`TRUNCATE TABLE ${qualifiedTable} CASCADE`];
  }

  // SQL Server: トランザクション内でFK DROP→TRUNCATE→FK再作成
  const dropConstraints = referencingFKs.map(
    (fk) =>
      `ALTER TABLE ${formatQualifiedName(fk.referencingTable, q)} DROP CONSTRAINT ${q(fk.name)}`
  );

  const addConstraints = referencingFKs.map((fk) => {
    const refCols = fk.referencingColumns.map((c) => q(c)).join(', ');
    const cols = fk.columns.map((c) => q(c)).join(', ');
    return (
      `ALTER TABLE ${formatQualifiedName(fk.referencingTable, q)} ` +
      `WITH CHECK ADD CONSTRAINT ${q(fk.name)} ` +
      `FOREIGN KEY (${refCols}) REFERENCES ${qualifiedTable} (${cols}) ` +
      `ON DELETE ${sanitizeFkAction(fk.onDelete)} ON UPDATE ${sanitizeFkAction(fk.onUpdate)}`
    );
  });

  return [
    SQL_BEGIN_TRANSACTION,
    ...dropConstraints,
    `TRUNCATE TABLE ${qualifiedTable}`,
    ...addConstraints,
    'COMMIT',
  ];
}

// 識別子パターン: [name], "name", または裸の名前
const ID_PATTERN = '(?:\\[[^\\]]+\\]|"[^"]+"|[\\w]+)';
const DROP_RE = new RegExp(
  `^DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?((?:${ID_PATTERN})\\.)?(?:${ID_PATTERN})\\s*$`,
  'i'
);
const TRUNCATE_RE = new RegExp(
  `^TRUNCATE\\s+TABLE\\s+((?:${ID_PATTERN})\\.)?(?:${ID_PATTERN})\\s*$`,
  'i'
);

function stripQuotes(name: string): string {
  return name.replace(/^\[|\]$/g, '').replace(/^"|"$/g, '');
}

/** DROP TABLE / TRUNCATE TABLE 文からスキーマ名とテーブル名を抽出 */
export function parseDropOrTruncate(
  sql: string
): { type: 'drop' | 'truncate'; schema: string; table: string } | null {
  const trimmed = sql.trim().replace(/;$/, '').trim();

  // マッチ全体から最後のID_PATTERNをテーブル名、その前のschema.をスキーマ名として取得
  for (const [re, type] of [
    [DROP_RE, 'drop'],
    [TRUNCATE_RE, 'truncate'],
  ] as const) {
    const m = trimmed.match(re);
    if (!m) continue;
    // m[1] = "schema." (ドット付き) or undefined
    const schema = m[1] ? stripQuotes(m[1].replace(/\.$/, '')) : '';
    // テーブル名: 末尾のID_PATTERNを直接抽出
    const tableMatch = trimmed.match(new RegExp(`(${ID_PATTERN})\\s*$`, 'i'));
    if (!tableMatch) continue;
    const table = stripQuotes(tableMatch[1]);
    return { type, schema, table };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Statement type detection (UPDATE/INSERT/DELETE/TRUNCATE/DROP/CREATE/ALTER 結果表示用)
// ---------------------------------------------------------------------------

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

// CTE 配下に現れる動詞は WITH 自身ではなく後続の主動詞を返す。
// (`WITH cte AS (SELECT 1) UPDATE t ...` → UPDATE)
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

  // WITH (CTE): カッコ深度を追跡して CTE 定義を飛ばし、主動詞を探す
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

// ---------------------------------------------------------------------------
// View DDL
// ---------------------------------------------------------------------------

/** ビュー定義取得SQL生成 */
export function buildGetViewDefinitionSql(
  schema: string,
  viewName: string,
  dbType?: DatabaseType
): string {
  const s = escapeSingleQuotes(schema);
  const v = escapeSingleQuotes(viewName);

  switch (dbType) {
    case 'postgresql':
      return `SELECT pg_get_viewdef('${s}.${v}', true)`;
    case 'mysql':
      return `SELECT VIEW_DEFINITION FROM INFORMATION_SCHEMA.VIEWS WHERE TABLE_SCHEMA = '${s}' AND TABLE_NAME = '${v}'`;
    default:
      return `SELECT OBJECT_DEFINITION(OBJECT_ID(N'${s}.${v}'))`;
  }
}

/** ビュー定義を取得 (空文字列 = 取得失敗) */
export async function fetchViewDefinition(
  connectionId: string,
  schema: string,
  viewName: string,
  dbType?: DatabaseType
): Promise<string> {
  const { bridge } = await import('../api/bridge');
  const defQuery = buildGetViewDefinitionSql(schema, viewName, dbType);
  const result = await bridge.executeQuery(connectionId, defQuery);
  if ('multipleResults' in result) return '';
  return result.rows[0]?.[0] ?? '';
}

/** 正規表現メタ文字のエスケープ */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * SELECT句とFROM句を括弧深度を追跡して分割する。
 * サブクエリ内の FROM を無視し、トップレベルの FROM で分割。
 * 戻り値: [selectPart, fromAndRest] または null (FROM未検出)
 */
function splitSelectFrom(body: string): [string, string] | null {
  let depth = 0;
  const upper = body.toUpperCase();
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '(') {
      depth++;
    } else if (body[i] === ')') {
      depth--;
    } else if (depth === 0 && upper.startsWith('FROM', i)) {
      // 単語境界チェック: FROM の前後が英数字でないこと
      const before = i > 0 ? upper[i - 1] : ' ';
      const after = i + 4 < upper.length ? upper[i + 4] : ' ';
      if (/\w/.test(before) || /\w/.test(after)) continue;
      return [body.slice(0, i), body.slice(i)];
    }
  }
  return null;
}

/** ビュー定義を書き換えてカラム名を変更するALTER VIEW SQL生成 */
export function buildAlterViewSql(
  viewDefinition: string,
  oldCol: string,
  newCol: string,
  dbType?: DatabaseType
): string {
  const q = (n: string) => quoteIdentifier(n, dbType);
  let sql = viewDefinition;

  // CREATE VIEW → ALTER VIEW (PostgreSQL は CREATE OR REPLACE VIEW)
  if (dbType === 'postgresql') {
    sql = sql.replace(/^CREATE\s+(OR\s+REPLACE\s+)?VIEW/i, 'CREATE OR REPLACE VIEW');
  } else {
    sql = sql.replace(/^CREATE\s+VIEW/i, 'ALTER VIEW');
  }

  // SELECT [TOP N|DISTINCT] ... FROM の間でカラムを探してエイリアスを付与/置換
  const selectIdx = sql.search(/\bSELECT\s/i);
  if (selectIdx === -1) return sql;

  const afterSelect = sql.slice(selectIdx).replace(/^SELECT\s+/i, '');
  const prefixMatch = afterSelect.match(/^(TOP\s+\d+\s+|DISTINCT\s+)/i);
  const selectPrefix = prefixMatch?.[0] ?? '';
  const bodyAfterPrefix = afterSelect.slice(selectPrefix.length);

  const split = splitSelectFrom(bodyAfterPrefix);
  if (!split) return sql;

  const [selectPart, fromAndRest] = split;
  const selectFromStart = sql.slice(0, selectIdx);
  const escapedCol = escapeRegex(oldCol);

  // 名前付きパーツで正規表現を構築
  const tablePrefix = '(?:\\w+\\.)?';
  const quotedCol = `\\[?${escapedCol}\\]?`;
  const colBoundary = '(?=\\s*[,\\s]|\\s+AS\\b)';
  const aliasValue = '\\[[^\\]]*\\]|"[^"]*"|`[^`]*`|\\w+';
  const existingAlias = `(\\s+AS\\s+(?:${aliasValue}))`;

  const colPattern = new RegExp(`(${tablePrefix}${quotedCol})${colBoundary}${existingAlias}?`, 'i');

  if (colPattern.test(selectPart)) {
    const newSelectPart = selectPart.replace(colPattern, `$1 AS ${q(newCol)}`);
    sql = `${selectFromStart}SELECT ${selectPrefix}${newSelectPart}${fromAndRest}`;
  }

  return sql;
}
