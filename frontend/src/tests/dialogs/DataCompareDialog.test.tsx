import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { queryProvider } from '../../api/providers';
import type { ExecuteQueryResult } from '../../api/providers/query';
import { DataCompareDialog } from '../../components/dialogs/DataCompareDialog';
import { useConnectionStore } from '../../store/connectionStore';
import type { Connection } from '../../types';

vi.mock('../../api/providers', () => ({
  queryProvider: {
    executeQuery: vi.fn(),
  },
  connectionProvider: {},
  schemaProvider: {},
}));

function makeConnection(id: string, name: string): Connection {
  return {
    id,
    name,
    server: 'localhost',
    port: 1433,
    database: 'testdb',
    username: 'sa',
    password: 'pass',
    useWindowsAuth: false,
    isActive: true,
    isProduction: false,
    isReadOnly: false,
    dbType: 'sqlserver',
  };
}

function queryResult(rows: (string | null)[][]): ExecuteQueryResult {
  return {
    columns: [
      { name: 'id', type: 'int' },
      { name: 'name', type: 'varchar' },
    ],
    rows,
    affectedRows: 0,
    executionTimeMs: 1,
    cached: false,
  };
}

// A: id=1 Alice (一致), id=2 Bob (変更元)
// B: id=1 Alice, id=2 Bobby (変更), id=3 Carol (追加)
const RESULT_A = queryResult([
  ['1', 'Alice'],
  ['2', 'Bob'],
]);
const RESULT_B = queryResult([
  ['1', 'Alice'],
  ['2', 'Bobby'],
  ['3', 'Carol'],
]);

async function loadAndCompare() {
  fireEvent.change(screen.getByLabelText('接続 (A)'), { target: { value: 'conn-1' } });
  fireEvent.change(screen.getByLabelText('接続 (B)'), { target: { value: 'conn-2' } });
  fireEvent.change(screen.getByLabelText('テーブル名 (A)'), { target: { value: 'dbo.TableA' } });
  fireEvent.change(screen.getByLabelText('テーブル名 (B)'), { target: { value: 'dbo.TableB' } });
  fireEvent.click(screen.getByText('データ読み込み'));

  await waitFor(() => expect(screen.getByText('比較実行')).toBeInTheDocument());
  fireEvent.click(screen.getByText('比較実行'));
  await waitFor(() => expect(screen.getByText('追加 1')).toBeInTheDocument());
}

