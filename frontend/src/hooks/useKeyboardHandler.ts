import { useEffect, useRef } from 'react';

// Monaco Editor が bubbling phase 到達前に stopPropagation するため、
// capture phase で先に捕捉しないと F9/Ctrl+S 等のグローバルショートカットが発火しない。
// 運用ルール: 同一キーに対して複数の useKeyboardHandler を置かないこと。
// capture phase では兄弟リスナーが順次発火し、二重実行になる (例: F9 → executeQuery が2回)。
const USE_CAPTURE = true;

/**
 * Registers a global keydown handler that always reflects the latest callback.
 * The listener is registered once on mount and never re-registered.
 * Avoids stale closures by keeping the handler in a ref.
 *
 * @param handler - The keydown event handler (can safely close over component state)
 * @param containerRef - Optional: only fires when focus is inside the container
 */
export function useKeyboardHandler(
  handler: (e: KeyboardEvent) => void,
  containerRef?: React.RefObject<HTMLElement | null>
): void {
  const handlerRef = useRef(handler);
  // Intentionally no deps: sync ref on every render to always reflect the latest handler
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (containerRef && !containerRef.current?.contains(document.activeElement)) return;
      handlerRef.current(e);
    };
    window.addEventListener('keydown', onKeyDown, USE_CAPTURE);
    return () => window.removeEventListener('keydown', onKeyDown, USE_CAPTURE);
  }, [containerRef]);
}
