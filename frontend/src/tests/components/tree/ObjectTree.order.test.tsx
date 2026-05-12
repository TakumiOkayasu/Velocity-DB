import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const addConnectionMock = vi.fn().mockResolvedValue({});
const cancelConnectionMock = vi.fn();

type MockConnection = { id: string; name: string; isActive: boolean };

// Wrap mutable state in an object so vi.mock factory references the holder, not the binding.
// Reassigning a top-level `let` from beforeEach can desynchronize from the hoisted factory closure.
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

// Single source of truth: bridge schema. Schema drift surfaces as a compile error here.
type ProfileFixture = Awaited<ReturnType<typeof bridge.getConnectionProfiles>>['profiles'][number];

const buildProfile = (id: string, name: string): ProfileFixture => ({
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
});

const setProfiles = (profiles: ProfileFixture[]) => {
  vi.mocked(bridge.getConnectionProfiles).mockResolvedValue({
    profiles,
  });
};

const getRenderedProfileNames = () =>
  screen.getAllByTestId('profile-node').map((el) => el.dataset.profileName ?? '');

describe('ObjectTree unified rendering — profile order preservation', () => {
  beforeEach(() => {
    mockState.connections = [];
    addConnectionMock.mockClear();
    cancelConnectionMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should_preserve_profile_order_when_one_profile_is_connected', async () => {
    setProfiles([
      buildProfile('p_a', 'Alpha'),
      buildProfile('p_b', 'Bravo'),
      buildProfile('p_c', 'Charlie'),
      buildProfile('p_d', 'Delta'),
    ]);
    mockState.connections = [{ id: 'conn_b', name: 'Bravo', isActive: true }];

    render(<ObjectTree filter="" />);

    await waitFor(() => {
      expect(screen.getAllByTestId('profile-node')).toHaveLength(4);
    });

    expect(getRenderedProfileNames()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);
  });

  it('should_preserve_profile_order_when_middle_profile_is_connected', async () => {
    setProfiles([
      buildProfile('p_x', 'Xenon'),
      buildProfile('p_y', 'Yttrium'),
      buildProfile('p_z', 'Zinc'),
    ]);
    mockState.connections = [{ id: 'conn_y', name: 'Yttrium', isActive: true }];

    render(<ObjectTree filter="" />);

    await waitFor(() => {
      expect(screen.getAllByTestId('profile-node')).toHaveLength(3);
    });

    expect(getRenderedProfileNames()).toEqual(['Xenon', 'Yttrium', 'Zinc']);
  });

  it('should_render_no_connection_message_when_profiles_empty', async () => {
    setProfiles([]);
    mockState.connections = [];

    render(<ObjectTree filter="" />);

    await waitFor(() => {
      expect(screen.getByText('接続なし')).toBeInTheDocument();
    });
    expect(screen.queryAllByTestId('profile-node')).toHaveLength(0);
  });

  it('should_render_all_profiles_when_all_connected', async () => {
    setProfiles([
      buildProfile('p_1', 'One'),
      buildProfile('p_2', 'Two'),
      buildProfile('p_3', 'Three'),
    ]);
    mockState.connections = [
      { id: 'conn_1', name: 'One', isActive: true },
      { id: 'conn_2', name: 'Two', isActive: true },
      { id: 'conn_3', name: 'Three', isActive: true },
    ];

    render(<ObjectTree filter="" />);

    await waitFor(() => {
      expect(screen.getAllByTestId('profile-node')).toHaveLength(3);
    });
    expect(getRenderedProfileNames()).toEqual(['One', 'Two', 'Three']);
  });

  it('should_render_all_profiles_when_all_disconnected', async () => {
    setProfiles([
      buildProfile('p_1', 'One'),
      buildProfile('p_2', 'Two'),
      buildProfile('p_3', 'Three'),
    ]);
    mockState.connections = [];

    render(<ObjectTree filter="" />);

    await waitFor(() => {
      expect(screen.getAllByTestId('profile-node')).toHaveLength(3);
    });
    expect(getRenderedProfileNames()).toEqual(['One', 'Two', 'Three']);
  });
});
