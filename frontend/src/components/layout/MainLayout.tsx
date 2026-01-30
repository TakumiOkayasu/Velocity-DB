import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { bridge } from '../../api/bridge';
import {
  useConnectionStore,
  useIsProductionMode,
  useIsReadOnlyMode,
} from '../../store/connectionStore';
import { useERDiagramStore } from '../../store/erDiagramStore';
import { useQueryStore } from '../../store/queryStore';
import { useSessionStore } from '../../store/sessionStore';
import {
  checkSqlSafety,
  getQueryWarnings,
  type UnsafeQueryWarning,
} from '../../utils/sqlSafetyCheck';
import type { ConnectionConfig } from '../dialogs/ConnectionDialog';
import { QueryConfirmDialog } from '../dialogs/QueryConfirmDialog';
import { CenterPanel } from './CenterPanel';
import styles from './MainLayout.module.css';

// Lazy load heavy components (dialogs, panels) to reduce initial bundle size
const LeftPanel = lazy(() =>
  import('./LeftPanel').then((module) => ({ default: module.LeftPanel }))
);
const BottomPanel = lazy(() =>
  import('./BottomPanel').then((module) => ({ default: module.BottomPanel }))
);
const ConnectionDialog = lazy(() =>
  import('../dialogs/ConnectionDialog').then((module) => ({ default: module.ConnectionDialog }))
);
const SearchDialog = lazy(() =>
  import('../dialogs/SearchDialog').then((module) => ({ default: module.SearchDialog }))
);
const SettingsDialog = lazy(() =>
  import('../dialogs/SettingsDialog').then((module) => ({ default: module.SettingsDialog }))
);
const A5ERImportDialog = lazy(() =>
  import('../dialogs/A5ERImportDialog').then((module) => ({ default: module.A5ERImportDialog }))
);

// Simple loading fallback
function LoadingFallback() {
  return <div style={{ display: 'none' }} />;
}

// SVG Icons (JetBrains-style simple icons)
const Icons = {
  database: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <ellipse cx="8" cy="4" rx="6" ry="2.5" />
      <path d="M2 4v8c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5V4" />
      <path d="M2 8c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5" />
    </svg>
  ),
  newFile: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M9 1H4a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V5L9 1z" />
      <path d="M9 1v4h4" />
      <path d="M8 8v4M6 10h4" />
    </svg>
  ),
  play: (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M4 2.5v11l9-5.5-9-5.5z" />
    </svg>
  ),
  stop: (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <rect x="3" y="3" width="10" height="10" rx="1" />
    </svg>
  ),
  format: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 3h12M2 6h8M2 9h10M2 12h6" />
    </svg>
  ),
  import: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 2v8M5 7l3 3 3-3" />
      <path d="M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2" />
    </svg>
  ),
  sidebar: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="2" width="12" height="12" rx="1" />
      <path d="M6 2v12" />
    </svg>
  ),
  terminal: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="2" width="12" height="12" rx="1" />
      <path d="M2 10h12" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="7" cy="7" r="4" />
      <path d="M10 10l3.5 3.5" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M2.93 2.93l1.41 1.41M11.66 11.66l1.41 1.41M2.93 13.07l1.41-1.41M11.66 4.34l1.41-1.41" />
    </svg>
  ),
};