describe('DataCompareDialog', () => {
  const defaultProps = {
    isOpen: true as boolean,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    useConnectionStore.setState({
      connections: [makeConnection('conn-1', '接続1'), makeConnection('conn-2', '接続2')],
      activeConnectionId: 'conn-1',
    });
    vi.mocked(queryProvider.executeQuery)
      .mockReset()
      .mockImplementation(async (_connectionId: string, sql: string) =>
        sql.includes('TableA') ? RESULT_A : RESULT_B
      );
  });

  afterEach(() => {
    useConnectionStore.setState({ connections: [], activeConnectionId: null });
    vi.clearAllMocks();
  });

  it('isOpen=false時に非表示', () => {
    const { container } = render(<DataCompareDialog {...defaultProps} isOpen={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('isOpen=true時にタイトルとソース入力を表示', () => {
    render(<DataCompareDialog {...defaultProps} />);
    expect(screen.getByText('データ比較')).toBeInTheDocument();
    expect(screen.getByText('ソース A')).toBeInTheDocument();
    expect(screen.getByText('ソース B')).toBeInTheDocument();
    expect(screen.getByLabelText('接続 (A)')).toBeInTheDocument();
    expect(screen.getByLabelText('接続 (B)')).toBeInTheDocument();
  });

  it('接続がない場合は案内メッセージを表示', () => {
    useConnectionStore.setState({ connections: [], activeConnectionId: null });
    render(<DataCompareDialog {...defaultProps} />);
    expect(screen.getByText('比較するにはデータベースに接続してください')).toBeInTheDocument();
  });

  it('Escapeキーで閉じる', () => {
    const onClose = vi.fn();
    render(<DataCompareDialog {...defaultProps} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('接続未選択で読み込むとバリデーションエラーを表示', () => {
    render(<DataCompareDialog {...defaultProps} />);
    fireEvent.click(screen.getByText('データ読み込み'));
    expect(screen.getByText('A: 接続を選択してください')).toBeInTheDocument();
    expect(queryProvider.executeQuery).not.toHaveBeenCalled();
  });

  it('2ソースを読み込み、行数とキーカラム選択を表示する', async () => {
    render(<DataCompareDialog {...defaultProps} />);
    fireEvent.change(screen.getByLabelText('接続 (A)'), { target: { value: 'conn-1' } });
    fireEvent.change(screen.getByLabelText('接続 (B)'), { target: { value: 'conn-2' } });
    fireEvent.change(screen.getByLabelText('テーブル名 (A)'), { target: { value: 'dbo.TableA' } });
    fireEvent.change(screen.getByLabelText('テーブル名 (B)'), { target: { value: 'dbo.TableB' } });
    fireEvent.click(screen.getByText('データ読み込み'));

    await waitFor(() => expect(screen.getByText('キーカラム:')).toBeInTheDocument());
    expect(screen.getByText('A: 2行 × 2列 / B: 3行 × 2列')).toBeInTheDocument();
    expect(queryProvider.executeQuery).toHaveBeenCalledTimes(2);
    expect(queryProvider.executeQuery).toHaveBeenCalledWith(
      'conn-1',
      'SELECT * FROM [dbo].[TableA]',
      false
    );
    expect(queryProvider.executeQuery).toHaveBeenCalledWith(
      'conn-2',
      'SELECT * FROM [dbo].[TableB]',
      false
    );
  });

  it('比較実行でサマリカウントを表示する', async () => {
    render(<DataCompareDialog {...defaultProps} />);
    await loadAndCompare();

    expect(screen.getByText('追加 1')).toBeInTheDocument();
    expect(screen.getByText('削除 0')).toBeInTheDocument();
    expect(screen.getByText('変更 1')).toBeInTheDocument();
    expect(screen.getByText('一致 1')).toBeInTheDocument();
  });

  it('デフォルトの差分のみフィルタでは identical 行を表示しない', async () => {
    render(<DataCompareDialog {...defaultProps} />);
    await loadAndCompare();

    // 変更行 (Bob → Bobby) と追加行 (Carol) は表示される
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Bobby')).toBeInTheDocument();
    expect(screen.getByText('Carol')).toBeInTheDocument();
    // identical 行 (Alice) は非表示
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });

  it('「すべて」フィルタに切り替えると identical 行も表示する', async () => {
    render(<DataCompareDialog {...defaultProps} />);
    await loadAndCompare();

    fireEvent.click(screen.getByText('すべて'));
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('SQLモードでカスタムクエリを実行できる', async () => {
    render(<DataCompareDialog {...defaultProps} />);
    fireEvent.change(screen.getByLabelText('接続 (A)'), { target: { value: 'conn-1' } });
    fireEvent.change(screen.getByLabelText('接続 (B)'), { target: { value: 'conn-2' } });

    // 両ソースを SQL モードに切り替え
    const sqlTabs = screen.getAllByText('SQL');
    for (const tab of sqlTabs) {
      fireEvent.click(tab);
    }
    fireEvent.change(screen.getByLabelText('SQL (A)'), {
      target: { value: 'SELECT * FROM TableA WHERE x = 1' },
    });
    fireEvent.change(screen.getByLabelText('SQL (B)'), {
      target: { value: 'SELECT * FROM TableB WHERE x = 1' },
    });
    fireEvent.click(screen.getByText('データ読み込み'));

    await waitFor(() => expect(screen.getByText('キーカラム:')).toBeInTheDocument());
    expect(queryProvider.executeQuery).toHaveBeenCalledWith(
      'conn-1',
      'SELECT * FROM TableA WHERE x = 1',
      false
    );
  });

  it('読み込みエラー時にエラーメッセージを表示', async () => {
    vi.mocked(queryProvider.executeQuery).mockRejectedValue(new Error('接続が失われました'));
    render(<DataCompareDialog {...defaultProps} />);
    fireEvent.change(screen.getByLabelText('接続 (A)'), { target: { value: 'conn-1' } });
    fireEvent.change(screen.getByLabelText('接続 (B)'), { target: { value: 'conn-2' } });
    fireEvent.change(screen.getByLabelText('テーブル名 (A)'), { target: { value: 'dbo.TableA' } });
    fireEvent.change(screen.getByLabelText('テーブル名 (B)'), { target: { value: 'dbo.TableB' } });
    fireEvent.click(screen.getByText('データ読み込み'));

    await waitFor(() => expect(screen.getByText('接続が失われました')).toBeInTheDocument());
  });
});
