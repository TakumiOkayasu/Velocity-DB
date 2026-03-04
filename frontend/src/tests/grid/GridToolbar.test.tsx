import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GridToolbar } from '../../components/grid/GridToolbar';

const defaultProps = {
  showRefresh: false,
  isEditMode: false,
  hasChanges: false,
  isApplying: false,
  applyError: null,
  showLogicalNamesInGrid: false,
  showColumnFilters: false,
  isReadOnly: false,
  onRefresh: vi.fn(),
  onToggleEditMode: vi.fn(),
  onDeleteRow: vi.fn(),
  onRevertChanges: vi.fn(),
  onApplyChanges: vi.fn(),
  onSetShowLogicalNames: vi.fn(),
  onToggleColumnFilters: vi.fn(),
  onExport: vi.fn(),
};

describe('GridToolbar read-only mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('isReadOnly=true で編集ボタンが disabled', () => {
    render(<GridToolbar {...defaultProps} isReadOnly={true} />);
    const editButton = screen.getByRole('button', { name: /編集/ });
    expect(editButton).toBeDisabled();
  });

  it('isReadOnly=true で「読取専用」バッジを表示', () => {
    render(<GridToolbar {...defaultProps} isReadOnly={true} />);
    expect(screen.getByText('読取専用')).toBeInTheDocument();
  });

  it('isReadOnly=true で編集ボタンの title が読み取り専用メッセージ', () => {
    render(<GridToolbar {...defaultProps} isReadOnly={true} />);
    const editButton = screen.getByRole('button', { name: /編集/ });
    expect(editButton).toHaveAttribute('title', '読み取り専用モード: 編集できません');
  });

  it('isReadOnly=false で編集ボタンが有効', () => {
    render(<GridToolbar {...defaultProps} isReadOnly={false} />);
    const editButton = screen.getByRole('button', { name: /編集/ });
    expect(editButton).not.toBeDisabled();
  });

  it('isReadOnly=false で「読取専用」バッジが非表示', () => {
    render(<GridToolbar {...defaultProps} isReadOnly={false} />);
    expect(screen.queryByText('読取専用')).not.toBeInTheDocument();
  });

  it('isReadOnly=true && isEditMode=true で編集終了ボタンが有効+正しい title', () => {
    render(<GridToolbar {...defaultProps} isReadOnly={true} isEditMode={true} />);
    const editButton = screen.getByRole('button', { name: /編集終了/ });
    expect(editButton).not.toBeDisabled();
    expect(editButton).toHaveAttribute('title', '編集モード終了');
  });

  it('isReadOnly=true && isEditMode=true で行削除・適用ボタンが disabled', () => {
    render(<GridToolbar {...defaultProps} isReadOnly={true} isEditMode={true} />);
    expect(screen.getByRole('button', { name: /行削除/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /適用/ })).toBeDisabled();
  });

  it('isReadOnly=false で編集ボタンをクリックするとコールバック発火', () => {
    const onToggle = vi.fn();
    render(<GridToolbar {...defaultProps} isReadOnly={false} onToggleEditMode={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /編集/ }));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
