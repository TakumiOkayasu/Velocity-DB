import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GridToolbar } from '../../components/grid/GridToolbar';

const defaultProps = {
  showRefresh: false,
  canEdit: true,
  hasChanges: false,
  isApplying: false,
  applyError: null,
  hasValidationErrors: false,
  showLogicalNamesInGrid: false,
  showColumnFilters: false,
  isReadOnly: false,
  viewMode: 'table' as const,
  onRefresh: vi.fn(),
  onInsertRow: vi.fn(),
  onDeleteRow: vi.fn(),
  onRevertChanges: vi.fn(),
  onApplyChanges: vi.fn(),
  onSetShowLogicalNames: vi.fn(),
  onToggleColumnFilters: vi.fn(),
  onExport: vi.fn(),
  onAutoSizeColumns: vi.fn(),
  onChangeViewMode: vi.fn(),
};

describe('GridToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('read-only mode', () => {
    it('isReadOnly=true で「読取専用」バッジを表示', () => {
      render(<GridToolbar {...defaultProps} isReadOnly={true} />);
      expect(screen.getByText('読取専用')).toBeInTheDocument();
    });

    it('isReadOnly=true で行追加・行削除ボタンが disabled', () => {
      render(<GridToolbar {...defaultProps} isReadOnly={true} />);
      const insertButton = screen.getByTitle('新しい行を追加 (Insert)');
      const deleteButton = screen.getByTitle('選択行を削除 (Delete)');
      expect(insertButton).toBeDisabled();
      expect(deleteButton).toBeDisabled();
    });

    it('isReadOnly=false で「読取専用」バッジが非表示', () => {
      render(<GridToolbar {...defaultProps} isReadOnly={false} />);
      expect(screen.queryByText('読取専用')).not.toBeInTheDocument();
    });
  });

  describe('edit buttons', () => {
    it('canEdit=true で行追加・行削除ボタンを表示', () => {
      render(<GridToolbar {...defaultProps} canEdit={true} />);
      expect(screen.getByTitle('新しい行を追加 (Insert)')).toBeInTheDocument();
      expect(screen.getByTitle('選択行を削除 (Delete)')).toBeInTheDocument();
    });

    it('canEdit=false で行追加・行削除ボタンを非表示', () => {
      render(<GridToolbar {...defaultProps} canEdit={false} />);
      expect(screen.queryByTitle('新しい行を追加 (Insert)')).not.toBeInTheDocument();
      expect(screen.queryByTitle('選択行を削除 (Delete)')).not.toBeInTheDocument();
    });
  });

  describe('change management', () => {
    it('hasChanges=true で保存・元に戻すボタンが enabled', () => {
      render(<GridToolbar {...defaultProps} hasChanges={true} />);
      expect(screen.getByTitle(/変更をデータベースに保存/)).toBeEnabled();
      expect(screen.getByTitle(/すべての変更を元に戻す/)).toBeEnabled();
      expect(screen.getByText('未保存の変更あり')).toBeInTheDocument();
    });

    it('hasChanges=false で保存・元に戻すボタンが disabled', () => {
      render(<GridToolbar {...defaultProps} hasChanges={false} />);
      expect(screen.getByTitle(/変更をデータベースに保存/)).toBeDisabled();
      expect(screen.getByTitle(/すべての変更を元に戻す/)).toBeDisabled();
      expect(screen.queryByText('未保存の変更あり')).not.toBeInTheDocument();
    });

    it('isReadOnly=true && hasChanges=true で保存ボタンが disabled', () => {
      render(<GridToolbar {...defaultProps} isReadOnly={true} hasChanges={true} />);
      const saveButton = screen.getByTitle(/変更をデータベースに保存/);
      expect(saveButton).toBeDisabled();
    });
  });

  describe('refresh button', () => {
    it('showRefresh=true で更新ボタンを表示', () => {
      render(<GridToolbar {...defaultProps} showRefresh={true} />);
      expect(screen.getByTitle('データを再取得 (F5)')).toBeInTheDocument();
    });

    it('showRefresh=false で更新ボタンを非表示', () => {
      render(<GridToolbar {...defaultProps} showRefresh={false} />);
      expect(screen.queryByTitle('データを再取得 (F5)')).not.toBeInTheDocument();
    });
  });

  describe('view options', () => {
    it('フィルタボタンを表示', () => {
      render(<GridToolbar {...defaultProps} />);
      expect(screen.getByTitle('列フィルタを表示/非表示')).toBeInTheDocument();
    });

    it('エクスポートボタンを表示', () => {
      render(<GridToolbar {...defaultProps} />);
      expect(screen.getByTitle('データをエクスポート')).toBeInTheDocument();
    });
  });

  describe('auto-size columns', () => {
    it('オートアジャストボタンをクリックで onAutoSizeColumns を呼ぶ', () => {
      const onAutoSizeColumns = vi.fn();
      render(<GridToolbar {...defaultProps} onAutoSizeColumns={onAutoSizeColumns} />);
      fireEvent.click(screen.getByTitle(/列幅をオートアジャスト/));
      expect(onAutoSizeColumns).toHaveBeenCalledTimes(1);
    });

    it('viewMode=transpose でオートアジャストボタンが disabled', () => {
      render(<GridToolbar {...defaultProps} viewMode="transpose" />);
      expect(screen.getByTitle(/列幅をオートアジャスト/)).toBeDisabled();
    });
  });

  describe('view mode toggle', () => {
    it('テーブル表示・Transpose表示ボタンを表示', () => {
      render(<GridToolbar {...defaultProps} />);
      expect(screen.getByTitle('テーブル表示')).toBeInTheDocument();
      expect(screen.getByTitle('Transpose表示')).toBeInTheDocument();
    });

    it('Transpose表示クリックで onChangeViewMode を呼び出す', () => {
      const onChangeViewMode = vi.fn();
      render(<GridToolbar {...defaultProps} onChangeViewMode={onChangeViewMode} />);
      fireEvent.click(screen.getByTitle('Transpose表示'));
      expect(onChangeViewMode).toHaveBeenCalledWith('transpose');
    });

    it('viewMode=transpose で編集ボタンが disabled', () => {
      render(<GridToolbar {...defaultProps} viewMode="transpose" />);
      expect(screen.getByTitle('新しい行を追加 (Insert)')).toBeDisabled();
      expect(screen.getByTitle('選択行を削除 (Delete)')).toBeDisabled();
    });
  });
});
