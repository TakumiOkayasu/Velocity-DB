import type { DatabaseType } from '../../types';

/** SQL リテラル内のシングルクォートを 2 重化エスケープ */
export function escapeSingleQuotes(value: string): string {
  return value.replace(/'/g, "''");
}

/** DB種別に応じたリテラルクォート */
export function quoteLiteral(value: string, dbType?: DatabaseType): string {
  const escaped = escapeSingleQuotes(value);
  switch (dbType) {
    case 'postgresql':
    case 'mysql':
      return `'${escaped}'`;
    default:
      return `N'${escaped}'`;
  }
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
