import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ioProvider, schemaProvider } from '../../api/providers';
import type { ColumnInfo, TableInfo } from '../../api/providers/schema';
import { SchemaCompareDialog } from '../../components/dialogs/SchemaCompareDialog';
import { useConnectionStore } from '../../store/connectionStore';
import type { Connection } from '../../types';

vi.mock('../../api/providers', () => ({
  schemaProvider: {
    getDatabases: vi.fn(),
    getTables: vi.fn(),
    getColumns: vi.fn(),
  },
  ioProvider: {
    saveQueryToFile: vi.fn(),
  },
  connectionProvider: {},
}));

function makeConnection(id: string, name: string, database: string): Connection {
  return {
    id,
    name,
    server: 'localhost',
    port: 1433,
    database,
    username: 'sa',
    password: '',
    useWindowsAuth: false,
    isActive: true,
    isProduction: false,
    isReadOnly: false,
    dbType: 'sqlserver',
  };
}

const CONN_A = makeConnection('conn-a', 'DevServer', 'AppDb');
const CONN_B = makeConnection('conn-b', 'ProdServer', 'AppDb');

// 移行元 (A): users (name varchar(50)), legacy
const TABLES_A: TableInfo[] = [
  { schema: 'dbo', name: 'users', type: 'TABLE' },
  { schema: 'dbo', name: 'legacy', type: 'TABLE' },
  { schema: 'dbo', name: 'v_users', type: 'VIEW' },
];

// 移行先 (B): users (name varchar(100) + email 追加), orders
const TABLES_B: TableInfo[] = [
  { schema: 'dbo', name: 'users', type: 'TABLE' },
  { schema: 'dbo', name: 'orders', type: 'TABLE' },
];

const COLUMNS: Record<string, Record<string, ColumnInfo[]>> = {
  'conn-a': {
    users: [
      { name: 'id', type: 'int', size: 4, nullable: false, isPrimaryKey: true },
      { name: 'name', type: 'varchar', size: 50, nullable: false, isPrimaryKey: false },
    ],
    legacy: [{ name: 'id', type: 'int', size: 4, nullable: false, isPrimaryKey: true }],
  },
  'conn-b': {
    users: [
      { name: 'id', type: 'int', size: 4, nullable: false, isPrimaryKey: true },
      { name: 'name', type: 'varchar', size: 100, nullable: false, isPrimaryKey: false },
      { name: 'email', type: 'varchar', size: 255, nullable: true, isPrimaryKey: false },
    ],
    orders: [{ name: 'id', type: 'int', size: 4, nullable: false, isPrimaryKey: true }],
  },
};

function selectSources() {
  const connectionSelects = screen.getAllByLabelText('接続');
  fireEvent.change(connectionSelects[0], { target: { value: 'conn-a' } });
  fireEvent.change(connectionSelects[1], { target: { value: 'conn-b' } });
}

async function compareAndWait() {
  selectSources();
  await waitFor(() => {
    expect(screen.getByText('比較')).not.toBeDisabled();
  });
  fireEvent.click(screen.getByText('比較'));
  await waitFor(() => {
    expect(screen.getByText('比較結果')).toBeInTheDocument();
  });
}

