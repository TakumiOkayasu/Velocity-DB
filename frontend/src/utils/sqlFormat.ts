import type { DatabaseType } from '../types';

let formatModule: typeof import('@sqltools/formatter') | null = null;

const LANGUAGE_MAP: Record<DatabaseType, 'tsql' | 'postgresql' | 'mysql'> = {
  sqlserver: 'tsql',
  postgresql: 'postgresql',
  mysql: 'mysql',
};

export async function formatSQL(sql: string, dbType?: DatabaseType): Promise<string> {
  formatModule ??= await import('@sqltools/formatter');
  const language = dbType ? LANGUAGE_MAP[dbType] : 'tsql';
  return formatModule.format(sql, {
    indent: '    ',
    reservedWordCase: 'upper',
    // TODO: @sqltools/formatter の公開型が 'tsql'|'mysql'|'postgresql' を含むようになったらキャスト削除
    // 公開型は 'sql'|'db2'|'n1ql'|'pl/sql' のみだが、ランタイムは方言名を受理して StandardSqlFormatter 等へディスパッチする
    language: language as 'sql',
  });
}
