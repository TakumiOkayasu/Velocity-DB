import { useActiveQuery } from '../../store/queryStore';
import { log } from '../../utils/logger';
import { EditorTabs } from '../editor/EditorTabs';
import { SqlEditor } from '../editor/SqlEditor';
import { ResultGrid } from '../grid/ResultGrid';
import styles from './CenterPanel.module.css';

export function CenterPanel() {
  const activeQuery = useActiveQuery();
  const isDataView = activeQuery?.isDataView === true;

  log.debug(`[CenterPanel] Render: activeQuery=${activeQuery?.id}, isDataView=${isDataView}`);

  return (
    <div className={styles.container}>
      <EditorTabs />
      <div className={styles.editorContainer}>
        {isDataView ? <ResultGrid queryId={activeQuery?.id} /> : <SqlEditor />}
      </div>
    </div>
  );
}