describe('SchemaCompareDialog', () => {
  const defaultProps = {
    isOpen: true as boolean,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({ connections: [CONN_A, CONN_B], activeConnectionId: null });

    vi.mocked(schemaProvider.getDatabases).mockResolvedValue(['AppDb', 'OtherDb']);
    vi.mocked(schemaProvider.getTables).mockImplementation(async (connectionId) => ({
      tables: connectionId === 'conn-a' ? TABLES_A : TABLES_B,
      loadTimeMs: 1,
    }));
    vi.mocked(schemaProvider.getColumns).mockImplementation(async (connectionId, table) => {
      const columns = COLUMNS[connectionId]?.[table];
      if (!columns) throw new Error(`unexpected getColumns(${connectionId}, ${table})`);
      return columns;
    });
    vi.mocked(ioProvider.saveQueryToFile).mockResolvedValue({ filePath: 'C:\\out\\mig.sql' });
  });

  it('isOpen=false時は非表示', () => {
    const { container } = render(<SchemaCompareDialog {...defaultProps} isOpen={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('isOpen=true時にタイトルと接続セレクタを表示する', () => {
    render(<SchemaCompareDialog {...defaultProps} />);
    expect(screen.getByText('スキーマ比較')).toBeInTheDocument();
    expect(screen.getByText('移行元 (A)')).toBeInTheDocument();
    expect(screen.getByText('移行先 (B)')).toBeInTheDocument();
    expect(screen.getAllByLabelText('接続')).toHaveLength(2);
  });

  it('Escapeキーでダイアログが閉じる', () => {
    const onClose = vi.fn();
    render(<SchemaCompareDialog {...defaultProps} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('接続未選択時は比較ボタンが無効', () => {
    render(<SchemaCompareDialog {...defaultProps} />);
    expect(screen.getByText('比較')).toBeDisabled();
  });

  it('接続選択でデータベース一覧を取得する', async () => {
    render(<SchemaCompareDialog {...defaultProps} />);
    selectSources();
    await waitFor(() => {
      expect(schemaProvider.getDatabases).toHaveBeenCalledWith('conn-a');
      expect(schemaProvider.getDatabases).toHaveBeenCalledWith('conn-b');
    });
  });

  it('比較実行でテーブル別にグループ化された差分を表示する', async () => {
    render(<SchemaCompareDialog {...defaultProps} />);
    await compareAndWait();

    // 追加 (B のみ) / 削除 (A のみ) / 変更 (共通で差分あり)
    expect(screen.getByText('dbo.orders')).toBeInTheDocument();
    expect(screen.getByText('dbo.legacy')).toBeInTheDocument();
    expect(screen.getByText('dbo.users')).toBeInTheDocument();
    expect(screen.getByText(/\+ email : varchar\(255\)/)).toBeInTheDocument();
    expect(screen.getByText(/~ name : varchar\(50\) -> varchar\(100\)/)).toBeInTheDocument();
  });

  it('VIEW は比較対象から除外される (getColumns が呼ばれない)', async () => {
    render(<SchemaCompareDialog {...defaultProps} />);
    await compareAndWait();
    expect(schemaProvider.getColumns).not.toHaveBeenCalledWith('conn-a', 'v_users');
  });

  it('比較実行で移行DDLが生成される (既定方言 sqlserver)', async () => {
    render(<SchemaCompareDialog {...defaultProps} />);
    await compareAndWait();

    const ddl = (screen.getByLabelText('生成された移行DDL') as HTMLTextAreaElement).value;
    expect(ddl).toContain('CREATE TABLE [dbo].[orders] (');
    expect(ddl).toContain('ALTER TABLE [dbo].[users] ADD [email] varchar(255);');
    expect(ddl).toContain('ALTER TABLE [dbo].[users] ALTER COLUMN [name] varchar(100) NOT NULL;');
    expect(ddl).toContain('-- DROP TABLE [dbo].[legacy];');
    expect(ddl).toContain('-- 移行元 (from): DevServer/AppDb');
    expect(ddl).toContain('-- 移行先 (to):   ProdServer/AppDb');
  });

  it('方言切替でDDLが再生成される', async () => {
    render(<SchemaCompareDialog {...defaultProps} />);
    await compareAndWait();

    fireEvent.change(screen.getByLabelText('DDL方言'), { target: { value: 'postgresql' } });
    const ddl = (screen.getByLabelText('生成された移行DDL') as HTMLTextAreaElement).value;
    expect(ddl).toContain('CREATE TABLE "dbo"."orders" (');
    expect(ddl).toContain('ALTER TABLE "dbo"."users" ADD COLUMN "email" varchar(255);');
    expect(ddl).toContain('-- 方言: postgresql');
  });

  it('ダウンロードボタンで saveQueryToFile を呼び出す', async () => {
    render(<SchemaCompareDialog {...defaultProps} />);
    await compareAndWait();

    fireEvent.click(screen.getByText('ダウンロード (.sql)'));
    await waitFor(() => {
      expect(ioProvider.saveQueryToFile).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE [dbo].[orders]'),
        'schema_migration.sql'
      );
    });
    expect(await screen.findByText(/保存しました: C:\\out\\mig\.sql/)).toBeInTheDocument();
  });

  it('スキーマ取得失敗時はエラーを表示する', async () => {
    vi.mocked(schemaProvider.getTables).mockRejectedValue(new Error('connection lost'));
    render(<SchemaCompareDialog {...defaultProps} />);
    selectSources();
    await waitFor(() => {
      expect(screen.getByText('比較')).not.toBeDisabled();
    });
    fireEvent.click(screen.getByText('比較'));

    expect(await screen.findByText('connection lost')).toBeInTheDocument();
    expect(screen.queryByText('比較結果')).not.toBeInTheDocument();
  });

  it('接続が存在しない場合はヒントを表示する', () => {
    useConnectionStore.setState({ connections: [], activeConnectionId: null });
    render(<SchemaCompareDialog {...defaultProps} />);
    expect(
      screen.getByText('比較するには先にデータベースへ接続してください。')
    ).toBeInTheDocument();
  });

  describe('DDLソース', () => {
    // 移行先 (B) 相当: conn-b のスキーマと同一内容の DDL
    const DDL_TARGET = `
      CREATE TABLE [dbo].[users] (
        [id] int NOT NULL PRIMARY KEY,
        [name] varchar(100) NOT NULL,
        [email] varchar(255) NULL
      );
      CREATE TABLE [dbo].[orders] (
        [id] int NOT NULL PRIMARY KEY
      );
    `;

    function selectSourceKind(index: number, kind: 'connection' | 'ddl') {
      const kindSelects = screen.getAllByLabelText('ソース種別');
      fireEvent.change(kindSelects[index], { target: { value: kind } });
    }

    function chooseDdlFile(content: string, fileName: string, index = 0) {
      const inputs = screen.getAllByLabelText('DDL ファイル');
      const file = new File([content], fileName, { type: 'application/sql' });
      fireEvent.change(inputs[index], { target: { files: [file] } });
    }

    it('ソース種別で DDL を選ぶと接続セレクタの代わりにファイル入力を表示する', () => {
      render(<SchemaCompareDialog {...defaultProps} />);
      expect(screen.getAllByLabelText('接続')).toHaveLength(2);
      selectSourceKind(1, 'ddl');
      expect(screen.getAllByLabelText('接続')).toHaveLength(1);
      expect(screen.getByLabelText('DDL ファイル')).toBeInTheDocument();
    });

    it('DDL ファイル読込でファイル名とテーブル数を表示する', async () => {
      render(<SchemaCompareDialog {...defaultProps} />);
      selectSourceKind(0, 'ddl');
      chooseDdlFile('CREATE TABLE a (id int); CREATE TABLE b (id int);', 'schema.sql');
      expect(await screen.findByText('schema.sql (2 テーブル)')).toBeInTheDocument();
    });

    it('CREATE TABLE を含まないファイルはエラーを表示し比較できない', async () => {
      render(<SchemaCompareDialog {...defaultProps} />);
      selectSourceKind(0, 'ddl');
      fireEvent.change(screen.getByLabelText('接続'), { target: { value: 'conn-b' } });
      await waitFor(() => {
        expect(schemaProvider.getDatabases).toHaveBeenCalledWith('conn-b');
      });
      chooseDdlFile('SELECT 1;', 'not_ddl.sql');
      expect(await screen.findByText('CREATE TABLE 文を検出できませんでした')).toBeInTheDocument();
      expect(screen.getByText('比較')).toBeDisabled();
    });

    it('接続 (A) と DDL ファイル (B) の比較で差分と移行DDLを生成する', async () => {
      render(<SchemaCompareDialog {...defaultProps} />);
      selectSourceKind(1, 'ddl');
      fireEvent.change(screen.getByLabelText('接続'), { target: { value: 'conn-a' } });
      chooseDdlFile(DDL_TARGET, 'target.sql');
      await screen.findByText('target.sql (2 テーブル)');
      await waitFor(() => {
        expect(screen.getByText('比較')).not.toBeDisabled();
      });
      fireEvent.click(screen.getByText('比較'));
      await waitFor(() => {
        expect(screen.getByText('比較結果')).toBeInTheDocument();
      });

      expect(screen.getByText('dbo.orders')).toBeInTheDocument();
      expect(screen.getByText('dbo.legacy')).toBeInTheDocument();
      expect(screen.getByText(/\+ email : varchar\(255\)/)).toBeInTheDocument();
      expect(screen.getByText(/~ name : varchar\(50\) -> varchar\(100\)/)).toBeInTheDocument();

      const ddl = (screen.getByLabelText('生成された移行DDL') as HTMLTextAreaElement).value;
      expect(ddl).toContain('-- 移行元 (from): DevServer/AppDb');
      expect(ddl).toContain('-- 移行先 (to):   DDL: target.sql');
      expect(ddl).toContain('ALTER TABLE [dbo].[users] ADD [email] varchar(255);');
      expect(ddl).toContain('CREATE TABLE [dbo].[orders] (');
    });

    it('DDL ファイル同士の比較は接続不要でスキーマ取得も行わない', async () => {
      useConnectionStore.setState({ connections: [], activeConnectionId: null });
      render(<SchemaCompareDialog {...defaultProps} />);
      selectSourceKind(0, 'ddl');
      selectSourceKind(1, 'ddl');
      expect(
        screen.queryByText('比較するには先にデータベースへ接続してください。')
      ).not.toBeInTheDocument();

      chooseDdlFile(
        'CREATE TABLE users (id int NOT NULL PRIMARY KEY, name varchar(50));',
        'from.sql',
        0
      );
      chooseDdlFile(
        'CREATE TABLE users (id int NOT NULL PRIMARY KEY, name varchar(100));',
        'to.sql',
        1
      );
      await screen.findByText('from.sql (1 テーブル)');
      await screen.findByText('to.sql (1 テーブル)');
      await waitFor(() => {
        expect(screen.getByText('比較')).not.toBeDisabled();
      });
      fireEvent.click(screen.getByText('比較'));
      await waitFor(() => {
        expect(screen.getByText('比較結果')).toBeInTheDocument();
      });

      expect(schemaProvider.getTables).not.toHaveBeenCalled();
      expect(screen.getByText(/~ name : varchar\(50\) -> varchar\(100\)/)).toBeInTheDocument();
    });
  });
});
