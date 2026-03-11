import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TransposeView } from '../../components/grid/TransposeView';
import type { ColumnMeta, RowData } from '../../types/grid';

const columns: ColumnMeta[] = [
  { name: 'id', comment: '', type: 'int' },
  { name: 'name', comment: '名前', type: 'nvarchar(100)' },
  { name: 'email', comment: '', type: 'varchar(255)' },
  { name: 'score', comment: '点数', type: 'decimal(18,2)' },
];

const rowData: RowData[] = [
  { id: '1', name: 'Alice', email: 'alice@example.com', score: '95.50' },
  { id: '2', name: null, email: 'bob@example.com', score: '80.00' },
  { id: '3', name: 'Charlie', email: null, score: null },
];

const defaultProps = {
  columns,
  rowData,
  currentRowIndex: 0,
  showLogicalNames: false,
  onNavigate: vi.fn(),
};

describe('TransposeView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('カラム名と値を正常に表示', () => {
    render(<TransposeView {...defaultProps} />);
    expect(screen.getByText('id')).toBeInTheDocument();
    expect(screen.getByText('name')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
  });

  it('NULL値に nullCell テキスト表示', () => {
    render(<TransposeView {...defaultProps} currentRowIndex={1} />);
    // 2行目: name が null
    const nullCells = screen.getAllByText('NULL');
    expect(nullCells.length).toBeGreaterThanOrEqual(1);
  });

  it('次の行へナビゲーション', () => {
    const onNavigate = vi.fn();
    render(<TransposeView {...defaultProps} onNavigate={onNavigate} />);
    const nextButton = screen.getByTitle('次の行');
    fireEvent.click(nextButton);
    expect(onNavigate).toHaveBeenCalledWith(1);
  });

  it('前の行へナビゲーション', () => {
    const onNavigate = vi.fn();
    render(<TransposeView {...defaultProps} currentRowIndex={2} onNavigate={onNavigate} />);
    const prevButton = screen.getByTitle('前の行');
    fireEvent.click(prevButton);
    expect(onNavigate).toHaveBeenCalledWith(1);
  });

  it('最初の行で前ボタンが無効', () => {
    render(<TransposeView {...defaultProps} currentRowIndex={0} />);
    const prevButton = screen.getByTitle('前の行');
    expect(prevButton).toBeDisabled();
  });

  it('最後の行で次ボタンが無効', () => {
    render(<TransposeView {...defaultProps} currentRowIndex={2} />);
    const nextButton = screen.getByTitle('次の行');
    expect(nextButton).toBeDisabled();
  });

  it('0行時の空状態表示', () => {
    render(<TransposeView {...defaultProps} rowData={[]} />);
    expect(screen.getByText('データがありません')).toBeInTheDocument();
  });

  it('論理名モードでcomment表示', () => {
    render(<TransposeView {...defaultProps} showLogicalNames={true} />);
    // name カラムは comment='名前' があるので '名前' を表示
    expect(screen.getByText('名前')).toBeInTheDocument();
    // comment がないカラムは物理名表示
    expect(screen.getByText('email')).toBeInTheDocument();
  });

  it('行番号表示が正しい', () => {
    render(<TransposeView {...defaultProps} currentRowIndex={1} />);
    expect(screen.getByText('/ 3')).toBeInTheDocument();
  });
});
