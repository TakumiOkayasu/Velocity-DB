import { useMemo } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { useQueryStore } from '../../store/queryStore'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import styles from './ResultGrid.module.css'

export function ResultGrid() {
  const { activeQueryId, results, isExecuting, error } = useQueryStore()

  const resultSet = activeQueryId ? results.get(activeQueryId) : null

  const columnDefs = useMemo(() => {
    if (!resultSet) return []
    return resultSet.columns.map((col) => ({
      field: col.name,
      headerName: col.name,
      sortable: true,
      filter: true,
      resizable: true,
      cellClass: (params: { value: unknown }) =>
        params.value === null ? styles.nullCell : '',
    }))
  }, [resultSet])

  const rowData = useMemo(() => {
    if (!resultSet) return []
    return resultSet.rows.map((row) => {
      const obj: Record<string, string | null> = {}
      resultSet.columns.forEach((col, idx) => {
        obj[col.name] = row[idx] || null
      })
      return obj
    })
  }, [resultSet])

  if (isExecuting) {
    return (
      <div className={styles.message}>
        <span className={styles.spinner}>⏳</span>
        <span>Executing query...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`${styles.message} ${styles.error}`}>
        <span>Error: {error}</span>
      </div>
    )
  }

  if (!resultSet) {
    return (
      <div className={styles.message}>
        <span>Execute a query to see results</span>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={`ag-theme-alpine-dark ${styles.grid}`}>
        <AgGridReact
          columnDefs={columnDefs}
          rowData={rowData}
          defaultColDef={{
            flex: 1,
            minWidth: 100,
          }}
          enableCellTextSelection={true}
          ensureDomOrder={true}
          animateRows={false}
        />
      </div>
      <div className={styles.statusBar}>
        <span>{resultSet.rows.length} rows</span>
        <span>|</span>
        <span>{resultSet.executionTimeMs.toFixed(2)} ms</span>
        {resultSet.affectedRows > 0 && (
          <>
            <span>|</span>
            <span>{resultSet.affectedRows} affected</span>
          </>
        )}
      </div>
    </div>
  )
}
