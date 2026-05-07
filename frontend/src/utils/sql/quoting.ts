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

/** "schema.table" または "table" を分解しDB別にクォート (3 段以上のドットは無視し最初の 2 段のみ採用) */
export function quoteDottedName(dotted: string, dbType?: DatabaseType): string {
  const parts = dotted.split('.');
  return parts.length >= 2
    ? `${quoteIdentifier(parts[0], dbType)}.${quoteIdentifier(parts[1], dbType)}`
    : quoteIdentifier(parts[0], dbType);
}
