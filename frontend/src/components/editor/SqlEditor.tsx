import Editor, { type OnMount } from '@monaco-editor/react';
import { useCallback } from 'react';
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

  const handleEditorDidMount: OnMount = useCallback(
    (editor, monaco) => {
      // F5 key binding
      editor.addCommand(monaco.KeyCode.F5, () => {
        if (activeQueryId && activeConnectionId) {
          executeQuery(activeQueryId, activeConnectionId);
        }
      });

      // Ctrl+Enter key binding (already works, but let's make it explicit)
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
        if (activeQueryId && activeConnectionId) {
          executeQuery(activeQueryId, activeConnectionId);
        }
      });
    },
    [activeQueryId, activeConnectionId, executeQuery]
  );

  if (!activeQuery) {
    return (
      <div className={styles.empty}>
        <p>No query tab open</p>
        <p>Press Ctrl+N to create a new query</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <Editor
        height="100%"
        language="sql"
        theme="vs-dark"
        value={activeQuery.content}
        onChange={handleEditorChange}
        onMount={handleEditorDidMount}
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
