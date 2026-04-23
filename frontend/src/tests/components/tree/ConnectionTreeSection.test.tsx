import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from '../../../types';

const { getTablesMock, getColumnsMock } = vi.hoisted(() => ({
  getTablesMock: vi.fn().mockResolvedValue({
    tables: [
      { schema: 'dbo', name: 'Users', type: 'TABLE', comment: '' },
      { schema: 'dbo', name: 'vw_Users', type: 'VIEW', comment: '' },
    ],
    loadTimeMs: 10,
  }),
  getColumnsMock: vi.fn().mockResolvedValue([
    { name: 'id', type: 'int', size: 4, nullable: false, isPrimaryKey: true },
    { name: 'name', type: 'varchar', size: 100, nullable: true, isPrimaryKey: false },
  ]),
}));

vi.mock('../../../store/connectionStore', () => {
  const store = {
    setTableListLoadTime: vi.fn(),
    removeConnection: vi.fn(),
  };
  const useConnectionStore = (selector?: (s: typeof store) => unknown) =>
    selector ? selector(store) : store;
  (useConnectionStore as unknown as { getState: () => typeof store }).getState = () => store;
  return { useConnectionStore };
});

vi.mock('../../../store/toastStore', () => {
  const addToast = vi.fn();
  const useToastStore = (selector?: (s: { addToast: typeof addToast }) => unknown) =>
    selector ? selector({ addToast }) : { addToast };
  return { useToastStore };
});

vi.mock('../../../api/bridge', () => ({
  bridge: {
    getTables: getTablesMock,
    getColumns: getColumnsMock,
    getReferencingForeignKeys: vi.fn().mockResolvedValue([]),
  },
}));

import { ConnectionTreeSection } from '../../../components/tree/ConnectionTreeSection';

const CONNECTION: Connection = {
  id: 'c1',
  name: 'test',
  server: 'localhost',
  port: 1433,
  database: 'test',
  username: 'sa',
  password: '',
  useWindowsAuth: false,
  isActive: true,
  isProduction: false,
  isReadOnly: false,
  environment: 'development',
  dbType: 'sqlserver',
};

async function openContextMenuOn(label: string): Promise<void> {
  // Tables/Views フォルダは初期展開されていないので、まず Tables フォルダをクリックして展開
  const tablesFolder = await screen.findByText(/^Tables \(/);
  fireEvent.click(tablesFolder);
  const viewsFolder = await screen.findByText(/^Views \(/);
  fireEvent.click(viewsFolder);

  const node = await screen.findByText(label);
  fireEvent.contextMenu(node);
}

describe('ConnectionTreeSection context menu', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('テーブルノード右クリックで INSERT文をコピー メニューが表示される', async () => {
    render(<ConnectionTreeSection connection={CONNECTION} filter="" />);
    await openContextMenuOn('Users');

    expect(await screen.findByText('INSERT文をコピー')).toBeInTheDocument();
    expect(screen.getByText('SELECT文をコピー')).toBeInTheDocument();
  });

  it('view ノードでは INSERT文をコピー メニューが表示されない (SELECT文は表示)', async () => {
    render(<ConnectionTreeSection connection={CONNECTION} filter="" />);
    await openContextMenuOn('vw_Users');

    expect(screen.getByText('SELECT文をコピー')).toBeInTheDocument();
    expect(screen.queryByText('INSERT文をコピー')).not.toBeInTheDocument();
  });
});
