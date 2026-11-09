import type { Connection } from '../types';

/** Text identity accompanies connection colors, including same-endpoint logins. */
export function connectionLabel(
  connection: Pick<
    Connection,
    'name' | 'folderPath' | 'username' | 'server' | 'port' | 'database' | 'dbType'
  >
): string {
  const profile = [connection.folderPath, connection.name].filter(Boolean).join('/');
  return `${connection.database} · ${connection.username}@${connection.server}:${connection.port} · ${profile} (${connection.dbType ?? 'sqlserver'})`;
}
