import type { useVirtualizer } from '@tanstack/react-virtual';
import { type RefObject, type UIEvent, useCallback, useEffect, useRef } from 'react';
import { useScrollPositionStore } from '../../../store/scrollPositionStore';

/**
 * Tab 切替時の grid scroll 位置保存/復元 (操作層).
 *
 * - onScroll で現在の queryId に top/left を常時保存 (closure 経由で旧 queryId 汚染を防止)
 * - queryId 切替の過渡期 (programmatic scroll や clamp-scroll) は suppress フラグで保存抑止
 * - rows 描画後に rAF ループで container サイズが整うのを待ってから 1 回だけ復元
 * - unmount (tab 非表示化) 時は最後の queryId に対して最終保存
 *
 * 背景 (#366, scrollPersistence test 参照):
 *   useEffect cleanup での保存方式は ref=null や誤 queryId 問題を起こすため
 *   onScroll closure による保存方式に統一されている。
 */
const MAX_RESTORE_ATTEMPTS = 30;

interface UseScrollRestoreHandlerArgs {
  targetQueryId: string | null;
  scrollerRef: RefObject<HTMLDivElement | null>;
  rowVirtualizer: ReturnType<typeof useVirtualizer>;
  rowsLength: number;
}

export interface UseScrollRestoreHandlerResult {
  handleScroll: (e: UIEvent<HTMLDivElement>) => void;
}

export function useScrollRestoreHandler({
  targetQueryId,
  scrollerRef,
  rowVirtualizer,
  rowsLength,
}: UseScrollRestoreHandlerArgs): UseScrollRestoreHandlerResult {
  const prevQueryIdRef = useRef<string | null>(null);
  const scrollRestoredForQueryRef = useRef<string | null>(null);
  // 過渡期 (queryId 変化 → 復元完了まで) の scroll event を抑止するフラグ。
  // programmatic scroll や DOM height 変化による clamp-scroll が新 queryId の
  // store に旧値を書き込むのを防ぐ。
  const suppressScrollSaveRef = useRef(false);

  // 1. queryId 切替: 過渡期抑止 ON + 復元 1-shot フラグ初期化
  useEffect(() => {
    suppressScrollSaveRef.current = true;
    prevQueryIdRef.current = targetQueryId;
    scrollRestoredForQueryRef.current = null;
  }, [targetQueryId]);

  // 2. onScroll: 現在の targetQueryId に紐付け保存 (closure)
  const handleScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      if (!targetQueryId) return;
      if (suppressScrollSaveRef.current) return;
      const el = e.currentTarget;
      useScrollPositionStore
        .getState()
        .savePosition(targetQueryId, { top: el.scrollTop, left: el.scrollLeft });
    },
    [targetQueryId]
  );

  // 3. 復元: rows 描画 + container 実サイズ確定後に rAF ループで 1 回だけ実施
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll restore is a one-shot per queryId
  useEffect(() => {
    if (!targetQueryId) return;
    if (scrollRestoredForQueryRef.current === targetQueryId) return;
    if (rowsLength === 0) return;

    let cancelled = false;
    let attempts = 0;

    const tryRestore = () => {
      if (cancelled) return;
      if (scrollRestoredForQueryRef.current === targetQueryId) return;

      const el = scrollerRef.current;
      if (!el || el.clientHeight === 0) {
        if (attempts++ < MAX_RESTORE_ATTEMPTS) {
          requestAnimationFrame(tryRestore);
        } else {
          // 限界超過 — 復元諦めて抑止解除 (user scroll 保存を許可)
          suppressScrollSaveRef.current = false;
        }
        return;
      }

      rowVirtualizer.measure();
      const totalSize = rowVirtualizer.getTotalSize();
      if (totalSize === 0) {
        if (attempts++ < MAX_RESTORE_ATTEMPTS) {
          requestAnimationFrame(tryRestore);
        } else {
          suppressScrollSaveRef.current = false;
        }
        return;
      }

      const saved = useScrollPositionStore.getState().getPosition(targetQueryId);
      if (saved) {
        rowVirtualizer.scrollToOffset(saved.top);
        el.scrollLeft = saved.left;
      }
      scrollRestoredForQueryRef.current = targetQueryId;
      // 復元 programmatic scroll 完了後に抑止解除。scroll event は同期発火または
      // 次 microtask で発火するため rAF 2 回待ち (1 回目: event 発火、2 回目: 解除)。
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          suppressScrollSaveRef.current = false;
        });
      });
    };

    requestAnimationFrame(tryRestore);
    return () => {
      cancelled = true;
    };
  }, [targetQueryId, rowsLength]);

  // 4. unmount (tab が grid 以外に切替) 時に最終保存
  useEffect(() => {
    return () => {
      const el = scrollerRef.current;
      const qid = prevQueryIdRef.current;
      if (qid && el) {
        useScrollPositionStore
          .getState()
          .savePosition(qid, { top: el.scrollTop, left: el.scrollLeft });
      }
    };
  }, [scrollerRef]);

  return { handleScroll };
}
