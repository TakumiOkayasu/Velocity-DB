import type { connectionProfileProvider } from '../api/providers';
import {
  isDatabaseType,
  isEnvironmentType,
  isSshAuthType,
  type SavedConnectionProfile,
} from '../types';

type RawProfile = Awaited<
  ReturnType<typeof connectionProfileProvider.getConnectionProfiles>
>['profiles'][number];

export function normalizeProfile(p: RawProfile): SavedConnectionProfile {
  return {
    id: p.id,
    name: p.name,
    server: p.server,
    port: p.port ?? 1433,
    database: p.database,
    username: p.username,
    useWindowsAuth: p.useWindowsAuth,
    savePassword: p.savePassword ?? false,
    isProduction: p.isProduction ?? false,
    isReadOnly: p.isReadOnly ?? false,
    environment: isEnvironmentType(p.environment ?? '')
      ? p.environment
      : p.isProduction
        ? 'production'
        : 'development',
    dbType: isDatabaseType(p.dbType ?? '') ? p.dbType : 'sqlserver',
    folderPath: p.folderPath ?? '',
    ssh: p.ssh
      ? {
          enabled: p.ssh.enabled ?? false,
          host: p.ssh.host ?? '',
          port: p.ssh.port ?? 22,
          username: p.ssh.username ?? '',
          authType: isSshAuthType(p.ssh.authType ?? '') ? p.ssh.authType : 'password',
          privateKeyPath: p.ssh.privateKeyPath ?? '',
          savePassword: p.ssh.savePassword ?? false,
        }
      : undefined,
  };
}
