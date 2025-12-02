import { useState, useEffect, useCallback } from 'react'
import { LeftPanel } from './LeftPanel'
import { CenterPanel } from './CenterPanel'
import { BottomPanel } from './BottomPanel'
import { ConnectionDialog, type ConnectionConfig } from '../dialogs/ConnectionDialog'
import { useConnectionStore } from '../../store/connectionStore'
import { useQueryStore } from '../../store/queryStore'
import styles from './MainLayout.module.css'

export function MainLayout() {
  const [leftPanelWidth, setLeftPanelWidth] = useState(250)
  const [bottomPanelHeight, setBottomPanelHeight] = useState(200)
  const [isLeftPanelVisible, setIsLeftPanelVisible] = useState(true)
  const [isBottomPanelVisible, setIsBottomPanelVisible] = useState(true)
  const [isConnectionDialogOpen, setIsConnectionDialogOpen] = useState(false)

  const { connections, activeConnectionId, addConnection } = useConnectionStore()
  const { queries, activeQueryId, addQuery, executeQuery, formatQuery, isExecuting } = useQueryStore()
  const activeConnection = connections.find(c => c.id === activeConnectionId)
  const activeQuery = queries.find(q => q.id === activeQueryId)

  const handleConnect = async (config: ConnectionConfig) => {
    try {
      await addConnection({
        name: config.name,
        server: config.server,
        database: config.database,
        username: config.username,
        password: config.password,
        useWindowsAuth: config.useWindowsAuth,
      })
    } catch (error) {
      console.error('Connection failed:', error)
    }
  }

  const handleNewQuery = useCallback(() => {
    addQuery(activeConnectionId)
  }, [addQuery, activeConnectionId])

  const handleExecute = useCallback(() => {
    if (activeQueryId && activeConnectionId) {
      executeQuery(activeQueryId, activeConnectionId)
    }
  }, [activeQueryId, activeConnectionId, executeQuery])

  const handleFormat = useCallback(() => {
    if (activeQueryId) {
      formatQuery(activeQueryId)
    }
  }, [activeQueryId, formatQuery])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault()
        handleNewQuery()
      } else if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault()
        handleExecute()
      } else if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault()
        handleFormat()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleNewQuery, handleExecute, handleFormat])

  return (
    <div className={styles.container}>
      <header className={styles.toolbar}>
        <div className={styles.toolbarGroup}>
          <button
            onClick={() => setIsConnectionDialogOpen(true)}
            title="New Connection"
          >
            + Connect
          </button>
        </div>
        <div className={styles.toolbarGroup}>
          <button onClick={handleNewQuery} title="New Query (Ctrl+N)">New</button>
        </div>
        <div className={styles.toolbarGroup}>
          <button
            onClick={handleExecute}
            disabled={!activeQueryId || !activeConnectionId || isExecuting}
            title="Execute (Ctrl+Enter)"
            className={styles.executeButton}
          >
            {isExecuting ? '⏳' : '▶'} Execute
          </button>
        </div>
        <div className={styles.toolbarGroup}>
          <button
            onClick={handleFormat}
            disabled={!activeQuery?.content}
            title="Format SQL (Ctrl+Shift+F)"
          >
            Format
          </button>
        </div>
        <div className={styles.toolbarGroup}>
          <button
            onClick={() => setIsLeftPanelVisible(!isLeftPanelVisible)}
            title="Toggle Object Explorer"
          >
            {isLeftPanelVisible ? '◀' : '▶'} Objects
          </button>
          <button
            onClick={() => setIsBottomPanelVisible(!isBottomPanelVisible)}
            title="Toggle Results Panel"
          >
            {isBottomPanelVisible ? '▼' : '▲'} Results
          </button>
        </div>
      </header>

      <div className={styles.mainContent}>
        {isLeftPanelVisible && (
          <>
            <LeftPanel width={leftPanelWidth} />
            <div
              className={styles.verticalResizer}
              onMouseDown={(e) => {
                const startX = e.clientX
                const startWidth = leftPanelWidth

                const onMouseMove = (moveEvent: MouseEvent) => {
                  const newWidth = startWidth + (moveEvent.clientX - startX)
                  setLeftPanelWidth(Math.max(150, Math.min(500, newWidth)))
                }

                const onMouseUp = () => {
                  document.removeEventListener('mousemove', onMouseMove)
                  document.removeEventListener('mouseup', onMouseUp)
                }

                document.addEventListener('mousemove', onMouseMove)
                document.addEventListener('mouseup', onMouseUp)
              }}
            />
          </>
        )}

        <div className={styles.rightSection}>
          <CenterPanel />

          {isBottomPanelVisible && (
            <>
              <div
                className={styles.horizontalResizer}
                onMouseDown={(e) => {
                  const startY = e.clientY
                  const startHeight = bottomPanelHeight

                  const onMouseMove = (moveEvent: MouseEvent) => {
                    const newHeight = startHeight - (moveEvent.clientY - startY)
                    setBottomPanelHeight(Math.max(100, Math.min(500, newHeight)))
                  }

                  const onMouseUp = () => {
                    document.removeEventListener('mousemove', onMouseMove)
                    document.removeEventListener('mouseup', onMouseUp)
                  }

                  document.addEventListener('mousemove', onMouseMove)
                  document.addEventListener('mouseup', onMouseUp)
                }}
              />
              <BottomPanel height={bottomPanelHeight} />
            </>
          )}
        </div>
      </div>

      <footer className={styles.statusBar}>
        <div className={styles.statusLeft}>
          <span className={isExecuting ? styles.statusExecuting : styles.statusReady}>
            {isExecuting ? 'Executing...' : 'Ready'}
          </span>
        </div>
        <div className={styles.statusCenter}>
          {activeQuery && <span>Query: {activeQuery.name}</span>}
        </div>
        <div className={styles.statusRight}>
          <span className={activeConnection ? styles.connected : styles.disconnected}>
            {activeConnection ? `${activeConnection.server}/${activeConnection.database}` : 'Not connected'}
          </span>
        </div>
      </footer>

      <ConnectionDialog
        isOpen={isConnectionDialogOpen}
        onClose={() => setIsConnectionDialogOpen(false)}
        onConnect={handleConnect}
      />
    </div>
  )
}
