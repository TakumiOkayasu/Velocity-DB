import { useState, useCallback } from 'react'
import { bridge } from '../../api/bridge'
import { useConnectionStore } from '../../store/connectionStore'
import styles from './ExecutionPlanDialog.module.css'

interface ExecutionPlanDialogProps {
  isOpen: boolean
  onClose: () => void
  sql: string
}

interface PlanNode {
  operation: string
  cost: number
  rows: number
  actualRows?: number
  actualTime?: number
  children?: PlanNode[]
}

export function ExecutionPlanDialog({ isOpen, onClose, sql }: ExecutionPlanDialogProps) {
  const { activeConnectionId } = useConnectionStore()
  const [planText, setPlanText] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showActual, setShowActual] = useState(false)

  const fetchPlan = useCallback(async (includeActual: boolean) => {
    if (!activeConnectionId || !sql.trim()) return

    setIsLoading(true)
    setError(null)

    try {
      // SQL Server execution plan query
      const planQuery = includeActual
        ? `SET STATISTICS XML ON;\n${sql}\nSET STATISTICS XML OFF;`
        : `SET SHOWPLAN_TEXT ON;\n${sql}\nSET SHOWPLAN_TEXT OFF;`

      const result = await bridge.executeQuery(activeConnectionId, planQuery)

      if (result.rows.length > 0) {
        // Combine all plan text rows
        const plan = result.rows.map((row) => row.join(' ')).join('\n')
        setPlanText(plan)
      } else {
        setPlanText('No execution plan available')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get execution plan')
    } finally {
      setIsLoading(false)
    }
  }, [activeConnectionId, sql])

  const handleGetPlan = useCallback(() => {
    setShowActual(false)
    fetchPlan(false)
  }, [fetchPlan])

  const handleGetActualPlan = useCallback(() => {
    setShowActual(true)
    fetchPlan(true)
  }, [fetchPlan])

  if (!isOpen) return null

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Execution Plan</h2>
          <button className={styles.closeButton} onClick={onClose}>
            ×
          </button>
        </div>

        <div className={styles.toolbar}>
          <button
            onClick={handleGetPlan}
            disabled={isLoading || !activeConnectionId}
            className={!showActual ? styles.active : ''}
          >
            Estimated Plan
          </button>
          <button
            onClick={handleGetActualPlan}
            disabled={isLoading || !activeConnectionId}
            className={showActual ? styles.active : ''}
          >
            Actual Plan
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.sqlPreview}>
            <label>Query:</label>
            <pre>{sql}</pre>
          </div>

          <div className={styles.planContainer}>
            <label>Execution Plan:</label>
            {isLoading ? (
              <div className={styles.loading}>Loading execution plan...</div>
            ) : error ? (
              <div className={styles.error}>{error}</div>
            ) : planText ? (
              <pre className={styles.planText}>{planText}</pre>
            ) : (
              <div className={styles.placeholder}>
                Click "Estimated Plan" or "Actual Plan" to generate execution plan
              </div>
            )}
          </div>
        </div>

        <div className={styles.footer}>
          <span className={styles.hint}>
            Tip: Actual plan executes the query. Estimated plan does not.
          </span>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

// Helper to parse execution plan (simplified)
export function parsePlanText(text: string): PlanNode | null {
  // This is a simplified parser - real implementation would parse XML or text format
  const lines = text.split('\n').filter((l) => l.trim())
  if (lines.length === 0) return null

  const root: PlanNode = {
    operation: lines[0] || 'Unknown',
    cost: 0,
    rows: 0,
  }

  return root
}
