import { memo } from 'react';
import type { GridViewMode } from '../../types/grid';
import styles from './ResultGrid.module.css';

interface GridToolbarProps {
  showRefresh: boolean;
  canEdit: boolean;
  hasChanges: boolean;
  isApplying: boolean;
  applyError: string | null;
  hasValidationErrors: boolean;
  showLogicalNamesInGrid: boolean;
  showColumnFilters: boolean;
  isReadOnly: boolean;
  viewMode: GridViewMode;
  onRefresh: () => void;
  onInsertRow: () => void;
  onDeleteRow: () => void;
  onRevertChanges: () => void;
  onApplyChanges: () => void;
  onSetShowLogicalNames: (value: boolean) => void;
  onToggleColumnFilters: () => void;
  onExport: () => void;
  onAutoSizeColumns: () => void;
  onChangeViewMode: (mode: GridViewMode) => void;
}

function GridToolbarInner({
  showRefresh,
  canEdit,
  hasChanges,
  isApplying,
  applyError,
  hasValidationErrors,
  showLogicalNamesInGrid,
  showColumnFilters,
  isReadOnly,
  viewMode,
  onRefresh,
  onInsertRow,
  onDeleteRow,
  onRevertChanges,
  onApplyChanges,
  onSetShowLogicalNames,
  onToggleColumnFilters,
  onExport,
  onAutoSizeColumns,
  onChangeViewMode,
}: GridToolbarProps) {
  const isTableMode = viewMode === 'table';
  const editDisabled = !isTableMode;
  return (
    <div className={styles.toolbar}>
      {/* Group 1: Data operations */}
      {showRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          className={styles.iconButton}
          title="データを再取得 (F5)"
        >
          ↻
        </button>
      )}
      {canEdit && (
        <>
          <button
            type="button"
            onClick={onInsertRow}
            className={styles.iconButton}
            disabled={isReadOnly || editDisabled}
            title="新しい行を追加 (Insert)"
          >
            +
          </button>
          <button
            type="button"
            onClick={onDeleteRow}
            className={styles.iconButton}
            disabled={isReadOnly || editDisabled}
            title="選択行を削除 (Delete)"
          >
            🗑
          </button>
        </>
      )}

      {/* Separator */}
      {canEdit && <span className={styles.toolbarSeparator} />}

      {/* Group 2: Change management (always visible when editable, disabled when no changes) */}
      {canEdit && (
        <>
          <button
            type="button"
            onClick={onRevertChanges}
            className={styles.iconButton}
            disabled={!hasChanges || isApplying || editDisabled}
            title="すべての変更を元に戻す (Ctrl+Z)"
          >
            ↩
          </button>
          <button
            type="button"
            onClick={onApplyChanges}
            className={`${styles.iconButton} ${styles.saveButton}`}
            disabled={
              isReadOnly || !hasChanges || isApplying || editDisabled || hasValidationErrors
            }
            title="変更をデータベースに保存 (Ctrl+S)"
          >
            {isApplying ? <span className={styles.applyingSpinner}>↻</span> : '💾'}
          </button>
        </>
      )}

      {/* Status indicators */}
      {hasChanges && <span className={styles.changesIndicator}>未保存の変更あり</span>}
      {isReadOnly && <span className={styles.readOnlyBadge}>読取専用</span>}
      {applyError && <span className={styles.errorIndicator}>{applyError}</span>}

      <div className={styles.toolbarSpacer} />

      {/* Group 3: View options */}
      <button
        type="button"
        onClick={() => onChangeViewMode('table')}
        className={`${styles.iconButton} ${isTableMode ? styles.active : ''}`}
        title="テーブル表示"
      >
        ☰
      </button>
      <button
        type="button"
        onClick={() => onChangeViewMode('transpose')}
        className={`${styles.iconButton} ${!isTableMode ? styles.active : ''}`}
        title="Transpose表示"
      >
        ⊤
      </button>

      <span className={styles.toolbarSeparator} />

      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          checked={showLogicalNamesInGrid}
          onChange={(e) => onSetShowLogicalNames(e.target.checked)}
        />
        <span>論理名</span>
      </label>

      <span className={styles.toolbarSeparator} />

      <button
        type="button"
        onClick={onToggleColumnFilters}
        className={`${styles.iconButton} ${showColumnFilters ? styles.active : ''}`}
        title="列フィルタを表示/非表示"
      >
        ≡
      </button>
      <button
        type="button"
        onClick={onAutoSizeColumns}
        className={styles.iconButton}
        disabled={!isTableMode}
        title="列幅をオートアジャスト (Ctrl+Shift+A)"
      >
        ↔
      </button>
      <button
        type="button"
        onClick={onExport}
        className={styles.iconButton}
        title="データをエクスポート"
      >
        📤
      </button>
    </div>
  );
}

export const GridToolbar = memo(GridToolbarInner);
