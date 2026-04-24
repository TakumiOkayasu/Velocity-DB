import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const addConnectionMock = vi.fn().mockResolvedValue({});
const cancelConnectionMock = vi.fn();

type MockConnection = { id: string; name: string; isActive: boolean };

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

vi.mock('../../../api/bridge', () => ({
  bridge: {
    getConnectionProfiles: vi.fn(),
    getProfilePassword: vi.fn().mockResolvedValue({ password: '' }),
    getSshPassword: vi.fn().mockResolvedValue({ password: '' }),
    getSshKeyPassphrase: vi.fn().mockResolvedValue({ passphrase: '' }),
    getTables: vi.fn().mockResolvedValue({ tables: [], loadTimeMs: 0 }),
    getColumns: vi.fn().mockResolvedValue([]),
  },
}));

import { bridge } from '../../../api/bridge';
import { ObjectTree } from '../../../components/tree/ObjectTree';

type ProfileFixture = Awaited<ReturnType<typeof bridge.getConnectionProfiles>>['profiles'][number];

const buildProfile = (id: string, name: string, folderPath?: string): ProfileFixture => ({
  id,
  name,
  server: '127.0.0.1',
  port: 1433,
  database: 'db',
  username: 'sa',
  useWindowsAuth: false,
  savePassword: false,
  isProduction: false,
  isReadOnly: false,
  environment: 'development',
  dbType: 'sqlserver',
  ...(folderPath === undefined ? {} : { folderPath }),
});

const setProfiles = (profiles: ProfileFixture[]) => {
  vi.mocked(bridge.getConnectionProfiles).mockResolvedValue({ profiles });
};

const getFolderPaths = () =>
  screen.queryAllByTestId('folder-node').map((el) => el.dataset.folderPath ?? '');

describe('ObjectTree folder grouping', () => {
  beforeEach(() => {
    mockState.connections = [];
    addConnectionMock.mockClear();
    cancelConnectionMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders folder nodes for each distinct folderPath preserving first-appearance order', async () => {
    setProfiles([
      buildProfile('p1', 'Alpha'),
      buildProfile('p2', 'WorkA', 'Work'),
      buildProfile('p3', 'Beta'),
      buildProfile('p4', 'WorkB', 'Work'),
      buildProfile('p5', 'Home1', 'Personal'),
    ]);

    render(<ObjectTree filter="" />);

    await waitFor(() => {
      expect(screen.getAllByTestId('profile-node')).toHaveLength(5);
    });

    expect(getFolderPaths()).toEqual(['Work', 'Personal']);
  });

  it('does not render a folder node when all profiles are at root', async () => {
    setProfiles([buildProfile('p1', 'Alpha'), buildProfile('p2', 'Beta')]);

    render(<ObjectTree filter="" />);

    await waitFor(() => {
      expect(screen.getAllByTestId('profile-node')).toHaveLength(2);
    });

    expect(getFolderPaths()).toEqual([]);
  });

  it('hides inner profiles when folder is collapsed via click', async () => {
    setProfiles([buildProfile('p1', 'WorkA', 'Work'), buildProfile('p2', 'WorkB', 'Work')]);

    render(<ObjectTree filter="" />);

    await waitFor(() => {
      expect(screen.getAllByTestId('profile-node')).toHaveLength(2);
    });

    const folder = screen.getByTestId('folder-node');
    const header = folder.querySelector('[title="Work"]');
    expect(header).not.toBeNull();
    if (header) fireEvent.click(header);

    await waitFor(() => {
      expect(screen.queryAllByTestId('profile-node')).toHaveLength(0);
    });
  });

  it('preserves profile order within a folder', async () => {
    setProfiles([
      buildProfile('p1', 'Third', 'Work'),
      buildProfile('p2', 'First', 'Work'),
      buildProfile('p3', 'Second', 'Work'),
    ]);

    render(<ObjectTree filter="" />);

    await waitFor(() => {
      expect(screen.getAllByTestId('profile-node')).toHaveLength(3);
    });

    const names = screen.getAllByTestId('profile-node').map((el) => el.dataset.profileName ?? '');
    expect(names).toEqual(['Third', 'First', 'Second']);
  });
});
