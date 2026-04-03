import type { DatabaseType } from '../types';

let formatModule: typeof import('sql-formatter') | null = null;

export async function formatSQL(sql: string, dbType?: DatabaseType): Promise<string> {
  formatModule ??= await import('sql-formatter');
  const { format } = formatModule;
  const language =
    dbType === 'postgresql' ? 'postgresql' : dbType === 'mysql' ? 'mysql' : 'transactsql';
  return format(sql, {
    language,
    keywordCase: 'upper',
    indentStyle: 'standard',
    tabWidth: 4,
  });
}
