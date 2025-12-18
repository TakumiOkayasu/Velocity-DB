import Editor, { type OnMount } from '@monaco-editor/react';
import { useCallback, useRef } from 'react';
import { bridge } from '../../api/bridge';
import { useConnectionStore } from '../../store/connectionStore';
import { useQueryStore } from '../../store/queryStore';
import { log } from '../../utils/logger';
import styles from './SqlEditor.module.css';

export function SqlEditor() {
  const { queries, activeQueryId, updateQuery, executeQuery } = useQueryStore();
  const { activeConnectionId } = useConnectionStore();
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  const activeQuery = queries.find((q) => q.id === activeQueryId);

  const handleEditorChange = (value: string | undefined) => {
    if (activeQueryId && value !== undefined) {
      updateQuery(activeQueryId, value);
    }
  };

  const handleFormatSQL = useCallback(async () => {
    if (!activeQueryId || !editorRef.current) return;

    const currentValue = editorRef.current.getValue();
    if (!currentValue.trim()) return;

    try {
      log.debug('[SqlEditor] Formatting SQL...');
      const result = await bridge.formatSQL(currentValue);
      if (result.sql) {
        editorRef.current.setValue(result.sql);
        updateQuery(activeQueryId, result.sql);
        log.debug('[SqlEditor] SQL formatted successfully');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`[SqlEditor] Failed to format SQL: ${errorMessage}`);
    }
  }, [activeQueryId, updateQuery]);

  const handleEditorDidMount: OnMount = useCallback(
    (editor, monaco) => {
      // Store editor reference
      editorRef.current = editor;

      // Auto-focus editor when mounted
      editor.focus();

      // F9 key binding (single key execution)
      editor.addCommand(monaco.KeyCode.F9, () => {
        if (activeQueryId && activeConnectionId) {
          executeQuery(activeQueryId, activeConnectionId);
        }
      });

      // Ctrl+Enter key binding
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
        if (activeQueryId && activeConnectionId) {
          executeQuery(activeQueryId, activeConnectionId);
        }
      });

      // Ctrl+Shift+F key binding (format SQL)
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => {
        handleFormatSQL();
      });
    },
    [activeQueryId, activeConnectionId, executeQuery, handleFormatSQL]
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
