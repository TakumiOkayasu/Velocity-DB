import loader from '@monaco-editor/loader';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import * as monaco from 'monaco-editor';
import { type MutableRefObject, useCallback, useEffect, useRef } from 'react';
import { useKeyboardHandler } from '../../hooks/useKeyboardHandler';
import { useLintDiagnostics, useQueryStore, useRuntimeDiagnostics } from '../../store/queryStore';
import { useSchemaStore } from '../../store/schemaStore';
import {
  clearSqlMarkers,
  type SqlMarkerInput,
  type SqlMarkerOwner,
  setSqlMarkers,
} from '../../utils/editorMarkers';
import { log } from '../../utils/logger';
import { formatSQL } from '../../utils/sqlFormat';
import { getStatementAtCursor } from '../../utils/sqlParser';
import { createCompletionProvider } from './completionProvider';
import './monacoEnvironment';
import styles from './SqlEditor.module.css';

// Use local bundle instead of CDN (WebView2 Tracking Prevention blocks cdn.jsdelivr.net)
loader.config({ monaco });

// Read latest store state inside deferred callbacks (requestAnimationFrame/setTimeout)
// to avoid stale closures captured at handler invocation time
const getQueryState = () => useQueryStore.getState();

/** owner別diagnosticsをMonaco markerに反映する汎用hook */
function useApplyMarkers(
  editorRef: MutableRefObject<Parameters<OnMount>[0] | null>,
  diagnostics: SqlMarkerInput[] | null,
  owner: SqlMarkerOwner
): void {
  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model) return;
    if (!diagnostics || diagnostics.length === 0) {
      clearSqlMarkers(model, owner);
      return;
    }
    setSqlMarkers(model, diagnostics, owner);
  }, [editorRef, diagnostics, owner]);
}

/** Get the connection ID of the active query tab (not the global activeConnectionId). */
const getActiveQueryConnectionId = () => {
  const { queries, activeQueryId } = getQueryState();
  const found = queries.find((q) => q.id === activeQueryId);
  return found?.connectionId ?? null;
};

