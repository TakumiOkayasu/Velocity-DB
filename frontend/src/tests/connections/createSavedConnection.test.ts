import { describe, expect, it, vi } from 'vite-plus/test';
import { createSavedConnection } from '../../connections/createSavedConnection';
import type { ConnectionResult } from '../../connections/ConnectionPreparation';
import type { SavedConnectionProfile } from '../../types';

const profile: SavedConnectionProfile = {
  id: 'saved-profile',
  name: 'Saved connection',
  server: 'localhost',
  port: 5432,
  database: 'test',
  username: 'user',
  dbType: 'postgresql',
  useWindowsAuth: true,
  savePassword: true,
  isProduction: false,
  isReadOnly: true,
  environment: 'staging',
};

function dependencies() {
  return {
    credentials: {
      getProfilePassword: vi.fn().mockResolvedValue({ password: 'saved-secret' }),
      getSshPassword: vi.fn().mockResolvedValue({ password: 'ssh-secret' }),
      getSshKeyPassphrase: vi.fn().mockResolvedValue({ passphrase: 'key-secret' }),
    },
    connect: vi.fn().mockResolvedValue({ status: 'connected' } satisfies ConnectionResult),
  };
}

describe('saved connection preparation', () => {
  it('does not connect during creation or preparation; the prepared operation executes it', async () => {
    const { credentials, connect } = dependencies();
    const preparation = createSavedConnection(profile, credentials, connect);
    expect(credentials.getProfilePassword).not.toHaveBeenCalled();
    const prepared = await preparation.prepare();
    expect(connect).not.toHaveBeenCalled();

    await expect(prepared.connect()).resolves.toEqual({ status: 'connected' });
    expect(connect).toHaveBeenCalledExactlyOnceWith({
      profileId: profile.id,
      name: profile.name,
      server: profile.server,
      port: profile.port,
      database: profile.database,
      username: profile.username,
      password: 'saved-secret',
      useWindowsAuth: true,
      dbType: profile.dbType,
      isProduction: false,
      isReadOnly: true,
      environment: 'staging',
      ssh: undefined,
    });
    expect(credentials.getSshPassword).not.toHaveBeenCalled();
    expect(credentials.getSshKeyPassphrase).not.toHaveBeenCalled();
  });

  it('does not restore a password that was not saved', async () => {
    const { credentials, connect } = dependencies();
    const prepared = await createSavedConnection(
      { ...profile, savePassword: false },
      credentials,
      connect
    ).prepare();
    await prepared.connect();
    expect(credentials.getProfilePassword).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ password: '' }));
  });

  it('leaves acceptance of empty credentials to the connector', async () => {
    const { credentials, connect } = dependencies();
    credentials.getProfilePassword.mockResolvedValue({ password: '' });
    const prepared = await createSavedConnection(profile, credentials, connect).prepare();
    await prepared.connect();
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ password: '' }));
  });

  it('propagates credential retrieval failure without attempting a connection', async () => {
    const { credentials, connect } = dependencies();
    const failure = new Error('Credential unavailable');
    credentials.getProfilePassword.mockRejectedValue(failure);
    await expect(createSavedConnection(profile, credentials, connect).prepare()).rejects.toBe(
      failure
    );
    expect(connect).not.toHaveBeenCalled();
  });

  it.each(['password', 'privateKey'] as const)(
    'restores the configured SSH %s credentials independently of database authentication',
    async (authType) => {
      const { credentials, connect } = dependencies();
      const ssh = {
        enabled: true,
        host: 'jump-host',
        port: 22,
        username: 'ssh-user',
        authType,
        privateKeyPath: '/keys/id',
        savePassword: true,
      };
      const prepared = await createSavedConnection(
        { ...profile, ssh },
        credentials,
        connect
      ).prepare();
      await prepared.connect();
      expect(connect).toHaveBeenCalledWith(
        expect.objectContaining({
          password: 'saved-secret',
          ssh: {
            enabled: true,
            host: 'jump-host',
            port: 22,
            username: 'ssh-user',
            authType,
            password: authType === 'password' ? 'ssh-secret' : '',
            privateKeyPath: '/keys/id',
            keyPassphrase: authType === 'privateKey' ? 'key-secret' : '',
          },
        })
      );
      expect(credentials.getSshPassword).toHaveBeenCalledTimes(authType === 'password' ? 1 : 0);
      expect(credentials.getSshKeyPassphrase).toHaveBeenCalledTimes(
        authType === 'privateKey' ? 1 : 0
      );
    }
  );

  it('does not connect after SSH credential retrieval fails', async () => {
    const { credentials, connect } = dependencies();
    const failure = new Error('SSH credential unavailable');
    credentials.getSshKeyPassphrase.mockRejectedValue(failure);
    await expect(
      createSavedConnection(
        {
          ...profile,
          ssh: {
            enabled: true,
            host: 'jump-host',
            port: 22,
            username: 'ssh-user',
            authType: 'privateKey',
            privateKeyPath: '/keys/id',
            savePassword: true,
          },
        },
        credentials,
        connect
      ).prepare()
    ).rejects.toBe(failure);
    expect(connect).not.toHaveBeenCalled();
  });

  it('returns the connector failure without replacing or retrying it', async () => {
    const { credentials, connect } = dependencies();
    const result: ConnectionResult = { status: 'failed', error: 'Connection rejected' };
    connect.mockResolvedValue(result);
    const prepared = await createSavedConnection(profile, credentials, connect).prepare();
    await expect(prepared.connect()).resolves.toBe(result);
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
