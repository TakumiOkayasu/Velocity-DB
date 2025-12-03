import { useState } from 'react'
import { ObjectTree } from '../tree/ObjectTree'
import styles from './LeftPanel.module.css'

interface LeftPanelProps {
  width: number;
}

export function LeftPanel({ width }: LeftPanelProps) {
  const [searchFilter, setSearchFilter] = useState('')

  return (
    <div className={styles.container} style={{ width }}>
      <div className={styles.header}>
        <span>Database</span>
      </div>

      <div className={styles.searchBox}>
        <input
          type="text"
          placeholder="Search objects..."
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
        />
      </div>

      <div className={styles.treeContainer}>
        <ObjectTree filter={searchFilter} />
      </div>
    </div>
  )
}
