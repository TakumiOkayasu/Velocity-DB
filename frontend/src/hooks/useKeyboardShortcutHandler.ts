import { useKeyboardHandler } from './useKeyboardHandler';

export interface KeyboardShortcutCallbacks {
  onNewQuery: () => void;
  onCloseTab: () => void;
  onExecute: () => void;
  onFormat: () => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onCancel: () => void;
}

export interface UseKeyboardShortcutHandlerParams extends KeyboardShortcutCallbacks {
  isExecuting: boolean;
  hasOpenDialog: boolean;
}

/**
 * MainLayout レベルのアプリケーションショートカット束を window keydown に bind する操作層 hook。
 * 内部で useKeyboardHandler (capture phase + ref-based) を 1 個だけ呼び、
 * Monaco Editor の stopPropagation を貫通させる。
 *
 * 運用ルール: 同一キーへの listener 二重登録を避けるため、本 hook を MainLayout 以外で呼ばない。
 * 詳細は useKeyboardHandler.ts L3-6 (Monaco stopPropagation 貫通のための capture phase 仕様) 参照。
 */
export function useKeyboardShortcutHandler(params: UseKeyboardShortcutHandlerParams): void {
  useKeyboardHandler((e: KeyboardEvent) => {
    if (e.key === 'F5') {
      e.preventDefault();
      return;
    }

    if (e.ctrlKey && e.key === 'n') {
      e.preventDefault();
      params.onNewQuery();
    } else if (e.ctrlKey && e.key === 'w') {
      e.preventDefault();
      params.onCloseTab();
    } else if (e.key === 'F9' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      // F9 単独のみ実行トリガ。Ctrl/Shift/Alt+F9 は将来の拡張用に予約
      e.preventDefault();
      params.onExecute();
    } else if (e.ctrlKey && e.shiftKey && e.key === 'F') {
      e.preventDefault();
      params.onFormat();
    } else if (e.ctrlKey && e.shiftKey && e.key === 'P') {
      e.preventDefault();
      params.onOpenSearch();
    } else if (e.ctrlKey && e.key === ',') {
      e.preventDefault();
      params.onOpenSettings();
    } else if (e.key === 'Escape' && params.isExecuting && !params.hasOpenDialog) {
      e.preventDefault();
      params.onCancel();
    }
  });
}
