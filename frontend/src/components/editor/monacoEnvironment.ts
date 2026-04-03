import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

// SQL-only editor: load only the base editor worker.
// Language-specific workers (ts, css, html, json) are not needed for SQL editing.
(self as Record<string, unknown>).MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};
