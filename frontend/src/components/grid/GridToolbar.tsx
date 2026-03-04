import { memo } from 'react';
import styles from './ResultGrid.module.css';

interface GridToolbarProps {
  showRefresh: boolean;
  isEditMode: boolean;
  hasChanges: boolean;
  isApplying: boolean;
  applyError: string | null;
  showLogicalNamesInGrid: boolean;
  showColumnFilters: boolean;
  isReadOnly: boolean;
  onRefresh: () => void;
  onToggleEditMode: () => void;
  onDeleteRow: () => void;
  onRevertChanges: () => void;
  onApplyChanges: () => void;
  onSetShowLogicalNames: (value: boolean) => void;
  onToggleColumnFilters: () => void;
  onExport: () => void;
}

function GridToolbarInner({
  showRefresh,
  isEditMode,
  hasChanges,
  isApplying,
  applyError,
  showLogicalNamesInGrid,
  showColumnFilters,
  isReadOnly,
  onRefresh,
  onToggleEditMode,
  onDeleteRow,
  onRevertChanges,
  onApplyChanges,
  onSetShowLogicalNames,
  onToggleColumnFilters,
  onExport,
}: GridToolbarProps) {
  return (
    <div className={styles.toolbar}>
      {showRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          className={styles.toolbarButton}
          title="データを再取得 (F5)"
        >
          更新
        </button>
      )}
      <button
        type="button"
        onClick={onToggleEditMode}
        className={`${styles.toolbarButton} ${isEditMode ? styles.active : ''}`}
        disabled={isReadOnly && !isEditMode}
        title={
          isReadOnly && !isEditMode
            ? '読み取り専用モード: 編集できません'
            : isEditMode
              ? '編集モード終了'
              : '編集モード開始'
        }
      >
        {isEditMode ? '編集終了' : '編集'}
      </button>
      {isReadOnly && <span className={styles.readOnlyBadge}>読取専用</span>}
      {isEditMode && (
        <>
          <button
            type="button"
            onClick={onDeleteRow}
            className={styles.toolbarButton}
            disabled={isReadOnly}
            title={isReadOnly ? '読み取り専用モード: 変更できません' : '選択行を削除（削除マーク）'}
          >
            行削除
          </button>
          <button
            type="button"
            onClick={onRevertChanges}
            className={styles.toolbarButton}
            disabled={!hasChanges}
            title="すべての変更を元に戻す"
          >
            元に戻す
          </button>
          <button
            type="button"
            onClick={onApplyChanges}
            className={`${styles.toolbarButton} ${styles.applyButton}`}
            disabled={isReadOnly || !hasChanges || isApplying}
            title={isReadOnly ? '読み取り専用モード: 変更できません' : '変更をデータベースに適用'}
          >
            {isApplying ? '適用中...' : '適用'}
          </button>
        </>
      )}
      {hasChanges && <span className={styles.changesIndicator}>未保存の変更あり</span>}
      {applyError && <span className={styles.errorIndicator}>{applyError}</span>}
      <div className={styles.toolbarSpacer} />
      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          checked={showLogicalNamesInGrid}
          onChange={(e) => onSetShowLogicalNames(e.target.checked)}
        />
        <span>論理名で表示</span>
      </label>
      <button
        type="button"
        onClick={onToggleColumnFilters}
        className={`${styles.toolbarButton} ${showColumnFilters ? styles.active : ''}`}
        title="列フィルタを表示/非表示"
      >
        フィルタ
      </button>
      <button
        type="button"
        onClick={onExport}
        className={styles.toolbarButton}
        title="データをエクスポート"
      >
        エクスポート
      </button>
    </div>
  );
}

export const GridToolbar = memo(GridToolbarInner);
