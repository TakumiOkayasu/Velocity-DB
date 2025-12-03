import Editor from '@monaco-editor/react';
import { useConnectionStore } from '../../store/connectionStore';
import { useQueryStore } from '../../store/queryStore';
import styles from './SqlEditor.module.css';

export function SqlEditor() {
  const { queries, activeQueryId, updateQuery, executeQuery } = useQueryStore();
  const { activeConnectionId } = useConnectionStore();

  const activeQuery = queries.find((q) => q.id === activeQueryId);

  const handleEditorChange = (value: string | undefined) => {
    if (activeQueryId && value !== undefined) {
      updateQuery(activeQueryId, value);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Ctrl+Enter to execute
    if (e.ctrlKey && e.key === 'Enter' && activeQueryId && activeConnectionId) {
      e.preventDefault();
      executeQuery(activeQueryId, activeConnectionId);
    }
  };

  if (!activeQuery) {
    return (
      <div className={styles.empty}>
        <p>No query tab open</p>
        <p>Press Ctrl+N to create a new query</p>
      </div>
    );
  }

  return (
    <div className={styles.container} onKeyDown={handleKeyDown}>
      <Editor
        height="100%"
        language="sql"
        theme="vs-dark"
        value={activeQuery.content}
        onChange={handleEditorChange}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 4,
          wordWrap: 'on',
          renderLineHighlight: 'line',
          matchBrackets: 'always',
          folding: true,
          suggestOnTriggerCharacters: true,
        }}
      />
    </div>
  );
}
