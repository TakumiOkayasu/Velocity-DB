import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { computeWindowRange, type WindowRange } from '../../utils/computeWindowRange';
import type { FlattenedTreeRow } from '../../utils/flattenVisibleTree';
import styles from './VirtualTreeList.module.css';

/**
 * TreeNode 1 行分の高さ (px)。TreeNode.module.css の .node
 * (padding 5px×2 + アイコン 18px = 28px) + 上下 margin 1px×2 に一致させる。
 */
export const TREE_ROW_HEIGHT = 30;

const DEFAULT_OVERSCAN = 10;

/** スクロール親もウィンドウ高さも取得できない場合のビューポート高さの見積もり (px) */
const FALLBACK_VIEWPORT_HEIGHT = 800;

interface VirtualTreeListProps {
  rows: FlattenedTreeRow[];
  renderRow: (row: FlattenedTreeRow) => ReactNode;
  rowHeight?: number;
  overscan?: number;
}

/** 最も近い縦スクロール可能な祖先要素を返す (なければ null = window スクロール扱い) */
function findScrollParent(el: HTMLElement): HTMLElement | null {
  let current = el.parentElement;
  while (current) {
    const { overflowY } = getComputedStyle(current);
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * スキーマツリー用の手作りウィンドウイングリスト (#502)。
 *
 * 全行の合計高さを持つスペーサー div の中に、可視範囲 (+overscan) の行だけを
 * absolute 配置で描画する。スクロールコンテナは自身ではなく最も近いスクロール可能な
 * 祖先 (ObjectTree のコンテナ) なので、祖先の scroll イベントを rAF スロットルで購読し、
 * 自身との相対位置から描画範囲を再計算する。
 * スクロール親が見つからないレイアウト (テストや将来のレイアウト変更) でも、
 * window スクロール + ビューポート高さの見積もりで先頭から描画されるため表示は壊れない。
 */
export function VirtualTreeList({
  rows,
  renderRow,
  rowHeight = TREE_ROW_HEIGHT,
  overscan = DEFAULT_OVERSCAN,
}: VirtualTreeListProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollParentRef = useRef<HTMLElement | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const [range, setRange] = useState<WindowRange>(() =>
    computeWindowRange(0, FALLBACK_VIEWPORT_HEIGHT, rowHeight, rows.length, overscan)
  );

  const rowCount = rows.length;

  const syncRange = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const scrollParent = scrollParentRef.current;
    const containerTop = container.getBoundingClientRect().top;
    let scrollTop: number;
    let viewportHeight: number;
    if (scrollParent) {
      scrollTop = scrollParent.getBoundingClientRect().top - containerTop;
      viewportHeight = scrollParent.clientHeight || FALLBACK_VIEWPORT_HEIGHT;
    } else {
      scrollTop = -containerTop;
      viewportHeight = window.innerHeight || FALLBACK_VIEWPORT_HEIGHT;
    }

    const next = computeWindowRange(scrollTop, viewportHeight, rowHeight, rowCount, overscan);
    setRange((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, [rowHeight, rowCount, overscan]);

  const scheduleSync = useCallback(() => {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      syncRange();
    });
  }, [syncRange]);

  // スクロール親の特定とイベント購読 (mount 時)、および行数変化時の範囲再計算
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    scrollParentRef.current = findScrollParent(container);
    const target: HTMLElement | Window = scrollParentRef.current ?? window;
    target.addEventListener('scroll', scheduleSync, { passive: true });
    window.addEventListener('resize', scheduleSync);
    syncRange();

    return () => {
      target.removeEventListener('scroll', scheduleSync);
      window.removeEventListener('resize', scheduleSync);
    };
  }, [scheduleSync, syncRange]);

  // unmount 時に保留中の rAF を破棄
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  const start = Math.min(range.start, rowCount);
  const end = Math.min(range.end, rowCount);
  const visibleRows = rows.slice(start, end);

  return (
    <div
      ref={containerRef}
      className={styles.list}
      style={{ height: rowCount * rowHeight }}
      role="tree"
    >
      {visibleRows.map((row, i) => (
        <div
          key={row.node.id}
          className={styles.row}
          style={{ top: (start + i) * rowHeight, height: rowHeight }}
        >
          {renderRow(row)}
        </div>
      ))}
    </div>
  );
}
