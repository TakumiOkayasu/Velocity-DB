import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const addConnectionMock = vi.fn().mockResolvedValue({});
const cancelConnectionMock = vi.fn();

type MockConnection = {
  id: string;
  name: string;
  isActive: boolean;
  profileId?: string;
};

const mockState: { connections: MockConnection[] } = { connections: [] };

vi.mock('../../../store/connectionStore', () => {
  const useConnectionStore = (
    selector?: (s: { connections: MockConnection[]; profileVersion: number }) => unknown
  ) => (selector ? selector({ connections: mockState.connections, profileVersion: 0 }) : null);
  (useConnectionStore as unknown as { getState: () => unknown }).getState = () => ({
    connections: mockState.connections,
    activeConnectionId: null,
    setTableListLoadTime: vi.fn(),
    setTableOpenTime: vi.fn(),
  });
  return {
    useConnectionStore,
    useConnectionActions: () => ({
      addConnection: addConnectionMock,
      cancelConnection: cancelConnectionMock,
    }),
  };
});

vi.mock('../../../store/connectionMigration', () => ({
  applyConnectionMigration: vi.fn(),
}));

vi.mock('../../../api/providers', () => ({
  settingsProvider: {
    getConnectionProfiles: vi.fn(),
    getProfilePassword: vi.fn().mockResolvedValue({ password: '' }),
    getSshPassword: vi.fn().mockResolvedValue({ password: '' }),
    getSshKeyPassphrase: vi.fn().mockResolvedValue({ passphrase: '' }),
  },
  schemaProvider: {
    getTables: vi.fn().mockResolvedValue({ tables: [], loadTimeMs: 0 }),
    getColumns: vi.fn().mockResolvedValue([]),
  },
}));

import { settingsProvider as bridge } from '../../../api/providers';
import { ObjectTree } from '../../../components/tree/ObjectTree';

type ProfileFixture = Awaited<ReturnType<typeof bridge.getConnectionProfiles>>['profiles'][number];

const buildProfile = (id: string, name: string, folderPath: string): ProfileFixture => ({
  id,
  name,
  server: 's',
  port: 1433,
  database: 'd',
  username: 'u',
  useWindowsAuth: false,
  savePassword: false,
  isProduction: false,
  isReadOnly: false,
  environment: 'development',
  dbType: 'sqlserver',
  folderPath,
});

const setProfiles = (profiles: ProfileFixture[]) => {
  vi.mocked(bridge.getConnectionProfiles).mockResolvedValue({ profiles });
};

describe('ObjectTree profileId-based active state (#414)', () => {
  beforeEach(() => {
    mockState.connections = [];
    addConnectionMock.mockClear();
    cancelConnectionMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // 接続中 profile は ConnectionTreeSection を表示し「未接続」テキストを出さない。
  // 未接続 profile は ProfileNode 内で「未接続」テキストを出す (ProfileNode L40)。
  // 振る舞い (UI 表示) ベースで active/inactive を判定する。
  const isUnconnected = (node: HTMLElement) => node.textContent?.includes('未接続') ?? false;

  it('同名異フォルダの 2 profile で profileId 一致側のみ接続中表示、もう片方は未接続のまま', async () => {
    setProfiles([
      buildProfile('p_dev_test', 'Test', 'Develop'),
      buildProfile('p_stg_test', 'Test', 'Staging'),
    ]);
    mockState.connections = [
      {
        id: 'db_dev',
        name: 'Test',
        isActive: true,
        profileId: 'p_dev_test',
      },
    ];

    render(<ObjectTree filter="" />);

    await waitFor(() => {
      expect(screen.getAllByTestId('profile-node')).toHaveLength(2);
    });

    const nodes = screen.getAllByTestId('profile-node');
    const byProfileId = Object.fromEntries(nodes.map((n) => [n.dataset.profileId, n]));

    expect(isUnconnected(byProfileId.p_dev_test)).toBe(false);
    expect(isUnconnected(byProfileId.p_stg_test)).toBe(true);
  });

  it('profileId 無しの connection は profile に紐づかない (profile 行は未接続のまま)', async () => {
    setProfiles([buildProfile('p_only', 'Test', 'Develop')]);
    mockState.connections = [
      {
        id: 'db_manual',
        name: 'Test',
        isActive: true,
        // profileId 無し = 手動接続
      },
    ];

    render(<ObjectTree filter="" />);

    await waitFor(() => {
      expect(screen.getAllByTestId('profile-node')).toHaveLength(1);
    });

    const node = screen.getAllByTestId('profile-node')[0];
    expect(isUnconnected(node)).toBe(true);
  });
});
