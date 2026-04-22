import { type MouseEvent, memo, type TouchEvent, useCallback } from 'react';
import styles from './ResultGrid.module.css';

interface ColumnResizerProps {
  columnId: string;
  /** TanStack header.getResizeHandler() の戻り値 (drag resize 起動) */
  onResizeStart: (e: MouseEvent | TouchEvent) => void;
  /** ヘッダー境界ダブルクリック時の列オートアジャスト (Issue #387) */
  onAutoSizeColumn?: (columnId: string) => void;
}

function ColumnResizerInner({ columnId, onResizeStart, onAutoSizeColumn }: ColumnResizerProps) {
  // 列ヘッダー onClick (列選択) への伝播を止める: resizer 領域クリックは選択操作と衝突しない
  const stopClick = useCallback((e: MouseEvent) => e.stopPropagation(), []);

  const handleDoubleClick = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      onAutoSizeColumn?.(columnId);
    },
    [columnId, onAutoSizeColumn]
  );

  return (
    <div
      className={styles.columnResizer}
      onMouseDown={onResizeStart}
      onTouchStart={onResizeStart}
      onClick={stopClick}
      onDoubleClick={handleDoubleClick}
    />
  );
}

export const ColumnResizer = memo(ColumnResizerInner);
