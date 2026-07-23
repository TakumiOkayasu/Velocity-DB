import { Suspense, useCallback, useEffect, useRef } from 'react';
import { appSettingsProvider } from '../../api/providers';
import { useDialogState } from '../../hooks/useDialogState';
import { useFileDrop } from '../../hooks/useFileDrop';
import { useKeyboardShortcutHandler } from '../../hooks/useKeyboardShortcutHandler';
import { usePanelLayoutState } from '../../hooks/usePanelLayoutState';
import { applyConnectionMigration } from '../../store/connectionMigration';
import {
  useConnectionActions,
  useConnectionStore,
  useConnections,
} from '../../store/connectionStore';
import { useActiveQueryMeta, useQueryActions, useQueryStore } from '../../store/queryStore';
import type { ConnectionConfig } from '../../types/connectionForm';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import { checkQueryExecutability } from '../../utils/queryExecutionCheck';
import { QueryConfirmDialog } from '../dialogs/QueryConfirmDialog';
import { ToolbarIcons } from '../icons/SvgIcons';
import { CenterPanel } from './CenterPanel';
import styles from './MainLayout.module.css';
import { resolveNewQueryConnectionId } from './newQueryConnection';

// Lazy load heavy components (dialogs, panels) to reduce initial bundle size
const LeftPanel = lazyWithRetry(() =>
  import('./LeftPanel').then((module) => ({ default: module.LeftPanel }))
);
const BottomPanel = lazyWithRetry(() =>
  import('./BottomPanel').then((module) => ({ default: module.BottomPanel }))
);
const ConnectionDialog = lazyWithRetry(() =>
  import('../dialogs/ConnectionDialog').then((module) => ({ default: module.ConnectionDialog }))
);
const SearchDialog = lazyWithRetry(() =>
  import('../dialogs/SearchDialog').then((module) => ({ default: module.SearchDialog }))
);
const SettingsDialog = lazyWithRetry(() =>
  import('../dialogs/SettingsDialog').then((module) => ({ default: module.SettingsDialog }))
);
const DataCompareDialog = lazyWithRetry(() =>
  import('../dialogs/DataCompareDialog').then((module) => ({ default: module.DataCompareDialog }))
);
// Simple loading fallback
function LoadingFallback() {
  return <div style={{ display: 'none' }} />;
}

