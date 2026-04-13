import { useEffect } from 'react';

/**
 * INPUT/TEXTAREA/contenteditable 以外にフォーカスがある時の Ctrl+A を抑止する。
 * WebView2 既定のページ全選択がツリーや空白領域で誤発火するのを防ぐ。
 */
export function useSuppressNativeSelectAll(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      if (e.key !== 'a' && e.key !== 'A') return;
      const target = document.activeElement as HTMLElement | null;
      if (!target) {
        e.preventDefault();
        return;
      }
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (target.isContentEditable) return;
      e.preventDefault();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
