import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

vi.mock('monaco-editor', () => {
  const setModelMarkers = vi.fn();
  return {
    editor: { setModelMarkers },
    MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
  };
});

import * as monaco from 'monaco-editor';
import { clearSqlMarkers, setSqlMarkers } from '../../utils/editorMarkers';

type MockModel = {
  getLineContent: (n: number) => string;
};

const makeModel = (line: string): MockModel => ({
  getLineContent: () => line,
});

describe('editorMarkers', () => {
  beforeEach(() => {
    vi.mocked(monaco.editor.setModelMarkers).mockClear();
  });

  it('converts Diagnostic to Monaco Error marker with 1-based coords', () => {
    const model = makeModel('SELEC * FROM t');
    setSqlMarkers(
      model as unknown as monaco.editor.ITextModel,
      [{ line: 1, column: 1, code: 'PRS', message: 'parse error' }],
      'sqruff'
    );
    expect(monaco.editor.setModelMarkers).toHaveBeenCalledWith(model, 'sqruff', [
      expect.objectContaining({
        severity: monaco.MarkerSeverity.Error,
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        message: '[PRS] parse error',
        source: 'sqruff',
      }),
    ]);
  });

  it('empty diagnostics clears previous markers for owner', () => {
    const model = makeModel('');
    setSqlMarkers(model as unknown as monaco.editor.ITextModel, [], 'sqruff');
    expect(monaco.editor.setModelMarkers).toHaveBeenCalledWith(model, 'sqruff', []);
  });

  it('clearSqlMarkers only clears specified owner', () => {
    const model = makeModel('');
    clearSqlMarkers(model as unknown as monaco.editor.ITextModel, 'sqruff');
    expect(monaco.editor.setModelMarkers).toHaveBeenCalledWith(model, 'sqruff', []);
    expect(monaco.editor.setModelMarkers).not.toHaveBeenCalledWith(
      model,
      'runtime',
      expect.anything()
    );
  });

  it('normalizes end column to at least startColumn+1 when line is short', () => {
    const model = makeModel('a');
    setSqlMarkers(
      model as unknown as monaco.editor.ITextModel,
      [{ line: 1, column: 10, message: 'msg' }],
      'sqruff'
    );
    const call = vi.mocked(monaco.editor.setModelMarkers).mock.calls[0];
    expect(call).toBeDefined();
    const marker = (call[2] as monaco.editor.IMarkerData[])[0];
    expect(marker.endColumn).toBeGreaterThan(marker.startColumn);
  });

  it('does nothing when model is null', () => {
    setSqlMarkers(null, [{ line: 1, column: 1, message: 'x' }], 'sqruff');
    expect(monaco.editor.setModelMarkers).not.toHaveBeenCalled();
  });
});
