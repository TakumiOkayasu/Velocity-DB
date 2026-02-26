import type { DatabaseType } from '../types';

/** sp_rename等のリテラル文字列用エスケープ (シングルクォート) */
function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/** DB種別に応じた識別子クォート */
export function quoteIdentifier(name: string, dbType?: DatabaseType): string {
  switch (dbType) {
    case 'postgresql':
      return `"${name.replace(/"/g, '""')}"`;
    case 'mysql':
      return `\`${name.replace(/`/g, '``')}\``;
    default:
      return `[${name.replace(/]/g, ']]')}]`;
  }
}

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
      return `EXEC sp_rename '${escapeSqlLiteral(schema)}.${escapeSqlLiteral(table)}.${escapeSqlLiteral(oldName)}', '${escapeSqlLiteral(newName)}', 'COLUMN'`;
  }
}

/** SELECT * FROM schema.table SQL生成 */
export function buildSelectSql(displayName: string, dbType?: DatabaseType): string {
  const q = (n: string) => quoteIdentifier(n, dbType);
  const parts = displayName.split('.');
  const tableName = parts.length >= 2 ? `${q(parts[0])}.${q(parts[1])}` : q(parts[0]);
  return `SELECT * FROM ${tableName}`;
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
