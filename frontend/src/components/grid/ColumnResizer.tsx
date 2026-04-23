import { type MouseEvent, memo, useCallback } from 'react';
import styles from './ResultGrid.module.css';

interface ColumnResizerProps {
  columnId: string;
  /** 現在の列幅 (px) — drag 開始時の基準値として使用 */
  currentWidth: number;
  /** 列幅下限 (default 40) */
  minWidth?: number;
  /** 列幅上限 (default 1000) */
  maxWidth?: number;
  /** drag 完了 (mouseup) 時に呼ばれる。新しい列幅を 1 回だけ通知。 */
  onResizeCommit: (columnId: string, newWidth: number) => void;
  /** ヘッダー境界ダブルクリック時の列オートアジャスト (Issue #387) */
  onAutoSizeColumn?: (columnId: string) => void;
}

const DEFAULT_MIN_WIDTH = 40;
const DEFAULT_MAX_WIDTH = 1000;
const INDICATOR_OPACITY = 0.6;
const INDICATOR_COLOR = `rgba(0, 122, 204, ${INDICATOR_OPACITY})`;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function ColumnResizerInner({
  columnId,
  currentWidth,
  minWidth = DEFAULT_MIN_WIDTH,
  maxWidth = DEFAULT_MAX_WIDTH,
  onResizeCommit,
  onAutoSizeColumn,
}: ColumnResizerProps) {
  const stopClick = useCallback((e: MouseEvent) => e.stopPropagation(), []);

  const handleDoubleClick = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      onAutoSizeColumn?.(columnId);
    },
    [columnId, onAutoSizeColumn]
  );

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      // 列ヘッダー onClick (列選択) への伝播を止める
      e.stopPropagation();
      e.preventDefault();

      const startX = e.clientX;
      const resizerRect = (e.currentTarget as HTMLElement).getBoundingClientRect();

      // Overlay 縦線 indicator (DOM 直挿入、React 経由しない最軽量パス)
      const indicator = document.createElement('div');
      indicator.style.position = 'fixed';
      indicator.style.top = '0';
      indicator.style.left = `${resizerRect.left + resizerRect.width / 2}px`;
      indicator.style.width = '2px';
      indicator.style.height = '100vh';
      indicator.style.background = INDICATOR_COLOR;
      indicator.style.pointerEvents = 'none';
      indicator.style.zIndex = '9999';
      indicator.style.willChange = 'transform';
      document.body.appendChild(indicator);

      let pendingDx = 0;
      let rafId: number | null = null;

      const onMove = (ev: globalThis.MouseEvent) => {
        pendingDx = ev.clientX - startX;
        if (rafId !== null) return;
        rafId = requestAnimationFrame(() => {
          indicator.style.transform = `translateX(${pendingDx}px)`;
          rafId = null;
        });
      };

      const onUp = () => {
        if (rafId !== null) cancelAnimationFrame(rafId);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (indicator.parentNode) indicator.parentNode.removeChild(indicator);
        const newWidth = clamp(currentWidth + pendingDx, minWidth, maxWidth);
        if (newWidth !== currentWidth) onResizeCommit(columnId, newWidth);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [columnId, currentWidth, minWidth, maxWidth, onResizeCommit]
  );

  return (
    <div
      className={styles.columnResizer}
      onMouseDown={handleMouseDown}
      onClick={stopClick}
      onDoubleClick={handleDoubleClick}
    />
  );
}

export const ColumnResizer = memo(ColumnResizerInner);
