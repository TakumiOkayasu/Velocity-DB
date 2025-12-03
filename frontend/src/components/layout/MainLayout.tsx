import { useState, useEffect, useCallback } from 'react'
import { LeftPanel } from './LeftPanel'
import { CenterPanel } from './CenterPanel'
import { BottomPanel } from './BottomPanel'
import { ConnectionDialog, type ConnectionConfig } from '../dialogs/ConnectionDialog'
import { SearchDialog } from '../dialogs/SearchDialog'
import { SettingsDialog } from '../dialogs/SettingsDialog'
import { useConnectionStore } from '../../store/connectionStore'
import { useQueryStore } from '../../store/queryStore'
import { useSessionStore } from '../../store/sessionStore'
import styles from './MainLayout.module.css'

export function MainLayout() {
  // Session store for persisted layout state
  const {
    leftPanelWidth: savedLeftPanelWidth,
    bottomPanelHeight: savedBottomPanelHeight,
    isLeftPanelVisible: savedLeftPanelVisible,
    isBottomPanelVisible: savedBottomPanelVisible,
    setLeftPanelWidth: saveLeftPanelWidth,
    setBottomPanelHeight: saveBottomPanelHeight,
    setLeftPanelVisible: saveLeftPanelVisible,
    setBottomPanelVisible: saveBottomPanelVisible,
  } = useSessionStore()

  const [leftPanelWidth, setLeftPanelWidth] = useState(savedLeftPanelWidth)
  const [bottomPanelHeight, setBottomPanelHeight] = useState(savedBottomPanelHeight)
  const [isLeftPanelVisible, setIsLeftPanelVisible] = useState(savedLeftPanelVisible)
  const [isBottomPanelVisible, setIsBottomPanelVisible] = useState(savedBottomPanelVisible)
  const [isConnectionDialogOpen, setIsConnectionDialogOpen] = useState(false)
  const [isSearchDialogOpen, setIsSearchDialogOpen] = useState(false)
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false)

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

  const handleOpenSearch = useCallback(() => {
    setIsSearchDialogOpen(true)
  }, [])

  const handleOpenSettings = useCallback(() => {
    setIsSettingsDialogOpen(true)
  }, [])

  const handleSearchResultSelect = useCallback((result: { type: string; name: string; schema: string }) => {
    // Insert table/view name into active query
    if (activeQueryId) {
      const fullName = `[${result.schema}].[${result.name}]`
      // For now, just log it - could be enhanced to insert at cursor
      console.log('Selected:', fullName)
    }
  }, [activeQueryId])

  // Persist layout changes
  useEffect(() => {
    saveLeftPanelWidth(leftPanelWidth)
  }, [leftPanelWidth, saveLeftPanelWidth])

  useEffect(() => {
    saveBottomPanelHeight(bottomPanelHeight)
  }, [bottomPanelHeight, saveBottomPanelHeight])

  useEffect(() => {
    saveLeftPanelVisible(isLeftPanelVisible)
  }, [isLeftPanelVisible, saveLeftPanelVisible])

  useEffect(() => {
    saveBottomPanelVisible(isBottomPanelVisible)
  }, [isBottomPanelVisible, saveBottomPanelVisible])

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
      } else if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        e.preventDefault()
        handleOpenSearch()
      } else if (e.ctrlKey && e.key === ',') {
        e.preventDefault()
        handleOpenSettings()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleNewQuery, handleExecute, handleFormat, handleOpenSearch, handleOpenSettings])

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
            {isExecuting ? '竢ｳ' : '笆ｶ'} Execute
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
            {isLeftPanelVisible ? '笳' : '笆ｶ'} Objects
          </button>
          <button
            onClick={() => setIsBottomPanelVisible(!isBottomPanelVisible)}
            title="Toggle Results Panel"
          >
            {isBottomPanelVisible ? '笆ｼ' : '笆ｲ'} Results
          </button>
        </div>
        <div className={styles.toolbarGroup}>
          <button
            onClick={handleOpenSearch}
            title="Search (Ctrl+Shift+P)"
          >
            剥 Search
          </button>
          <button
            onClick={handleOpenSettings}
            title="Settings (Ctrl+,)"
          >
            笞呻ｸ・Settings
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

      <SearchDialog
        isOpen={isSearchDialogOpen}
        onClose={() => setIsSearchDialogOpen(false)}
        onResultSelect={handleSearchResultSelect}
      />

      <SettingsDialog
        isOpen={isSettingsDialogOpen}
        onClose={() => setIsSettingsDialogOpen(false)}
      />
    </div>
  )
}
