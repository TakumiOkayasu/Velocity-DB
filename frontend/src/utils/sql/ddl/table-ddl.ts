// テーブル DDL builder (操作層)。
// ALTER COLUMN / DROP TABLE / TRUNCATE TABLE 等のテーブル操作 SQL を生成する。
// 識別子クォート / リテラルエスケープは utils/sql/quoting.ts に依存。

import type { DatabaseType } from '../../../types';
import { escapeSingleQuotes, quoteDottedName, quoteIdentifier } from '../quoting';

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

function qualifyTable(schema: string, table: string, dbType?: DatabaseType): string {
  return schema
    ? `${quoteIdentifier(schema, dbType)}.${quoteIdentifier(table, dbType)}`
    : quoteIdentifier(table, dbType);
}

/** DROP TABLE SQL生成（FK制約自動処理付き） */
export function buildDropTableSql(
  schema: string,
  table: string,
  dbType: DatabaseType | undefined,
  referencingFKs: ReferencingFK[]
): string[] {
  const q = (n: string) => quoteIdentifier(n, dbType);
  const qualifiedTable = qualifyTable(schema, table, dbType);

  if (referencingFKs.length === 0) {
    return [`DROP TABLE ${qualifiedTable}`];
  }

  if (dbType === 'postgresql') {
    return [`DROP TABLE ${qualifiedTable} CASCADE`];
  }

  // SQL Server: FK制約を個別にDROPしてからテーブルDROP
  const dropConstraints = referencingFKs.map(
    (fk) =>
      `ALTER TABLE ${quoteDottedName(fk.referencingTable, dbType)} DROP CONSTRAINT ${q(fk.name)}`
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
  const qualifiedTable = qualifyTable(schema, table, dbType);

  if (referencingFKs.length === 0) {
    return [`TRUNCATE TABLE ${qualifiedTable}`];
  }

  if (dbType === 'postgresql') {
    return [`TRUNCATE TABLE ${qualifiedTable} CASCADE`];
  }

  // SQL Server: トランザクション内でFK DROP→TRUNCATE→FK再作成
  const dropConstraints = referencingFKs.map(
    (fk) =>
      `ALTER TABLE ${quoteDottedName(fk.referencingTable, dbType)} DROP CONSTRAINT ${q(fk.name)}`
  );

  const addConstraints = referencingFKs.map((fk) => {
    const refCols = fk.referencingColumns.map((c) => q(c)).join(', ');
    const cols = fk.columns.map((c) => q(c)).join(', ');
    return (
      `ALTER TABLE ${quoteDottedName(fk.referencingTable, dbType)} ` +
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
