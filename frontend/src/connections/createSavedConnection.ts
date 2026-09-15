import type { ConnectionProfileProvider } from '../api/providers/connection-profile';
import type { Connection, SavedConnectionProfile } from '../types';
import type { ConnectionPreparation, ConnectionResult } from './ConnectionPreparation';

type SavedCredentials = Pick<
  ConnectionProfileProvider,
  'getProfilePassword' | 'getSshPassword' | 'getSshKeyPassphrase'
>;

type Connect = (connection: Omit<Connection, 'id' | 'isActive'>) => Promise<ConnectionResult>;

export function createSavedConnection(
  profile: SavedConnectionProfile,
  credentials: SavedCredentials,
  connect: Connect
): ConnectionPreparation {
  return {
    async prepare() {
      // Restore saved input without interpreting database authentication.
      // The driver decides which credentials its connection requires.
      const password = profile.savePassword
        ? (await credentials.getProfilePassword(profile.id)).password
        : '';
      let sshPassword = '';
      let sshKeyPassphrase = '';

      if (profile.ssh?.enabled) {
        if (profile.ssh.authType === 'password') {
          sshPassword = (await credentials.getSshPassword(profile.id)).password;
        } else {
          sshKeyPassphrase = (await credentials.getSshKeyPassphrase(profile.id)).passphrase;
        }
      }

      const connection: Omit<Connection, 'id' | 'isActive'> = {
        profileId: profile.id,
        name: profile.name,
        server: profile.server,
        port: profile.port,
        database: profile.database,
        username: profile.username,
        password,
        useWindowsAuth: profile.useWindowsAuth,
        dbType: profile.dbType ?? 'sqlserver',
        isProduction: profile.isProduction,
        isReadOnly: profile.isReadOnly,
        environment: profile.environment ?? (profile.isProduction ? 'production' : 'development'),
        ssh: profile.ssh?.enabled
          ? {
              enabled: true,
              host: profile.ssh.host,
              port: profile.ssh.port,
              username: profile.ssh.username,
              authType: profile.ssh.authType,
              password: sshPassword,
              privateKeyPath: profile.ssh.privateKeyPath,
              keyPassphrase: sshKeyPassphrase,
            }
          : undefined,
      };

      return { connect: () => connect(connection) };
    },
  };
}
