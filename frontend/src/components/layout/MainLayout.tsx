import { useState } from 'react'
import { LeftPanel } from './LeftPanel'
import { CenterPanel } from './CenterPanel'
import { BottomPanel } from './BottomPanel'
import styles from './MainLayout.module.css'

export function MainLayout() {
  const [leftPanelWidth, setLeftPanelWidth] = useState(250)
  const [bottomPanelHeight, setBottomPanelHeight] = useState(200)
  const [isLeftPanelVisible, setIsLeftPanelVisible] = useState(true)
  const [isBottomPanelVisible, setIsBottomPanelVisible] = useState(true)

  return (
    <div className={styles.container}>
      <header className={styles.toolbar}>
        <div className={styles.toolbarGroup}>
          <button title="New Query (Ctrl+N)">New</button>
          <button title="Open File (Ctrl+O)">Open</button>
          <button title="Save (Ctrl+S)">Save</button>
        </div>
        <div className={styles.toolbarGroup}>
          <button title="Execute (Ctrl+Enter)">▶ Execute</button>
          <button title="Cancel">⬛ Cancel</button>
        </div>
        <div className={styles.toolbarGroup}>
          <button title="Format SQL (Ctrl+Shift+F)">Format</button>
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
        <span>Ready</span>
        <span>|</span>
        <span>No connection</span>
      </footer>
    </div>
  )
}
