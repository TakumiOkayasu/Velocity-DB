import { lazy, Suspense } from 'react';
import { useActiveQuery } from '../../store/queryStore';
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
  const isDataView = activeQuery?.isDataView === true;

  log.debug(`[CenterPanel] Render: activeQuery=${activeQuery?.id}, isDataView=${isDataView}`);

  return (
    <div className={styles.container}>
      <EditorTabs />
      <div className={styles.editorContainer}>
        <Suspense fallback={<EditorLoadingFallback />}>
          {isDataView ? <ResultGrid queryId={activeQuery?.id} /> : <SqlEditor />}
        </Suspense>
      </div>
    </div>
  );
}
