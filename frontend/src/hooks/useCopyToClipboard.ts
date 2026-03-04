import { useCallback } from 'react';
import { useToastStore } from '../store/toastStore';

export function useCopyToClipboard() {
  const addToast = useToastStore((state) => state.addToast);
  return useCallback(
    async (text: string, successMessage: string) => {
      try {
        await navigator.clipboard.writeText(text);
        addToast(successMessage, 'success');
      } catch {
        addToast('コピーに失敗しました', 'error');
      }
    },
    [addToast]
  );
}
