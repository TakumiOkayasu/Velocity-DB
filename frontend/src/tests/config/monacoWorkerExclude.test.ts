import { describe, expect, it } from 'vitest';

const workerManagerRE =
  /monaco-editor[\\/]esm[\\/]vs[\\/]languages[\\/]features[\\/](css|html|json|typescript)[\\/]workerManager\.js$/;

const workerPattern =
  /new Worker\(new URL\('[^']+\.worker\.js',\s*import\.meta\.url\),\s*\{[^}]*\}\)/g;

describe('monacoWorkerExcludePlugin patterns', () => {
  it.each(['css', 'html', 'json', 'typescript'])('%s workerManager matches', (lang) => {
    const id = `node_modules/monaco-editor/esm/vs/languages/features/${lang}/workerManager.js`;
    expect(workerManagerRE.test(id)).toBe(true);
  });

  it('editor workerManager does NOT match', () => {
    expect(workerManagerRE.test('node_modules/monaco-editor/esm/vs/editor/editor.worker.js')).toBe(
      false
    );
  });

  it('replaces new Worker(new URL(...)) pattern', () => {
    const code = `createWorker: () => new Worker(new URL('css.worker.js', import.meta.url), { type: "module" })`;
    const result = code.replace(
      workerPattern,
      '(() => { throw new Error("Worker not available"); })()'
    );
    expect(result).not.toContain('new Worker');
    expect(result).toContain('throw new Error');
  });
});
