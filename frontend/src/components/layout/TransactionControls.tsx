import { useEffect, useState } from 'react';
import { transactionProvider } from '../../api/providers';
import { useToastStore } from '../../store/toastStore';
import { getSettings, SETTINGS_CHANGED_EVENT } from '../../utils/settingsUtils';
import styles from './MainLayout.module.css';

export function TransactionControls({ connectionId }: { connectionId: string | null }) {
  const [snapshot, setState] = useState({ connectionId, active: false, busy: false });
  const state = snapshot.connectionId === connectionId ? snapshot : { active: false, busy: false };
  const [autoCommit, setAutoCommit] = useState(() => getSettings().query.autoCommit);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let disposed = false;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      const current = ++generation;
      clearTimeout(timer);
      setAutoCommit(getSettings().query.autoCommit);
      if (!connectionId) return;
      try {
        const next = await transactionProvider.getTransactionState(connectionId);
        if (disposed || current !== generation) return;
        setState({ connectionId, ...next });
        if (next.busy) timer = setTimeout(() => void refresh(), 250);
      } catch {
        if (!disposed && current === generation)
          setState({ connectionId, active: false, busy: false });
      }
    };
    const changed = () => void refresh();
    changed();
    window.addEventListener('query-state-changed', changed);
    window.addEventListener(SETTINGS_CHANGED_EVENT, changed);
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener('query-state-changed', changed);
      window.removeEventListener(SETTINGS_CHANGED_EVENT, changed);
    };
  }, [connectionId, revision]);

  const finish = async (commit: boolean) => {
    if (!connectionId || saving || state.busy || !state.active) return;
    setSaving(true);
    try {
      await (commit
        ? transactionProvider.commit(connectionId)
        : transactionProvider.rollback(connectionId));
      useToastStore
        .getState()
        .addToast(
          commit ? 'コミットしました' : 'ロールバックしました。表示中の結果は再取得してください。',
          'success'
        );
    } catch (error) {
      useToastStore
        .getState()
        .addToast(
          error instanceof Error ? error.message : 'トランザクション操作に失敗しました',
          'error'
        );
    } finally {
      setSaving(false);
      setRevision((value) => value + 1);
    }
  };

  if (!connectionId || (autoCommit && !state.active)) return null;
  return (
    <div className={styles.toolbarGroup}>
      <span>{state.active ? '未コミット' : '手動コミット'}</span>
      <button
        type="button"
        disabled={!state.active || state.busy || saving}
        onClick={() => void finish(true)}
      >
        Commit
      </button>
      <button
        type="button"
        disabled={!state.active || state.busy || saving}
        onClick={() => void finish(false)}
      >
        Rollback
      </button>
    </div>
  );
}
