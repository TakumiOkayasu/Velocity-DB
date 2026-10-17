import type { Virtualizer } from '@tanstack/react-virtual';
import {
  type RefCallback,
  type RefObject,
  type UIEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useScrollPositionStore } from '../../../store/scrollPositionStore';

const MAX_RESTORE_ATTEMPTS = 30;

interface UseScrollRestoreHandlerArgs {
  targetQueryId: string | null;
  scrollerRef: RefObject<HTMLDivElement | null>;
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>;
  rowsLength: number;
}

export interface UseScrollRestoreHandlerResult {
  handleScroll: (e: UIEvent<HTMLDivElement>) => void;
  setScrollerRef: RefCallback<HTMLDivElement>;
}

/**
 * queryId とスクローラー DOM ごとに一度だけ復元し、その後のスクロールを保存する。
 * loading / 転置表示では、同じ queryId のままスクローラーが再生成される。
 * 保存抑止の遅延解除を含め、全 rAF を現在の effect の寿命に結び付ける。
 */
export function useScrollRestoreHandler({
  targetQueryId,
  scrollerRef,
  rowVirtualizer,
  rowsLength,
}: UseScrollRestoreHandlerArgs): UseScrollRestoreHandlerResult {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const restoredRef = useRef(false);
  const suppressScrollSaveRef = useRef(true);
  const setScrollerRef = useCallback(
    (element: HTMLDivElement | null) => {
      scrollerRef.current = element;
      setScroller(element);
    },
    [scrollerRef]
  );

  // ブラウザーが scroll event を配送する前に、clamp / 復元中の保存を抑止する。
  useLayoutEffect(() => {
    suppressScrollSaveRef.current = true;
    restoredRef.current = false;
  }, [targetQueryId, scroller]);

  const handleScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      if (!targetQueryId || suppressScrollSaveRef.current) return;
      const el = e.currentTarget;
      useScrollPositionStore
        .getState()
        .savePosition(targetQueryId, { top: el.scrollTop, left: el.scrollLeft });
    },
    [targetQueryId]
  );

  useLayoutEffect(() => {
    if (!targetQueryId || !scroller) return;

    let frameId: number | undefined;
    let attempts = 0;
    const releaseAfterScroll = () => {
      // 復元による scroll event が処理されてから保存を再開する。
      frameId = requestAnimationFrame(() => {
        frameId = requestAnimationFrame(() => {
          suppressScrollSaveRef.current = false;
        });
      });
    };
    const tryRestore = () => {
      if (scroller.clientHeight === 0 || rowVirtualizer.getTotalSize() === 0) {
        if (attempts++ < MAX_RESTORE_ATTEMPTS) {
          frameId = requestAnimationFrame(tryRestore);
        } else {
          suppressScrollSaveRef.current = false;
        }
        return;
      }

      const saved = useScrollPositionStore.getState().getPosition(targetQueryId);
      rowVirtualizer.scrollToOffset(saved?.top ?? 0);
      scroller.scrollLeft = saved?.left ?? 0;
      restoredRef.current = true;
      releaseAfterScroll();
    };

    if (restoredRef.current) {
      // 行追加で解除用 rAF が中断された場合は、解除だけを再開する。
      // 再復元してユーザーの現在位置から飛ばないようにする。
      if (suppressScrollSaveRef.current) releaseAfterScroll();
    } else if (rowsLength > 0) {
      frameId = requestAnimationFrame(tryRestore);
    }

    return () => {
      if (frameId !== undefined) cancelAnimationFrame(frameId);
    };
  }, [targetQueryId, scroller, rowVirtualizer, rowsLength]);

  return { handleScroll, setScrollerRef };
}
