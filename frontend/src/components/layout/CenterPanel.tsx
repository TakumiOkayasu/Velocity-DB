import { EditorTabs } from '../editor/EditorTabs';
import { SqlEditor } from '../editor/SqlEditor';
import styles from './CenterPanel.module.css';

export function CenterPanel() {
  return (
    <div className={styles.container}>
      <EditorTabs />
      <div className={styles.editorContainer}>
        <SqlEditor />
      </div>
    </div>
  );
}
