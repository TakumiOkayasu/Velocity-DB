import { lazy, Suspense, useCallback, useMemo } from 'react';
import { useERImport } from '../../hooks/useERImport';
import { useConnectionStore } from '../../store/connectionStore';
import { useActiveQuery, useQueryStore } from '../../store/queryStore';
import { connectionColor } from '../../utils/colorContrast';
import { log } from '../../utils/logger';
import { EditorTabs } from '../editor/EditorTabs';
import styles from './CenterPanel.module.css';

// Lazy load heavy components to reduce initial bundle size
const SqlEditor = lazy(() =>
  import('../editor/SqlEditor').then((module) => ({ default: module.SqlEditor }))
);
const ResultGrid = lazy(() =>
  import('../grid/ResultGrid').then((module) => ({ default: module.ResultGrid }))
);
const ERDiagramView = lazy(() =>
  import('../diagram/ERDiagram').then((module) => ({ default: module.ERDiagram }))
);
const ERImportDialog = lazy(() =>
  import('../dialogs/ERImportDialog').then((module) => ({ default: module.ERImportDialog }))
);

// Loading fallback for Monaco Editor
function EditorLoadingFallback() {
  return (
    <div className={styles.editorLoading}>
      <div className={styles.loadingSpinner} />
      <div className={styles.loadingText}>Loading editor...</div>
    </div>
  );
}

export function CenterPanel() {
  const activeQuery = useActiveQuery();
  const connections = useConnectionStore((s) => s.connections);
  const updateQueryConnection = useQueryStore((s) => s.updateQueryConnection);
  const erImport = useERImport();
  const isDataView = activeQuery?.isDataView === true;
  const isERDiagram = activeQuery?.isERDiagram === true;

  const selectorColor = useMemo(() => {
    if (!activeQuery?.connectionId) return undefined;
    const conn = connections.find((c) => c.id === activeQuery.connectionId);
    return conn ? connectionColor(conn.server, conn.database) : undefined;
  }, [activeQuery?.connectionId, connections]);

  const activeQueryId = activeQuery?.id ?? null;
  const handleConnectionChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (!activeQueryId) return;
      updateQueryConnection(activeQueryId, e.target.value || null);
    },
    [activeQueryId, updateQueryConnection]
  );

  log.debug(
    `[CenterPanel] Render: activeQuery=${activeQuery?.id}, isDataView=${isDataView}, isERDiagram=${isERDiagram}`
  );

  return (
    <div className={styles.container}>
      <div className={styles.tabBar}>
        <EditorTabs />
        <select
          className={styles.connectionSelector}
          style={selectorColor ? { '--connection-color': selectorColor } : undefined}
          value={activeQuery?.connectionId ?? ''}
          onChange={handleConnectionChange}
          disabled={connections.length === 0 || !activeQuery}
          title="このタブの接続先"
        >
          {connections.length === 0 ? (
            <option value="">未接続</option>
          ) : (
            <>
              {!activeQuery?.connectionId && <option value="">接続を選択</option>}
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} / {c.database}
                  {c.isProduction ? ' (本番)' : ''}
                </option>
              ))}
            </>
          )}
        </select>
      </div>
      <div className={styles.editorContainer}>
        <Suspense fallback={<EditorLoadingFallback />}>
          {isERDiagram ? (
            <ERDiagramView onOpenImportDialog={erImport.open} />
          ) : isDataView ? (
            <ResultGrid queryId={activeQuery?.id} />
          ) : (
            <SqlEditor />
          )}
        </Suspense>
      </div>
      {erImport.isOpen && (
        <Suspense fallback={null}>
          <ERImportDialog
            isOpen={erImport.isOpen}
            onClose={erImport.close}
            onImport={erImport.importModel}
          />
        </Suspense>
      )}
    </div>
  );
}
