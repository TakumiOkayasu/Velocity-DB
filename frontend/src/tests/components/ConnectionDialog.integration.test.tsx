import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { connectionProfileProvider, connectionProvider, schemaProvider } from '../../api/providers';
import { MainLayout } from '../../components/layout/MainLayout';
import { ObjectTree } from '../../components/tree/ObjectTree';
import { useConnectionStore } from '../../store/connectionStore';

// Keep the dialog, profile hook, layout callback, connection store and tree real.
// Only IPC and unrelated editor/layout behavior are replaced.
vi.mock('../../api/providers', () => ({
  connectionProfileProvider: {
    getConnectionProfiles: vi.fn(),
    getProfilePassword: vi.fn().mockResolvedValue({ password: '' }),
  },
  connectionProvider: {
    testConnection: vi.fn(),
    connectAsync: vi.fn(),
    getConnectResult: vi.fn(),
    cancelConnect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  },
  schemaProvider: {
    getTables: vi.fn(),
    getColumns: vi.fn().mockResolvedValue([]),
  },
  appSettingsProvider: { updateSettings: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../components/layout/CenterPanel', () => ({ CenterPanel: () => null }));
vi.mock('../../hooks/useFileDrop', () => ({
  useFileDrop: () => ({ isFileDragOver: false }),
}));
vi.mock('../../hooks/useKeyboardShortcutHandler', () => ({
  useKeyboardShortcutHandler: () => {},
}));
vi.mock('../../hooks/usePanelLayoutState', () => ({
  usePanelLayoutState: () => ({ isLeftPanelVisible: false, shouldShowBottomPanel: false }),
}));
vi.mock('../../store/connectionMigration', () => ({ applyConnectionMigration: vi.fn() }));
vi.mock('../../store/queryStore', () => ({
  useQueryStore: (selector: (state: object) => unknown) =>
    selector({ activeQueryId: null, queriesById: {}, results: {}, isExecuting: false }),
  useActiveQueryMeta: () => ({ connectionId: null, isDataView: false, name: '' }),
  useQueryActions: () => ({}),
}));

type ProfileFixture = Awaited<
  ReturnType<typeof connectionProfileProvider.getConnectionProfiles>
>['profiles'][number];

const profiles: ProfileFixture[] = ['dev', 'stage'].map((environment) => ({
  id: `profile-${environment}`,
  name: 'Shared',
  server: `${environment}-server`,
  port: 1433,
  database: 'test_db',
  username: '',
  useWindowsAuth: true,
  savePassword: false,
  isProduction: false,
  isReadOnly: false,
  environment: 'development',
  dbType: 'sqlserver',
  folderPath: environment,
}));

function profileNode(id: string): HTMLElement {
  const node = screen.getAllByTestId('profile-node').find((item) => item.dataset.profileId === id);
  if (!node) throw new Error(`Profile node not found: ${id}`);
  return node;
}

async function openDialog(): Promise<void> {
  render(
    <>
      <MainLayout />
      <ObjectTree filter="" />
    </>
  );
  await screen.findAllByTestId('profile-node');
  fireEvent.click(screen.getByTitle('新規接続'));
  // The first saved profile is selected asynchronously by the real profile hook.
  await screen.findByDisplayValue('dev-server');
}

describe('saved-profile connection through ConnectionDialog (#689)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState(useConnectionStore.getInitialState());
    vi.mocked(connectionProfileProvider.getConnectionProfiles).mockResolvedValue({ profiles });
    vi.mocked(connectionProvider.testConnection).mockResolvedValue({
      success: true,
      message: 'Connection successful',
    });
    vi.mocked(connectionProvider.connectAsync).mockResolvedValue({ requestId: 'request-689' });
    vi.mocked(connectionProvider.getConnectResult).mockResolvedValue({
      status: 'connected',
      connectionId: 'connection-689',
    });
    vi.mocked(schemaProvider.getTables).mockResolvedValue({
      tables: [{ schema: 'dbo', name: 'regression_table', type: 'TABLE', comment: '' }],
      loadTimeMs: 1,
    });
  });

  afterEach(cleanup);

  it.each(['dev', 'stage'])('connects only the selected %s profile and displays its tables', async (selected) => {
    await openDialog();
    if (selected === 'stage') {
      fireEvent.click(screen.getByText('stage-server/test_db'));
      await screen.findByDisplayValue('stage-server');
    }

    fireEvent.click(screen.getByRole('button', { name: 'テスト', exact: true }));
    await screen.findByText('Connection successful');
    expect(useConnectionStore.getState().connections).toHaveLength(0);

    fireEvent.click(screen.getByTestId('conn-submit'));
    await waitFor(() => {
      expect(useConnectionStore.getState().connections).toEqual([
        expect.objectContaining({ id: 'connection-689', profileId: `profile-${selected}` }),
      ]);
    });
    expect(useConnectionStore.getState().activeConnectionId).toBe('connection-689');
    expect(connectionProvider.connectAsync).toHaveBeenCalledWith(
      vi.mocked(connectionProvider.testConnection).mock.calls[0][0]
    );

    const selectedNode = profileNode(`profile-${selected}`);
    fireEvent.click(await within(selectedNode).findByText('Tables (1)'));
    await within(selectedNode).findByText('regression_table');
    const other = selected === 'dev' ? 'stage' : 'dev';
    expect(within(profileNode(`profile-${other}`)).getByText('未接続')).toBeInTheDocument();
    expect(schemaProvider.getTables).toHaveBeenCalledWith('connection-689', '');
  });

  it.each(['new', 'copy'])('does not inherit a saved profile ID for a %s connection', async (mode) => {
    await openDialog();
    if (mode === 'new') {
      fireEvent.click(screen.getByRole('button', { name: '+', exact: true }));
    } else {
      fireEvent.click(screen.getByTitle('接続プロファイルをコピー'));
    }
    await screen.findByRole('button', { name: '新規保存', exact: true });
    fireEvent.click(screen.getByTestId('conn-submit'));

    await waitFor(() => expect(useConnectionStore.getState().connections).toHaveLength(1));
    expect(useConnectionStore.getState().connections[0].profileId).toBeUndefined();
    for (const profile of profiles) {
      expect(within(profileNode(profile.id)).getByText('未接続')).toBeInTheDocument();
    }
  });
});
