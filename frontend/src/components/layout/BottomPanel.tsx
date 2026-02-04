import { lazy, Suspense, useState } from 'react';
import styles from './BottomPanel.module.css';

// Lazy load heavy components (TanStack Table)
const ResultGrid = lazy(() =>
  import('../grid/ResultGrid').then((module) => ({ default: module.ResultGrid }))
);
const QueryHistory = lazy(() =>
  import('../history/QueryHistory').then((module) => ({ default: module.QueryHistory }))
);

interface BottomPanelProps {
  height: number;
  onClose: () => void;
}

type TabType = 'results' | 'history';

// Simple loading fallback
function LoadingFallback() {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}
    >
      <div style={{ color: '#808080', fontSize: '13px' }}>読み込み中...</div>
    </div>
  );
}

export function BottomPanel({ height, onClose }: BottomPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>('results');

  return (
    <div className={styles.container} style={{ height }}>
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === 'results' ? styles.active : ''}`}
          onClick={() => setActiveTab('results')}
        >
          結果
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'history' ? styles.active : ''}`}
          onClick={() => setActiveTab('history')}
        >
          履歴
        </button>
        <div className={styles.tabSpacer} />
        <button className={styles.closeButton} onClick={onClose} title="パネルを閉じる">
          {'\u00D7'}
        </button>
      </div>

      <div className={styles.content}>
        <Suspense fallback={<LoadingFallback />}>
          {activeTab === 'results' && <ResultGrid excludeDataView={true} />}
          {activeTab === 'history' && <QueryHistory />}
        </Suspense>
      </div>
    </div>
  );
}
