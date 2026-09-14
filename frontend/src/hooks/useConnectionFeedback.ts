import { useCallback, useState } from 'react';
import type { ConnectionResult } from '../store/connectionStore';
import { useToastStore } from '../store/toastStore';

export function useConnectionFeedback() {
  const [error, setError] = useState<string | null>(null);
  const dismissError = useCallback(() => setError(null), []);
  const reportError = useCallback((failure: unknown) => {
    setError(failure instanceof Error ? failure.message : String(failure));
  }, []);
  const reportResult = useCallback((result: ConnectionResult) => {
    if (result.status === 'failed') {
      setError(result.error);
    } else {
      useToastStore.getState().addToast(
        result.status === 'connected' ? '接続できました' : '接続を中止しました',
        result.status === 'connected' ? 'success' : 'info'
      );
    }
  }, []);
  return { error, dismissError, reportError, reportResult };
}
