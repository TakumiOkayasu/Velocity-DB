import { format } from 'sql-formatter';
import type { DatabaseType } from '../types';

export function formatSQL(sql: string, dbType?: DatabaseType): string {
  const language =
    dbType === 'postgresql' ? 'postgresql' : dbType === 'mysql' ? 'mysql' : 'transactsql';
  return format(sql, {
    language,
    keywordCase: 'upper',
    indentStyle: 'standard',
    tabWidth: 4,
  });
}
