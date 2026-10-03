import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  profiles: vi.fn(),
  prepare: vi.fn(),
  connect: vi.fn(),
  migrate: vi.fn(),
  toast: vi.fn(),
  settings: { general: { autoConnect: true } },
  state: { isConnecting: false, connections: [] as unknown[], addConnection: vi.fn() },
}));
vi.mock('../../utils/settingsCache', () => ({ loadSettingsCache: mocks.load }));
vi.mock('../../utils/settingsUtils', () => ({ getSettings: () => mocks.settings }));
vi.mock('../../api/providers', () => ({
  connectionProfileProvider: { getConnectionProfiles: mocks.profiles },
}));
vi.mock('../../store/connectionStore', () => ({
  useConnectionStore: { getState: () => mocks.state },
}));
vi.mock('../../store/connectionMigration', () => ({ applyConnectionMigration: mocks.migrate }));
vi.mock('../../store/toastStore', () => ({
  useToastStore: { getState: () => ({ addToast: mocks.toast }) },
}));
vi.mock('../../connections/createSavedConnection', () => ({
  createSavedConnection: () => ({ prepare: mocks.prepare }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.settings.general.autoConnect = true;
  mocks.state.connections = [];
  mocks.state.isConnecting = false;
  mocks.load.mockResolvedValue({ general: { lastConnectionId: 'saved-1' } });
  mocks.profiles.mockResolvedValue({
    profiles: [
      { id: 'saved-1', name: 'saved', server: 'localhost', database: 'test', username: 'user' },
    ],
  });
  mocks.prepare.mockResolvedValue({ connect: mocks.connect });
  mocks.connect.mockResolvedValue({ status: 'connected', replaced: [] });
});

describe('startup connection restoration', () => {
  it('waits for settings and connects only once across repeated initialization', async () => {
    const { initializeApplication } = await import('../../connections/initializeApplication');
    await Promise.all([initializeApplication(), initializeApplication()]);
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(mocks.migrate).toHaveBeenCalledTimes(1);
  });
  it.each(['disabled', 'no previous profile', 'manual connection active'])(
    'does not restore when %s',
    async (reason) => {
      if (reason === 'disabled') mocks.settings.general.autoConnect = false;
      if (reason === 'no previous profile')
        mocks.load.mockResolvedValue({ general: { lastConnectionId: '' } });
      if (reason === 'manual connection active') mocks.state.connections = [{}];
      const { initializeApplication } = await import('../../connections/initializeApplication');
      await initializeApplication();
      expect(mocks.profiles).not.toHaveBeenCalled();
      expect(mocks.connect).not.toHaveBeenCalled();
    }
  );
  it('does not substitute another profile when the previous profile was deleted', async () => {
    mocks.profiles.mockResolvedValue({ profiles: [{ id: 'other' }] });
    const { initializeApplication } = await import('../../connections/initializeApplication');
    await initializeApplication();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.any(String), 'info');
  });
  it('does not replace a manual connection started while credentials were being restored', async () => {
    mocks.prepare.mockImplementation(async () => {
      mocks.state.isConnecting = true;
      return { connect: mocks.connect };
    });
    const { initializeApplication } = await import('../../connections/initializeApplication');
    await initializeApplication();
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it('reports a credential failure without exposing its contents or retrying', async () => {
    mocks.prepare.mockRejectedValue(new Error('secret credential detail'));
    const { initializeApplication } = await import('../../connections/initializeApplication');
    await initializeApplication();
    await initializeApplication();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.not.stringContaining('secret'), 'error');
  });
});
