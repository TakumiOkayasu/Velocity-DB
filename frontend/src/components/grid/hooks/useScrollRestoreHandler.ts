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
 * Restore once per query/scroller lifetime; save subsequent user scroll events.
 * Loading and transpose views can replace the scroller without changing the query.
 * Every scheduled frame belongs to the current effect, including delayed release.
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

  // Suppress clamp/programmatic scroll before the browser can dispatch events.
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
      // Allow queued programmatic scroll events to finish before saving again.
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
      // Row appends can interrupt the release frames. Finish releasing without
      // restoring again and jumping away from the user's current position.
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