export function SqlEditor() {
  const { queries, activeQueryId, updateQuery } = useQueryStore();
  const activeQuery = queries.find((q) => q.id === activeQueryId);
  const queryConnectionId = activeQuery?.connectionId ?? null;
  const lintDiagnostics = useLintDiagnostics(activeQueryId);
  const runtimeDiagnostics = useRuntimeDiagnostics(activeQueryId);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const completionDisposableRef = useRef<Monaco.IDisposable | null>(null);
  const isFormattingRef = useRef(false);
  const lastEditorValueRef = useRef<string>('');

  const handleEditorChange = (value: string | undefined) => {
    if (activeQueryId && value !== undefined) {
      lastEditorValueRef.current = value;
      updateQuery(activeQueryId, value);
    }
  };

  // ストア側でcontentが変更された場合（フォーマット等）、Monacoに直接反映
  useEffect(() => {
    if (editorRef.current && activeQuery?.content !== undefined) {
      const editorValue = editorRef.current.getValue();
      if (
        editorValue !== activeQuery.content &&
        lastEditorValueRef.current !== activeQuery.content
      ) {
        editorRef.current.setValue(activeQuery.content);
      }
      lastEditorValueRef.current = activeQuery.content;
    }
  }, [activeQuery?.content]);

  // Global keyboard event handler - bypasses Monaco Editor's key binding system
  // This prevents potential blocking issues with Monaco's internal event handling
  useKeyboardHandler((event: KeyboardEvent) => {
    // Ctrl+Shift+K for SQL formatting (changed from F to avoid conflicts)
    if (event.ctrlKey && event.shiftKey && event.key === 'K') {
      event.preventDefault();
      log.info('[SqlEditor] ===== Ctrl+Shift+K DETECTED =====');

      // INLINE EXECUTION - NO ALERTS AT ALL to avoid WebView2 message loop blocking
      requestAnimationFrame(() => {
        setTimeout(async () => {
          log.info('[SqlEditor] Format: Starting inline format');

          if (isFormattingRef.current) {
            log.info('[SqlEditor] Format: Already formatting, aborting');
            return;
          }

          const qId = getQueryState().activeQueryId;
          if (!qId || !editorRef.current) {
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
          log.info('[SqlEditor] Format: Calling formatSQL');

          try {
            const formatted = await formatSQL(currentValue);
            log.info('[SqlEditor] Format: formatSQL SUCCESS');
            if (editorRef.current) {
              lastEditorValueRef.current = formatted;
              editorRef.current.setValue(formatted);
              getQueryState().updateQuery(qId, formatted);
              log.info('[SqlEditor] Format: COMPLETE');
            }
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            log.error(`[SqlEditor] Format: ERROR - ${msg}`);
          } finally {
            isFormattingRef.current = false;
          }
        }, 0);
      });
      return;
    }

    // F9 for query execution
    if (event.key === 'F9' && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      log.debug('[SqlEditor] Global F9 detected');
      requestAnimationFrame(() => {
        setTimeout(() => {
          const qId = getQueryState().activeQueryId;
          const cId = getActiveQueryConnectionId();
          if (qId && cId) {
            getQueryState().executeQuery(qId, cId);
          }
        }, 0);
      });
      return;
    }

    // Ctrl+Enter for executing current statement at cursor position
    if (event.ctrlKey && event.key === 'Enter' && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      log.debug('[SqlEditor] Global Ctrl+Enter detected');
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (!editorRef.current) return;
          const qId = getQueryState().activeQueryId;
          const cId = getActiveQueryConnectionId();
          if (!qId || !cId) return;

          const model = editorRef.current.getModel();
          const position = editorRef.current.getPosition();
          if (!model || !position) {
            // フォールバック: 全体を実行
            getQueryState().executeQuery(qId, cId);
            return;
          }

          const cursorOffset = model.getOffsetAt(position);
          const fullText = model.getValue();
          const currentStatement = getStatementAtCursor(fullText, cursorOffset);

          if (currentStatement) {
            log.debug(
              `[SqlEditor] Executing statement at cursor: ${currentStatement.slice(0, 50)}...`
            );
            getQueryState().executeSelectedText(qId, cId, currentStatement);
          } else {
            // フォールバック: 全体を実行
            getQueryState().executeQuery(qId, cId);
          }
        }, 0);
      });
      return;
    }

    // Ctrl+S for save to file
    if (event.ctrlKey && event.key === 's' && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      log.debug('[SqlEditor] Global Ctrl+S detected');
      requestAnimationFrame(() => {
        setTimeout(() => {
          const qId = getQueryState().activeQueryId;
          if (qId) getQueryState().saveToFile(qId);
        }, 0);
      });
      return;
    }

    // Ctrl+O for load from file
    if (event.ctrlKey && event.key === 'o' && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      log.debug('[SqlEditor] Global Ctrl+O detected');
      requestAnimationFrame(() => {
        setTimeout(() => {
          const qId = getQueryState().activeQueryId;
          if (qId) getQueryState().loadFromFile(qId);
        }, 0);
      });
      return;
    }
  });

  const handleEditorDidMount: OnMount = useCallback(
    (editor, monaco) => {
      // Store editor reference
      editorRef.current = editor;
      monacoRef.current = monaco;

      // Auto-focus editor when mounted
      editor.focus();

      // Register completion provider for SQL
      if (completionDisposableRef.current) {
        completionDisposableRef.current.dispose();
      }
      completionDisposableRef.current = monaco.languages.registerCompletionItemProvider(
        'sql',
        createCompletionProvider(queryConnectionId)
      );

      // Preload schema if connected
      if (queryConnectionId) {
        useSchemaStore.getState().loadTables(queryConnectionId);
      }

      log.debug('[SqlEditor] Editor mounted with completion provider');
    },
    [queryConnectionId]
  );

  // 接続IDが変わったらcompletionProviderを再登録
  useEffect(() => {
    if (monacoRef.current && queryConnectionId) {
      if (completionDisposableRef.current) {
        completionDisposableRef.current.dispose();
      }
      completionDisposableRef.current = monacoRef.current.languages.registerCompletionItemProvider(
        'sql',
        createCompletionProvider(queryConnectionId)
      );
      useSchemaStore.getState().loadTables(queryConnectionId);
      log.debug(`[SqlEditor] Completion provider updated for connection: ${queryConnectionId}`);
    }
  }, [queryConnectionId]);

  // sqruff lint + ODBC実行エラー(runtime)をMonaco markerに反映 (owner別に独立管理)
  useApplyMarkers(editorRef, lintDiagnostics, 'sqruff');
  useApplyMarkers(editorRef, runtimeDiagnostics, 'runtime');

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (completionDisposableRef.current) {
        completionDisposableRef.current.dispose();
      }
    };
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
          // .horizontalResizer の margin: -4px 食い込みを相殺 + 視認性余裕 4px
          padding: { bottom: 8 },
        }}
      />
    </div>
  );
}
