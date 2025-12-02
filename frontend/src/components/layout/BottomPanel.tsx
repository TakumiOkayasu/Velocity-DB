import { useState } from 'react'
import { ResultGrid } from '../grid/ResultGrid'
import { QueryHistory } from '../history/QueryHistory'
import styles from './BottomPanel.module.css'

interface BottomPanelProps {
  height: number;
}

type TabType = 'results' | 'history'

export function BottomPanel({ height }: BottomPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>('results')

  return (
    <div className={styles.container} style={{ height }}>
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === 'results' ? styles.active : ''}`}
          onClick={() => setActiveTab('results')}
        >
          Results
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'history' ? styles.active : ''}`}
          onClick={() => setActiveTab('history')}
        >
          History
        </button>
      </div>

      <div className={styles.content}>
        {activeTab === 'results' && <ResultGrid />}
        {activeTab === 'history' && <QueryHistory />}
      </div>
    </div>
  )
}
