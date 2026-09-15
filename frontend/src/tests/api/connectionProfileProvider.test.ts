import { log } from '../../utils/logger';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { MockIpcInvoker } from '../../api/ipc/mock-ipc-invoker';
import { __setIpcInvokerForTest, connectionProfileProvider } from '../../api/providers';
import type {
  ConnectionProfile,
  SaveConnectionProfileInput,
} from '../../api/providers/connection-profile';

vi.mock('../../utils/logger', () => ({ log: { info: vi.fn(), error: vi.fn() } }));

const SAMPLE_PROFILE: ConnectionProfile = {
  id: 'p-1',
  name: 'dev',
  server: 'localhost',
  database: 'test',
  username: 'sa',
  useWindowsAuth: false,
};

const SAMPLE_SAVE_PROFILE: SaveConnectionProfileInput = {
  name: 'dev',
  server: 'localhost',
  database: 'test',
  useWindowsAuth: false,
};

describe('connectionProfileProvider', () => {
  let mock: MockIpcInvoker;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = new MockIpcInvoker();
    __setIpcInvokerForTest(mock);
  });

  it('getConnectionProfiles: IPC を呼び profiles を返す', async () => {
    mock.setResponse('getConnectionProfiles', { profiles: [SAMPLE_PROFILE] });

    const result = await connectionProfileProvider.getConnectionProfiles();

    expect(mock.calls[0]).toEqual({ method: 'getConnectionProfiles', params: {} });
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0]).toEqual(SAMPLE_PROFILE);
  });

  it('getConnectionProfiles: schema 不一致時に throw する', async () => {
    mock.setResponse('getConnectionProfiles', { profiles: 'not array' });

    await expect(connectionProfileProvider.getConnectionProfiles()).rejects.toThrow();
  });

  it('saveConnectionProfile: IPC を呼び id を返す', async () => {
    mock.setResponse('saveConnectionProfile', { id: 'p-new' });

    const result = await connectionProfileProvider.saveConnectionProfile(SAMPLE_SAVE_PROFILE);

    expect(mock.calls[0]).toEqual({
      method: 'saveConnectionProfile',
      params: SAMPLE_SAVE_PROFILE,
    });
    expect(result).toEqual({ id: 'p-new' });
  });

  it('deleteConnectionProfile: id を {id} として渡し deleted を返す', async () => {
    mock.setResponse('deleteConnectionProfile', { deleted: true });

    const result = await connectionProfileProvider.deleteConnectionProfile('p-1');

    expect(mock.calls[0]).toEqual({
      method: 'deleteConnectionProfile',
      params: { id: 'p-1' },
    });
    expect(result).toEqual({ deleted: true });
  });

  it('getProfilePassword: profileId を {id} として渡し password を返す', async () => {
    mock.setResponse('getProfilePassword', { password: 'secret' });

    const result = await connectionProfileProvider.getProfilePassword('p-1');

    expect(mock.calls[0]).toEqual({ method: 'getProfilePassword', params: { id: 'p-1' } });
    expect(result).toEqual({ password: 'secret' });
  });

  it.each(['', 'secret-value'])('logs only password presence (%s)', async (password) => {
    mock.setResponse('getProfilePassword', { password });
    await connectionProfileProvider.getProfilePassword('private-profile-id');
    expect(log.info).toHaveBeenCalledExactlyOnceWith(
      `[Connection] stage=profile-password-read passwordPresent=${Boolean(password)}`
    );
  });

  it('logs lookup failure without copying backend error details', async () => {
    mock.setResponse('getProfilePassword', { password: 123 });
    await expect(
      connectionProfileProvider.getProfilePassword('private-profile-id')
    ).rejects.toThrow();
    expect(log.error).toHaveBeenCalledExactlyOnceWith(
      '[Connection] stage=profile-password-read outcome=failed'
    );
  });

  it('getSshPassword: profileId を {id} として渡し password を返す', async () => {
    mock.setResponse('getSshPassword', { password: 'ssh-secret' });

    const result = await connectionProfileProvider.getSshPassword('p-1');

    expect(mock.calls[0]).toEqual({ method: 'getSshPassword', params: { id: 'p-1' } });
    expect(result).toEqual({ password: 'ssh-secret' });
  });

  it('getSshKeyPassphrase: profileId を {id} として渡し passphrase を返す', async () => {
    mock.setResponse('getSshKeyPassphrase', { passphrase: 'pass' });

    const result = await connectionProfileProvider.getSshKeyPassphrase('p-1');

    expect(mock.calls[0]).toEqual({ method: 'getSshKeyPassphrase', params: { id: 'p-1' } });
    expect(result).toEqual({ passphrase: 'pass' });
  });

  describe('エラー伝播', () => {
    const cases: [string, () => Promise<unknown>][] = [
      ['getConnectionProfiles', () => connectionProfileProvider.getConnectionProfiles()],
      [
        'saveConnectionProfile',
        () => connectionProfileProvider.saveConnectionProfile(SAMPLE_SAVE_PROFILE),
      ],
      ['deleteConnectionProfile', () => connectionProfileProvider.deleteConnectionProfile('p-1')],
      ['getProfilePassword', () => connectionProfileProvider.getProfilePassword('p-1')],
      ['getSshPassword', () => connectionProfileProvider.getSshPassword('p-1')],
      ['getSshKeyPassphrase', () => connectionProfileProvider.getSshKeyPassphrase('p-1')],
    ];

    it.each(cases)('%s: IPC エラーを呼出側に伝播する', async (method, call) => {
      mock.setError(method, `${method} failed`);
      await expect(call()).rejects.toThrow(`${method} failed`);
    });
  });
});