export function MainLayout() {
  const {
    isConnectionDialogOpen,
    openConnectionDialog,
    closeConnectionDialog,
    isSearchDialogOpen,
    openSearchDialog,
    closeSearchDialog,
    isSettingsDialogOpen,
    openSettingsDialog,
    closeSettingsDialog,
    isDataCompareDialogOpen,
    openDataCompareDialog,
    closeDataCompareDialog,
    queryConfirm,
    openQueryConfirm,
    closeQueryConfirm,
    hasOpenDialog,
  } = useDialogState();

  const connections = useConnections();
  const { addConnection, cancelConnection } = useConnectionActions();
  const isConnecting = useConnectionStore((s) => s.isConnecting);

  const activeQueryId = useQueryStore((s) => s.activeQueryId);
  const {
    connectionId: activeQueryConnectionId,
    isDataView,
    name: activeQueryName,
  } = useActiveQueryMeta();
  const hasActiveResult = useQueryStore(
    (s) => s.activeQueryId !== null && s.results[s.activeQueryId] !== undefined
  );
  const isExecuting = useQueryStore((s) => s.isExecuting);
  const isRunDisabled = useQueryStore((s) => {
    const q = s.queriesById[s.activeQueryId ?? ''];
    if (!q || !q.connectionId) return true;
    if (q.isDataView === true || q.isERDiagram === true) return true;
    return q.content.trim().length === 0;
  });
  const isFormatDisabled = useQueryStore((s) => {
    const q = s.queriesById[s.activeQueryId ?? ''];
    return !q?.content || q?.isDataView === true;
  });
  const { addQuery, addQueryFromFile, removeQuery, executeQuery, cancelQuery, formatQuery } =
    useQueryActions();

  const { isFileDragOver } = useFileDrop({ addQueryFromFile, activeQueryConnectionId });
  const activeQueryConnection = connections.find((c) => c.id === activeQueryConnectionId);
  const isProduction = activeQueryConnection?.isProduction ?? false;
  const isReadOnly = activeQueryConnection?.isReadOnly ?? false;

  const {
    leftPanelWidth,
    setLeftPanelWidth,
    bottomPanelHeight,
    setBottomPanelHeight,
    isLeftPanelVisible,
    setIsLeftPanelVisible,
    isBottomPanelVisible,
    setIsBottomPanelVisible,
    shouldShowBottomPanel,
  } = usePanelLayoutState({
    activeQueryId,
    hasActiveResult,
    isDataView,
  });

  const connectToDatabase = async (config: ConnectionConfig) => {
    try {
      const result = await addConnection({
        name: config.name,
        server: config.server,
        port: config.port,
        database: config.database,
        username: config.username,
        password: config.password,
        useWindowsAuth: config.useWindowsAuth,
        dbType: config.dbType,
        isProduction: config.isProduction,
        isReadOnly: config.isReadOnly,
        environment: config.environment,
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
      applyConnectionMigration(result.replaced);
      closeConnectionDialog();
    } catch {
      // Error is displayed in ConnectionDialog via connectionStore.error
    }
  };

  const handleNewQuery = useCallback(() => {
    const activeConnectionId = useConnectionStore.getState().activeConnectionId;
    addQuery(resolveNewQueryConnectionId(activeQueryConnectionId, activeConnectionId));
  }, [addQuery, activeQueryConnectionId]);

  // Store pending execution for use after confirmation
  const pendingExecutionRef = useRef<{ queryId: string; connectionId: string } | null>(null);

  const doExecuteQuery = useCallback(() => {
    if (activeQueryId && activeQueryConnectionId) {
      executeQuery(activeQueryId, activeQueryConnectionId);
      setIsBottomPanelVisible(true);
    }
  }, [activeQueryId, activeQueryConnectionId, executeQuery, setIsBottomPanelVisible]);

  const handleExecute = useCallback(() => {
    if (!activeQueryId || !activeQueryConnectionId) return;
    const query = useQueryStore.getState().queriesById[activeQueryId];
    if (!query) return;

    const result = checkQueryExecutability(query.content, { isReadOnly, isProduction });

    if (result.action === 'execute') {
      doExecuteQuery();
      return;
    }

    if (result.action === 'warn') {
      pendingExecutionRef.current = {
        queryId: activeQueryId,
        connectionId: activeQueryConnectionId,
      };
    }

    openQueryConfirm({
      title: result.title,
      message: result.message,
      details: result.details,
      isBlocked: result.action === 'block',
    });
  }, [
    activeQueryId,
    activeQueryConnectionId,
    isProduction,
    isReadOnly,
    doExecuteQuery,
    openQueryConfirm,
  ]);

  const handleConfirmExecute = useCallback(() => {
    closeQueryConfirm();
    if (pendingExecutionRef.current) {
      const { queryId, connectionId } = pendingExecutionRef.current;
      executeQuery(queryId, connectionId);
      setIsBottomPanelVisible(true);
      pendingExecutionRef.current = null;
    }
  }, [executeQuery, closeQueryConfirm, setIsBottomPanelVisible]);

  const handleCancelExecute = useCallback(() => {
    closeQueryConfirm();
    pendingExecutionRef.current = null;
  }, [closeQueryConfirm]);

  const handleCancel = useCallback(() => {
    if (!activeQueryConnectionId) return;
    cancelQuery(activeQueryConnectionId);
  }, [activeQueryConnectionId, cancelQuery]);

  const handleFormat = useCallback(() => {
    if (activeQueryId && !isDataView) {
      formatQuery(activeQueryId);
    }
  }, [activeQueryId, isDataView, formatQuery]);

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

  useKeyboardShortcutHandler({
    onNewQuery: handleNewQuery,
    onCloseTab: handleCloseTab,
    onExecute: handleExecute,
    onFormat: handleFormat,
    onOpenSearch: openSearchDialog,
    onOpenSettings: openSettingsDialog,
    onCancel: handleCancel,
    isExecuting,
    hasOpenDialog,
  });

  // Track and save window size/position
  const saveWindowSizeTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const saveWindowSize = () => {
      // Debounce: save after 500ms of no resize activity
      if (saveWindowSizeTimeoutRef.current !== null) {
        window.clearTimeout(saveWindowSizeTimeoutRef.current);
      }

      saveWindowSizeTimeoutRef.current = window.setTimeout(() => {
        appSettingsProvider.updateSettings({
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
      appSettingsProvider.updateSettings({
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
          <span>本番環境</span>
          {isReadOnly && <span className={styles.readOnlyBadge}>読み取り専用</span>}
        </div>
      )}

      <header className={styles.toolbar}>
        {/* Connection */}
        <div className={styles.toolbarGroup}>
          <button type="button" onClick={openConnectionDialog} title="新規接続">
            <ToolbarIcons.Database />
            <span>接続</span>
          </button>
        </div>

        <div className={styles.toolbarDivider} />

        <div className={styles.toolbarGroup}>
          <button
            type="button"
            onClick={isExecuting ? handleCancel : handleExecute}
            disabled={isRunDisabled}
            title={isExecuting ? '停止 (Escape)' : '実行 (F9)'}
            className={styles.executeButton}
          >
            {isExecuting ? <ToolbarIcons.Stop /> : <ToolbarIcons.Play />}
            <span>{isExecuting ? '停止' : '実行'}</span>
          </button>
        </div>

        <div className={styles.toolbarGroup}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={handleFormat}
            disabled={isFormatDisabled}
            title="SQLフォーマット (Ctrl+Shift+F)"
          >
            <ToolbarIcons.Format />
          </button>
        </div>

        {/* Spacer */}
        <div className={styles.toolbarSpacer} />

        {/* View toggles */}
        <div className={styles.toolbarGroup}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => setIsLeftPanelVisible(!isLeftPanelVisible)}
            title="データベースエクスプローラーを切り替え"
          >
            <ToolbarIcons.Sidebar />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => setIsBottomPanelVisible(!isBottomPanelVisible)}
            disabled={isDataView}
            title="結果パネルを切り替え"
          >
            <ToolbarIcons.Terminal />
          </button>
        </div>

        <div className={styles.toolbarDivider} />

        {/* Search and Settings */}
        <div className={styles.toolbarGroup}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={openSearchDialog}
            title="検索 (Ctrl+Shift+P)"
          >
            <ToolbarIcons.Search />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            onClick={openDataCompareDialog}
            title="データ比較"
          >
            <ToolbarIcons.Compare />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            onClick={openSettingsDialog}
            title="設定 (Ctrl+,)"
          >
            <ToolbarIcons.Settings />
          </button>
        </div>
      </header>

      <div className={styles.mainContent}>
        {isLeftPanelVisible && (
          <Suspense fallback={<LoadingFallback />}>
            <LeftPanel width={leftPanelWidth} />
            {/* biome-ignore lint/a11y/noStaticElementInteractions: drag-only resizer; keyboard panel sizing is not required */}
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
              {/* biome-ignore lint/a11y/noStaticElementInteractions: drag-only resizer; keyboard panel sizing is not required */}
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
            {isExecuting ? '実行中...' : '準備完了'}
          </span>
          {activeQueryConnection?.tableOpenTimeMs !== undefined && (
            <span
              className={styles.statusItem}
              title="テーブルを開くのにかかった時間（クリックから表示まで）"
            >
              | Open: {activeQueryConnection.tableOpenTimeMs.toFixed(1)}ms
            </span>
          )}
        </div>
        <div className={styles.statusCenter}>
          {activeQueryName && <span>{activeQueryName}</span>}
        </div>
        <div className={styles.statusRight}>
          <span
            className={`${styles.statusItem} ${activeQueryConnection ? styles.connected : styles.disconnected}`}
          >
            <span className={styles.connectionDot} />
            {activeQueryConnection
              ? `${activeQueryConnection.server}/${activeQueryConnection.database}`
              : '未接続'}
          </span>
        </div>
      </footer>

      {isFileDragOver && (
        <div className={styles.fileDropOverlay}>
          <div className={styles.fileDropOverlayInner}>
            <svg
              className={styles.fileDropOverlayIcon}
              viewBox="0 0 48 48"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M24 4v28M14 22l10 10 10-10" />
              <path d="M4 32v8a4 4 0 004 4h32a4 4 0 004-4v-8" />
            </svg>
            <span>.sql ファイルをドロップ</span>
          </div>
        </div>
      )}

      {isConnectionDialogOpen && (
        <Suspense fallback={<LoadingFallback />}>
          <ConnectionDialog
            isOpen={isConnectionDialogOpen}
            onClose={() => {
              if (isConnecting) cancelConnection();
              closeConnectionDialog();
            }}
            onConnect={connectToDatabase}
            isConnecting={isConnecting}
            onCancelConnect={cancelConnection}
          />
        </Suspense>
      )}

      {isSearchDialogOpen && (
        <Suspense fallback={<LoadingFallback />}>
          <SearchDialog
            isOpen={isSearchDialogOpen}
            onClose={closeSearchDialog}
            onResultSelect={handleSearchResultSelect}
          />
        </Suspense>
      )}

      {isSettingsDialogOpen && (
        <Suspense fallback={<LoadingFallback />}>
          <SettingsDialog isOpen={isSettingsDialogOpen} onClose={closeSettingsDialog} />
        </Suspense>
      )}

      {isDataCompareDialogOpen && (
        <Suspense fallback={<LoadingFallback />}>
          <DataCompareDialog isOpen={isDataCompareDialogOpen} onClose={closeDataCompareDialog} />
        </Suspense>
      )}

      {/* Query Confirm Dialog for Production/Read-Only Mode */}
      <QueryConfirmDialog
        isOpen={queryConfirm.isOpen}
        title={queryConfirm.title}
        message={queryConfirm.message}
        details={queryConfirm.details}
        isDestructive={true}
        confirmLabel={queryConfirm.isBlocked ? 'OK' : 'Execute Anyway'}
        cancelLabel={queryConfirm.isBlocked ? undefined : 'Cancel'}
        onConfirm={queryConfirm.isBlocked ? handleCancelExecute : handleConfirmExecute}
        onCancel={handleCancelExecute}
      />
    </div>
  );
}
