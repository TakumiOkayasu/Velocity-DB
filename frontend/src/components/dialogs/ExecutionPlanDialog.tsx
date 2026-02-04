import { useCallback, useState } from 'react';
import { bridge } from '../../api/bridge';
import { useConnectionStore } from '../../store/connectionStore';
import styles from './ExecutionPlanDialog.module.css';

interface ExecutionPlanDialogProps {
  isOpen: boolean;
  onClose: () => void;
  sql: string;
}

export function ExecutionPlanDialog({ isOpen, onClose, sql }: ExecutionPlanDialogProps) {
  const { activeConnectionId } = useConnectionStore();
  const [planText, setPlanText] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showActual, setShowActual] = useState(false);

  const fetchPlan = useCallback(
    async (includeActual: boolean) => {
      if (!activeConnectionId || !sql.trim()) return;

      setIsLoading(true);
      setError(null);

      try {
        // SQL Server execution plan query
        const planQuery = includeActual
          ? `SET STATISTICS XML ON;\n${sql}\nSET STATISTICS XML OFF;`
          : `SET SHOWPLAN_TEXT ON;\n${sql}\nSET SHOWPLAN_TEXT OFF;`;

        const result = await bridge.executeQuery(activeConnectionId, planQuery);

        if (result.rows.length > 0) {
          // Combine all plan text rows
          const plan = result.rows.map((row) => row.join(' ')).join('\n');
          setPlanText(plan);
        } else {
          setPlanText('実行計画を取得できません');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '実行計画の取得に失敗しました');
      } finally {
        setIsLoading(false);
      }
    },
    [activeConnectionId, sql]
  );

  const handleGetPlan = useCallback(() => {
    setShowActual(false);
    fetchPlan(false);
  }, [fetchPlan]);

  const handleGetActualPlan = useCallback(() => {
    setShowActual(true);
    fetchPlan(true);
  }, [fetchPlan]);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>実行計画</h2>
          <button className={styles.closeButton} onClick={onClose}>
            {'\u2715'}
          </button>
        </div>

        <div className={styles.toolbar}>
          <button
            onClick={handleGetPlan}
            disabled={isLoading || !activeConnectionId}
            className={!showActual ? styles.active : ''}
          >
            推定プラン
          </button>
          <button
            onClick={handleGetActualPlan}
            disabled={isLoading || !activeConnectionId}
            className={showActual ? styles.active : ''}
          >
            実際のプラン
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.sqlPreview}>
            <label>クエリ:</label>
            <pre>{sql}</pre>
          </div>

          <div className={styles.planContainer}>
            <label>実行計画:</label>
            {isLoading ? (
              <div className={styles.loading}>実行計画を読み込み中...</div>
            ) : error ? (
              <div className={styles.error}>{error}</div>
            ) : planText ? (
              <pre className={styles.planText}>{planText}</pre>
            ) : (
              <div className={styles.placeholder}>
                「推定プラン」または「実際のプラン」をクリックして実行計画を生成
              </div>
            )}
          </div>
        </div>

        <div className={styles.footer}>
          <span className={styles.hint}>
            ヒント: 実際のプランはクエリを実行します。推定プランは実行しません。
          </span>
          <button onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}
