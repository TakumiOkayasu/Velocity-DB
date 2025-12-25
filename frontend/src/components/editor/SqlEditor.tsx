import Editor, { type OnMount } from '@monaco-editor/react';
import { useCallback, useEffect, useRef } from 'react';
import { bridge } from '../../api/bridge';
import { useConnectionStore } from '../../store/connectionStore';
import { useQueryStore } from '../../store/queryStore';
import { log } from '../../utils/logger';
import styles from './SqlEditor.module.css';

export function SqlEditor() {
  const { queries, activeQueryId, updateQuery, executeQuery } = useQueryStore();
  const { activeConnectionId } = useConnectionStore();
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const isFormattingRef = useRef(false);

  const activeQuery = queries.find((q) => q.id === activeQueryId);

  const handleEditorChange = (value: string | undefined) => {
    if (activeQueryId && value !== undefined) {
      updateQuery(activeQueryId, value);
    }
  };

  // Global keyboard event handler - bypasses Monaco Editor's key binding system
  // This prevents potential blocking issues with Monaco's internal event handling
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ctrl+Shift+K for SQL formatting (changed from F to avoid conflicts)
      if (event.ctrlKey && event.shiftKey && event.key === 'K') {
        event.preventDefault();
        log.info('[SqlEditor] ===== Ctrl+Shift+K DETECTED =====');

        // INLINE EXECUTION - NO ALERTS AT ALL to avoid WebView2 message loop blocking
        requestAnimationFrame(() => {
          setTimeout(() => {
            log.info('[SqlEditor] Format: Starting inline format');

            if (isFormattingRef.current) {
              log.info('[SqlEditor] Format: Already formatting, aborting');
              return;
            }

            if (!activeQueryId || !editorRef.current) {
              log.info('[SqlEditor] Format: No active query or editor');
              return;
            }

            log.info('[SqlEditor] Format: Getting SQL value');
            const currentValue = editorRef.current.getValue();
            log.info(`[SqlEditor] Format: Got SQL, length=${currentValue.length}`);

            if (!currentValue.trim()) {
              log.info('[SqlEditor] Format: Empty SQL, aborting');
              return;
            }

            if (currentValue.length > 100000) {
              log.warning(
                `[SqlEditor] Format: SQL too large (${currentValue.length} chars), aborting`
              );
              return;
            }

            isFormattingRef.current = true;
            log.info('[SqlEditor] Format: Calling bridge.formatSQL');

            // Direct Promise chain - no function call
            bridge
              .formatSQL(currentValue)
              .then((result) => {
                log.info('[SqlEditor] Format: bridge.formatSQL SUCCESS');
                if (result.sql && editorRef.current) {
                  requestAnimationFrame(() => {
                    if (editorRef.current) {
                      log.info('[SqlEditor] Format: Setting editor value');
                      editorRef.current.setValue(result.sql);
                      updateQuery(activeQueryId, result.sql);
                      log.info('[SqlEditor] Format: COMPLETE');
                    }
                    isFormattingRef.current = false;
                  });
                } else {
                  isFormattingRef.current = false;
                }
              })
              .catch((error) => {
                isFormattingRef.current = false;
                const msg = error instanceof Error ? error.message : String(error);
                log.error(`[SqlEditor] Format: ERROR - ${msg}`);
              });
          }, 0);
        });
        return;
      }

      // F9 for query execution
      if (event.key === 'F9' && !event.ctrlKey && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        log.debug('[SqlEditor] Global F9 detected');
        if (activeQueryId && activeConnectionId) {
          requestAnimationFrame(() => {
            setTimeout(() => {
              executeQuery(activeQueryId, activeConnectionId);
            }, 0);
          });
        }
        return;
      }

      // Ctrl+Enter for query execution
      if (event.ctrlKey && event.key === 'Enter' && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        log.debug('[SqlEditor] Global Ctrl+Enter detected');
        if (activeQueryId && activeConnectionId) {
          requestAnimationFrame(() => {
            setTimeout(() => {
              executeQuery(activeQueryId, activeConnectionId);
            }, 0);
          });
        }
      }
    };

    // Add global keyboard listener
    window.addEventListener('keydown', handleKeyDown);
    log.debug('[SqlEditor] Global keyboard listener registered');

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      log.debug('[SqlEditor] Global keyboard listener removed');
    };
  }, [activeQueryId, activeConnectionId, executeQuery, updateQuery]);

  const handleEditorDidMount: OnMount = useCallback((editor) => {
    // Store editor reference
    editorRef.current = editor;

    // Auto-focus editor when mounted
    editor.focus();

    log.debug('[SqlEditor] Editor mounted, using global keyboard shortcuts');
    // Note: We no longer use Monaco's addCommand() to avoid potential blocking issues
    // All keyboard shortcuts are handled via global window.addEventListener
  }, []);

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
