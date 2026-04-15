import * as monaco from 'monaco-editor';

export interface SqlMarkerInput {
  line: number; // 1-based
  column: number; // 1-based
  message: string;
  code?: string;
}

export type SqlMarkerOwner = 'sqruff' | 'runtime' | 'format';

export function setSqlMarkers(
  model: monaco.editor.ITextModel | null | undefined,
  diagnostics: SqlMarkerInput[],
  owner: SqlMarkerOwner
): void {
  if (!model) return;
  const markers: monaco.editor.IMarkerData[] = diagnostics.map((d) => {
    const startColumn = Math.max(1, d.column);
    const startLineNumber = Math.max(1, d.line);
    const line = model.getLineContent(startLineNumber) ?? '';
    const endColumn = Math.max(startColumn + 1, line.length + 1);
    return {
      severity: monaco.MarkerSeverity.Error,
      message: d.code ? `[${d.code}] ${d.message}` : d.message,
      startLineNumber,
      startColumn,
      endLineNumber: startLineNumber,
      endColumn,
      source: owner,
    };
  });
  monaco.editor.setModelMarkers(model, owner, markers);
}

export function clearSqlMarkers(
  model: monaco.editor.ITextModel | null | undefined,
  owner: SqlMarkerOwner
): void {
  if (!model) return;
  monaco.editor.setModelMarkers(model, owner, []);
}