export function MainLayout() {
  // Session store for persisted layout state
  const {
    leftPanelWidth: savedLeftPanelWidth,
    bottomPanelHeight: savedBottomPanelHeight,
    isLeftPanelVisible: savedLeftPanelVisible,
    setLeftPanelWidth: saveLeftPanelWidth,
    setBottomPanelHeight: saveBottomPanelHeight,
    setLeftPanelVisible: saveLeftPanelVisible,
  } = useSessionStore();

  const [leftPanelWidth, setLeftPanelWidth] = useState(savedLeftPanelWidth);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(savedBottomPanelHeight);
  const [isLeftPanelVisible, setIsLeftPanelVisible] = useState(savedLeftPanelVisible);
  // Bottom panel is hidden by default on startup, shown when query is executed
  const [isBottomPanelVisible, setIsBottomPanelVisible] = useState(false);
  const [isConnectionDialogOpen, setIsConnectionDialogOpen] = useState(false);
  const [isSearchDialogOpen, setIsSearchDialogOpen] = useState(false);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [isA5ERImportDialogOpen, setIsA5ERImportDialogOpen] = useState(false);
  const [queryConfirmDialog, setQueryConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    details?: string;
    isBlocked?: boolean;
  }>({ isOpen: false, title: '', message: '' });

  const { connections, activeConnectionId, addConnection } = useConnectionStore();
  const {
    queries,
    activeQueryId,
    results,
    addQuery,
    removeQuery,
    executeQuery,
    formatQuery,
    isExecuting,
  } = useQueryStore();
  const { importFromA5ER } = useERDiagramStore();
  const isProduction = useIsProductionMode();
  const isReadOnly = useIsReadOnlyMode();
  const activeConnection = connections.find((c) => c.id === activeConnectionId);
  const activeQuery = queries.find((q) => q.id === activeQueryId);
  const isDataView = activeQuery?.isDataView === true;

  // Hide bottom panel when in data view mode (table display)
  const shouldShowBottomPanel = isBottomPanelVisible && !isDataView;

  // Auto-show bottom panel when query results are available
  useEffect(() => {
    if (activeQueryId && results[activeQueryId] && !isDataView) {
      setIsBottomPanelVisible(true);
    }
  }, [activeQueryId, results, isDataView]);

  const handleConnect = async (config: ConnectionConfig) => {
    try {
      await addConnection({
        name: config.name,
        server: config.server,
        port: config.port,
        database: config.database,
        username: config.username,
        password: config.password,
        useWindowsAuth: config.useWindowsAuth,
        isProduction: config.isProduction,
        isReadOnly: config.isReadOnly,
        ssh: config.ssh.enabled
          ? {
              enabled: true,
              host: config.ssh.host,
              port: config.ssh.port,
              username: config.ssh.username,
              authType: config.ssh.authType,
              password: config.ssh.password,
              privateKeyPath: config.ssh.privateKeyPath,
              keyPassphrase: config.ssh.keyPassphrase,
            }
          : undefined,
      });
    } catch (error) {
      console.error('Connection failed:', error);
    }
  };

  const handleNewQuery = useCallback(() => {
    addQuery(activeConnectionId);
  }, [addQuery, activeConnectionId]);

  // Store pending execution for use after confirmation
  const pendingExecutionRef = useRef<{ queryId: string; connectionId: string } | null>(null);

  const doExecuteQuery = useCallback(() => {
    if (activeQueryId && activeConnectionId) {
      executeQuery(activeQueryId, activeConnectionId);
      setIsBottomPanelVisible(true);
    }
  }, [activeQueryId, activeConnectionId, executeQuery]);

  const handleExecute = useCallback(() => {
    if (!activeQueryId || !activeConnectionId || !activeQuery) return;

    const sql = activeQuery.content;

    // Check for read-only mode violations
    if (isReadOnly) {
      const safetyResult = checkSqlSafety(sql);
      if (!safetyResult.isSafe) {
        setQueryConfirmDialog({
          isOpen: true,
          title: 'Read-Only Mode',
          message: safetyResult.message || 'This query is blocked in read-only mode.',
          details: sql.slice(0, 200) + (sql.length > 200 ? '...' : ''),
          isBlocked: true,
        });
        return;
      }
    }

    // Check for production mode warnings
    if (isProduction && !isReadOnly) {
      const warnings = getQueryWarnings(sql, true);
      if (warnings.length > 0) {
        pendingExecutionRef.current = { queryId: activeQueryId, connectionId: activeConnectionId };
        setQueryConfirmDialog({
          isOpen: true,
          title: 'Production Warning',
          message: warnings.map((w: UnsafeQueryWarning) => w.message).join('\n'),
          details: sql.slice(0, 200) + (sql.length > 200 ? '...' : ''),
          isBlocked: false,
        });
        return;
      }
    }

    // Safe to execute
    doExecuteQuery();
  }, [activeQueryId, activeConnectionId, activeQuery, isProduction, isReadOnly, doExecuteQuery]);

  const handleConfirmExecute = useCallback(() => {
    setQueryConfirmDialog({ isOpen: false, title: '', message: '' });
    if (pendingExecutionRef.current) {
      const { queryId, connectionId } = pendingExecutionRef.current;
      executeQuery(queryId, connectionId);
      setIsBottomPanelVisible(true);
      pendingExecutionRef.current = null;
    }
  }, [executeQuery]);

  const handleCancelExecute = useCallback(() => {
    setQueryConfirmDialog({ isOpen: false, title: '', message: '' });
    pendingExecutionRef.current = null;
  }, []);

  const handleFormat = useCallback(() => {
    if (activeQueryId) {
      formatQuery(activeQueryId);
    }
  }, [activeQueryId, formatQuery]);

  const handleOpenSearch = useCallback(() => {
    setIsSearchDialogOpen(true);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setIsSettingsDialogOpen(true);
  }, []);

  const handleCloseTab = useCallback(() => {
    if (activeQueryId) {
      removeQuery(activeQueryId);
    }
  }, [activeQueryId, removeQuery]);

  const handleSearchResultSelect = useCallback(
    (result: { type: string; name: string; schema: string }) => {
      // Insert table/view name into active query
      if (activeQueryId) {
        const fullName = `[${result.schema}].[${result.name}]`;
        // For now, just log it - could be enhanced to insert at cursor
        console.log('Selected:', fullName);
      }
    },
    [activeQueryId]
  );

  // Persist layout changes
  useEffect(() => {
    saveLeftPanelWidth(leftPanelWidth);
  }, [leftPanelWidth, saveLeftPanelWidth]);

  useEffect(() => {
    saveBottomPanelHeight(bottomPanelHeight);
  }, [bottomPanelHeight, saveBottomPanelHeight]);

  useEffect(() => {
    saveLeftPanelVisible(isLeftPanelVisible);
  }, [isLeftPanelVisible, saveLeftPanelVisible]);

  // Note: isBottomPanelVisible is NOT persisted - it's always hidden on startup

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent F5 page reload
      if (e.key === 'F5') {
        e.preventDefault();
        return;
      }

      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        handleNewQuery();
      } else if (e.ctrlKey && e.key === 'w') {
        e.preventDefault();
        handleCloseTab();
      } else if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        handleExecute();
      } else if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        handleFormat();
      } else if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        handleOpenSearch();
      } else if (e.ctrlKey && e.key === ',') {
        e.preventDefault();
        handleOpenSettings();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    handleNewQuery,
    handleCloseTab,
    handleExecute,
    handleFormat,
    handleOpenSearch,
    handleOpenSettings,
  ]);

  // Track and save window size/position
  const saveWindowSizeTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const saveWindowSize = () => {
      // Debounce: save after 500ms of no resize activity
      if (saveWindowSizeTimeoutRef.current !== null) {
        window.clearTimeout(saveWindowSizeTimeoutRef.current);
      }

      saveWindowSizeTimeoutRef.current = window.setTimeout(() => {
        bridge.updateSettings({
          window: {
            width: window.innerWidth,
            height: window.innerHeight,
            x: window.screenX,
            y: window.screenY,
            isMaximized: false, // WebView doesn't provide maximize detection
          },
        });
      }, 500);
    };

    // Save on resize
    window.addEventListener('resize', saveWindowSize);

    // Save before unload
    const handleBeforeUnload = () => {
      bridge.updateSettings({
        window: {
          width: window.innerWidth,
          height: window.innerHeight,
          x: window.screenX,
          y: window.screenY,
          isMaximized: false,
        },
      });
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('resize', saveWindowSize);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (saveWindowSizeTimeoutRef.current !== null) {
        window.clearTimeout(saveWindowSizeTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className={styles.container}>
      {/* Production Environment Warning Banner */}
      {isProduction && (
        <div className={styles.productionBanner}>
          <span className={styles.productionIcon}>!</span>
          <span>PRODUCTION ENVIRONMENT</span>
          {isReadOnly && <span className={styles.readOnlyBadge}>READ-ONLY</span>}
        </div>
      )}

      <header className={styles.toolbar}>
        {/* Connection */}
        <div className={styles.toolbarGroup}>
          <button onClick={() => setIsConnectionDialogOpen(true)} title="New Connection">
            {Icons.database}
            <span>Connect</span>
          </button>
        </div>

        <div className={styles.toolbarDivider} />

        {/* Query operations */}
        <div className={styles.toolbarGroup}>
          <button className={styles.iconButton} onClick={handleNewQuery} title="New Query (Ctrl+N)">
            {Icons.newFile}
          </button>
        </div>

        <div className={styles.toolbarGroup}>
          <button
            onClick={handleExecute}
            disabled={!activeQueryId || !activeConnectionId || isExecuting}
            title="Execute (Ctrl+Enter)"
            className={styles.executeButton}
          >
            {isExecuting ? Icons.stop : Icons.play}
            <span>{isExecuting ? 'Stop' : 'Run'}</span>
          </button>
        </div>

        <div className={styles.toolbarGroup}>
          <button
            className={styles.iconButton}
            onClick={handleFormat}
            disabled={!activeQuery?.content}
            title="Format SQL (Ctrl+Shift+F)"
          >
            {Icons.format}
          </button>
        </div>

        <div className={styles.toolbarDivider} />

        {/* Import */}
        <div className={styles.toolbarGroup}>
          <button onClick={() => setIsA5ERImportDialogOpen(true)} title="Import A5:ER File">
            {Icons.import}
            <span>Import</span>
          </button>
        </div>

        {/* Spacer */}
        <div className={styles.toolbarSpacer} />

        {/* View toggles */}
        <div className={styles.toolbarGroup}>
          <button
            className={styles.iconButton}
            onClick={() => setIsLeftPanelVisible(!isLeftPanelVisible)}
            title="Toggle Database Explorer"
          >
            {Icons.sidebar}
          </button>
          <button
            className={styles.iconButton}
            onClick={() => setIsBottomPanelVisible(!isBottomPanelVisible)}
            disabled={isDataView}
            title="Toggle Results Panel"
          >
            {Icons.terminal}
          </button>
        </div>

        <div className={styles.toolbarDivider} />

        {/* Search and Settings */}
        <div className={styles.toolbarGroup}>
          <button
            className={styles.iconButton}
            onClick={handleOpenSearch}
            title="Search (Ctrl+Shift+P)"
          >
            {Icons.search}
          </button>
          <button
            className={styles.iconButton}
            onClick={handleOpenSettings}
            title="Settings (Ctrl+,)"
          >
            {Icons.settings}
          </button>
        </div>
      </header>

      <div className={styles.mainContent}>
        {isLeftPanelVisible && (
          <Suspense fallback={<LoadingFallback />}>
            <LeftPanel width={leftPanelWidth} />
            <div
              className={styles.verticalResizer}
              onMouseDown={(e) => {
                const startX = e.clientX;
                const startWidth = leftPanelWidth;

                const onMouseMove = (moveEvent: MouseEvent) => {
                  const newWidth = startWidth + (moveEvent.clientX - startX);
                  setLeftPanelWidth(Math.max(150, Math.min(500, newWidth)));
                };

                const onMouseUp = () => {
                  document.removeEventListener('mousemove', onMouseMove);
                  document.removeEventListener('mouseup', onMouseUp);
                };

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
              }}
            />
          </Suspense>
        )}

        <div className={styles.rightSection}>
          <CenterPanel />

          {shouldShowBottomPanel && (
            <Suspense fallback={<LoadingFallback />}>
              <div
                className={styles.horizontalResizer}
                onMouseDown={(e) => {
                  const startY = e.clientY;
                  const startHeight = bottomPanelHeight;

                  const onMouseMove = (moveEvent: MouseEvent) => {
                    const newHeight = startHeight - (moveEvent.clientY - startY);
                    setBottomPanelHeight(Math.max(100, Math.min(500, newHeight)));
                  };

                  const onMouseUp = () => {
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                  };

                  document.addEventListener('mousemove', onMouseMove);
                  document.addEventListener('mouseup', onMouseUp);
                }}
              />
              <BottomPanel
                height={bottomPanelHeight}
                onClose={() => setIsBottomPanelVisible(false)}
              />
            </Suspense>
          )}
        </div>
      </div>

      <footer className={styles.statusBar}>
        <div className={styles.statusLeft}>
          <span
            className={`${styles.statusItem} ${isExecuting ? styles.statusExecuting : styles.statusReady}`}
          >
            <span className={styles.connectionDot} />
            {isExecuting ? 'Executing...' : 'Ready'}
          </span>
          {activeConnection?.tableOpenTimeMs !== undefined && (
            <span
              className={styles.statusItem}
              title="テーブルを開くのにかかった時間（クリックから表示まで）"
            >
              | Open: {activeConnection.tableOpenTimeMs.toFixed(1)}ms
            </span>
          )}
        </div>
        <div className={styles.statusCenter}>{activeQuery && <span>{activeQuery.name}</span>}</div>
        <div className={styles.statusRight}>
          <span
            className={`${styles.statusItem} ${activeConnection ? styles.connected : styles.disconnected}`}
          >
            <span className={styles.connectionDot} />
            {activeConnection
              ? `${activeConnection.server}/${activeConnection.database}`
              : 'Not connected'}
          </span>
        </div>
      </footer>

      {isConnectionDialogOpen && (
        <Suspense fallback={<LoadingFallback />}>
          <ConnectionDialog
            isOpen={isConnectionDialogOpen}
            onClose={() => setIsConnectionDialogOpen(false)}
            onConnect={handleConnect}
          />
        </Suspense>
      )}

      {isSearchDialogOpen && (
        <Suspense fallback={<LoadingFallback />}>
          <SearchDialog
            isOpen={isSearchDialogOpen}
            onClose={() => setIsSearchDialogOpen(false)}
            onResultSelect={handleSearchResultSelect}
          />
        </Suspense>
      )}

      {isSettingsDialogOpen && (
        <Suspense fallback={<LoadingFallback />}>
          <SettingsDialog
            isOpen={isSettingsDialogOpen}
            onClose={() => setIsSettingsDialogOpen(false)}
          />
        </Suspense>
      )}

      {isA5ERImportDialogOpen && (
        <Suspense fallback={<LoadingFallback />}>
          <A5ERImportDialog
            isOpen={isA5ERImportDialogOpen}
            onClose={() => setIsA5ERImportDialogOpen(false)}
            onImport={(tables, relations) => {
              importFromA5ER(
                tables.map((t) => ({
                  name: t.name,
                  schema: t.schema,
                  columns: t.columns.map((c) => ({
                    name: c.name,
                    type: c.type,
                    nullable: c.nullable,
                    isPrimaryKey: c.isPrimaryKey,
                  })),
                })),
                relations.map((r) => ({
                  sourceTable: r.sourceTable,
                  targetTable: r.targetTable,
                  cardinality: r.cardinality,
                }))
              );
            }}
          />
        </Suspense>
      )}

      {/* Query Confirm Dialog for Production/Read-Only Mode */}
      <QueryConfirmDialog
        isOpen={queryConfirmDialog.isOpen}
        title={queryConfirmDialog.title}
        message={queryConfirmDialog.message}
        details={queryConfirmDialog.details}
        isDestructive={true}
        confirmLabel={queryConfirmDialog.isBlocked ? 'OK' : 'Execute Anyway'}
        cancelLabel={queryConfirmDialog.isBlocked ? undefined : 'Cancel'}
        onConfirm={queryConfirmDialog.isBlocked ? handleCancelExecute : handleConfirmExecute}
        onCancel={handleCancelExecute}
      />
    </div>
  );
}
