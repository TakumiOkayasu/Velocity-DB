import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { connectionProfileProvider, connectionProvider, schemaProvider } from '../../api/providers';
import { MainLayout } from '../../components/layout/MainLayout';
import { ObjectTree } from '../../components/tree/ObjectTree';
import { useToastStore } from '../../store/toastStore';
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
  username: 'saved-user',
  useWindowsAuth: false,
  savePassword: true,
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
    useToastStore.setState({ toasts: [] });
    vi.mocked(connectionProfileProvider.getProfilePassword).mockResolvedValue({
      password: 'saved-secret',
    });
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

  it.each([
    ['postgresql', true, true],
    ['mysql', true, true],
    ['sqlserver', false, true],
    ['sqlserver', true, true],
    [undefined, true, true],
    ['postgresql', true, false],
  ] as const)(
    'tree credentials for dbType=%s windowsAuth=%s saved=%s (#718)',
    async (dbType, useWindowsAuth, needsPassword) => {
      vi.mocked(connectionProfileProvider.getConnectionProfiles).mockResolvedValue({
        profiles: [{ ...profiles[0], dbType, useWindowsAuth, savePassword: needsPassword }],
      });
      render(<ObjectTree filter="" />);
      await screen.findAllByTestId('profile-node');
      fireEvent.click(profileNode('profile-dev'));
      fireEvent.click(
        await within(screen.getByRole('dialog')).findByRole('button', { name: '接続' })
      );
      await waitFor(() => expect(useConnectionStore.getState().connections).toHaveLength(1));
      if (needsPassword) {
        expect(connectionProfileProvider.getProfilePassword).toHaveBeenCalledWith('profile-dev');
      } else {
        expect(connectionProfileProvider.getProfilePassword).not.toHaveBeenCalled();
      }
      expect(connectionProvider.connectAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          dbType: dbType ?? 'sqlserver',
          password: needsPassword ? 'saved-secret' : '',
          useWindowsAuth,
        })
      );
      const node = profileNode('profile-dev');
      fireEvent.click(await within(node).findByText('Tables (1)'));
      await within(node).findByText('regression_table');
    }
  );

  it.each(['postgresql', 'mysql'] as const)(
    '%s dialog and tree use the same credentials with a stale Windows authentication flag',
    async (dbType) => {
      vi.mocked(connectionProfileProvider.getConnectionProfiles).mockResolvedValue({
        profiles: profiles.map((profile) => ({ ...profile, dbType, useWindowsAuth: true })),
      });
      await openDialog();
      fireEvent.click(screen.getByRole('button', { name: 'テスト' }));
      await screen.findByText('Connection successful');
      expect(connectionProvider.testConnection).toHaveBeenCalledWith(
        expect.objectContaining({ dbType, password: 'saved-secret', useWindowsAuth: true })
      );
      fireEvent.keyDown(window, { key: 'Escape' });
      vi.mocked(connectionProfileProvider.getProfilePassword).mockClear();
      fireEvent.click(profileNode('profile-dev'));
      fireEvent.click(
        await within(screen.getByRole('dialog')).findByRole('button', { name: '接続' })
      );
      await waitFor(() => expect(useConnectionStore.getState().connections).toHaveLength(1));
      expect(connectionProfileProvider.getProfilePassword).toHaveBeenCalledWith('profile-dev');
      expect(connectionProvider.connectAsync).toHaveBeenCalledWith(
        vi.mocked(connectionProvider.testConnection).mock.calls[0][0]
      );
    }
  );

  it.each(['PostgreSQL', 'MySQL'])(
    'clears the previous authentication choice when switching database to %s',
    async (database) => {
      await openDialog();
      fireEvent.click(screen.getByRole('button', { name: '+' }));
      expect(screen.getByRole('checkbox', { name: 'Windows認証を使用' })).toBeChecked();
      fireEvent.click(screen.getByRole('radio', { name: database }));
      fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'typed-secret' } });
      fireEvent.click(screen.getByRole('button', { name: 'テスト' }));
      await screen.findByText('Connection successful');
      expect(connectionProvider.testConnection).toHaveBeenCalledWith(
        expect.objectContaining({ password: 'typed-secret', useWindowsAuth: false })
      );
      fireEvent.click(screen.getByRole('radio', { name: 'SQL Server' }));
      const windowsAuth = screen.getByRole('checkbox', { name: 'Windows認証を使用' });
      expect(windowsAuth).not.toBeChecked();
      fireEvent.click(windowsAuth);
      expect(windowsAuth).toBeChecked();
    }
  );

  it.each(['dev', 'stage'])('shows tables for the selected %s profile', async (selected) => {
    await openDialog();
    if (selected === 'stage') {
      fireEvent.click(screen.getByText('stage-server/test_db'));
      await screen.findByDisplayValue('stage-server');
    }

    fireEvent.click(screen.getByRole('button', { name: 'テスト' }));
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

  it('tree connection sends the same saved credentials as the successful connection test', async () => {
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'テスト' }));
    await screen.findByText('Connection successful');
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(profileNode('profile-dev'));
    fireEvent.click(
      await within(screen.getByRole('dialog')).findByRole('button', { name: '接続' })
    );
    await waitFor(() => expect(useConnectionStore.getState().connections).toHaveLength(1));
    expect(connectionProvider.connectAsync).toHaveBeenCalledWith(
      vi.mocked(connectionProvider.testConnection).mock.calls[0][0]
    );
    const node = profileNode('profile-dev');
    fireEvent.click(await within(node).findByText('Tables (1)'));
    await within(node).findByText('regression_table');
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({ type: 'success', message: '接続できました' }),
    ]);
  });

  it.each(['dialog', 'tree'])(
    'reports actual connection failure after a successful test through %s',
    async (route) => {
      vi.mocked(connectionProvider.getConnectResult).mockResolvedValue({
        status: 'failed',
        error: 'Metadata connection failed: test failure',
      });
      await openDialog();
      fireEvent.click(screen.getByRole('button', { name: 'テスト' }));
      await screen.findByText('Connection successful');
      if (route === 'tree') {
        fireEvent.keyDown(window, { key: 'Escape' });
        fireEvent.click(profileNode('profile-dev'));
        fireEvent.click(
          await within(screen.getByRole('dialog')).findByRole('button', { name: '接続' })
        );
      } else {
        fireEvent.click(screen.getByTestId('conn-submit'));
      }
      const failure = await screen.findByRole('dialog', { name: '接続できませんでした' });
      expect(within(failure).getByLabelText('エラー詳細 (Ctrl+Cで全文コピー)')).toHaveTextContent(
        'Metadata connection failed: test failure'
      );
      expect(useConnectionStore.getState().connections).toHaveLength(0);
      expect(within(profileNode('profile-dev')).getByText('未接続')).toBeInTheDocument();
      expect(useToastStore.getState().toasts).toHaveLength(0);
      expect(schemaProvider.getTables).not.toHaveBeenCalled();
    }
  );

  it('cancel during credential retrieval does not start a connection or report success', async () => {
    let resolvePassword: (value: { password: string }) => void = () => {};
    vi.mocked(connectionProfileProvider.getProfilePassword).mockReturnValue(
      new Promise((resolve) => {
        resolvePassword = resolve;
      })
    );
    render(<ObjectTree filter="" />);
    await screen.findAllByTestId('profile-node');
    fireEvent.click(profileNode('profile-dev'));
    fireEvent.click(
      await within(screen.getByRole('dialog')).findByRole('button', { name: '接続' })
    );
    fireEvent.click(await screen.findByRole('button', { name: '接続中止' }));
    await act(async () => {
      resolvePassword({ password: 'saved-secret' });
    });
    expect(connectionProvider.connectAsync).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().connections).toHaveLength(0);
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({ type: 'info', message: '接続を中止しました' }),
    ]);
  });

  it('credential retrieval failure opens a copyable error dialog without connecting', async () => {
    vi.mocked(connectionProfileProvider.getProfilePassword).mockRejectedValue(
      new Error('Credential read failed')
    );
    render(<ObjectTree filter="" />);
    await screen.findAllByTestId('profile-node');
    fireEvent.click(profileNode('profile-dev'));
    fireEvent.click(
      await within(screen.getByRole('dialog')).findByRole('button', { name: '接続' })
    );
    await screen.findByRole('dialog', { name: '接続できませんでした' });
    expect(connectionProvider.connectAsync).not.toHaveBeenCalled();
  });

  it.each(['new', 'copy'])('keeps %s connections ad hoc', async (mode) => {
    await openDialog();
    if (mode === 'new') {
      fireEvent.click(screen.getByRole('button', { name: '+' }));
    } else {
      fireEvent.click(screen.getByTitle('接続プロファイルをコピー'));
    }
    await screen.findByRole('button', { name: '新規保存' });
    fireEvent.click(screen.getByTestId('conn-submit'));

    await waitFor(() => expect(useConnectionStore.getState().connections).toHaveLength(1));
    expect(useConnectionStore.getState().connections[0].profileId).toBeUndefined();
    for (const profile of profiles) {
      expect(within(profileNode(profile.id)).getByText('未接続')).toBeInTheDocument();
    }
  });
});
