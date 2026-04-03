import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFileDrop } from '../../hooks/useFileDrop';

function createDragEvent(type: string, files: File[] = []): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const dataTransfer = {
    types: files.length > 0 ? ['Files'] : [],
    files,
    dropEffect: 'none',
  };
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  return event;
}

function makeSqlFile(name: string, content: string): File {
  return new File([content], name, { type: 'text/plain' });
}

describe('useFileDrop', () => {
  const addQueryFromFile = vi.fn();

  afterEach(() => {
    addQueryFromFile.mockClear();
    vi.restoreAllMocks();
  });

  it('isFileDragOver becomes true on dragenter with files', () => {
    const { result } = renderHook(() =>
      useFileDrop({ addQueryFromFile, activeQueryConnectionId: null })
    );

    expect(result.current.isFileDragOver).toBe(false);

    act(() => {
      window.dispatchEvent(createDragEvent('dragenter', [makeSqlFile('test.sql', '')]));
    });

    expect(result.current.isFileDragOver).toBe(true);
  });

  it('isFileDragOver resets on dragleave when counter reaches 0', () => {
    const { result } = renderHook(() =>
      useFileDrop({ addQueryFromFile, activeQueryConnectionId: null })
    );

    act(() => {
      window.dispatchEvent(createDragEvent('dragenter', [makeSqlFile('a.sql', '')]));
      window.dispatchEvent(createDragEvent('dragenter', [makeSqlFile('a.sql', '')]));
    });
    expect(result.current.isFileDragOver).toBe(true);

    act(() => {
      window.dispatchEvent(createDragEvent('dragleave', [makeSqlFile('a.sql', '')]));
    });
    expect(result.current.isFileDragOver).toBe(true);

    act(() => {
      window.dispatchEvent(createDragEvent('dragleave', [makeSqlFile('a.sql', '')]));
    });
    expect(result.current.isFileDragOver).toBe(false);
  });

  it('calls addQueryFromFile on drop with .sql file', async () => {
    const { result } = renderHook(() =>
      useFileDrop({ addQueryFromFile, activeQueryConnectionId: 'conn-1' })
    );

    const sqlContent = 'SELECT * FROM users;';
    const file = makeSqlFile('query.sql', sqlContent);

    act(() => {
      window.dispatchEvent(createDragEvent('dragenter', [file]));
    });
    expect(result.current.isFileDragOver).toBe(true);

    act(() => {
      window.dispatchEvent(createDragEvent('drop', [file]));
    });
    expect(result.current.isFileDragOver).toBe(false);

    // FileReader is async — wait for it
    await vi.waitFor(() => {
      expect(addQueryFromFile).toHaveBeenCalledWith('query', sqlContent, 'conn-1');
    });
  });

  it('ignores non-.sql files', async () => {
    renderHook(() => useFileDrop({ addQueryFromFile, activeQueryConnectionId: null }));

    const csvFile = new File(['data'], 'data.csv', { type: 'text/csv' });

    act(() => {
      window.dispatchEvent(createDragEvent('drop', [csvFile]));
    });

    // Give FileReader time if it were to run
    await new Promise((r) => setTimeout(r, 50));
    expect(addQueryFromFile).not.toHaveBeenCalled();
  });

  it('ignores dragenter without Files type', () => {
    const { result } = renderHook(() =>
      useFileDrop({ addQueryFromFile, activeQueryConnectionId: null })
    );

    const event = new Event('dragenter', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['text/plain'], files: [] } });

    act(() => {
      window.dispatchEvent(event);
    });

    expect(result.current.isFileDragOver).toBe(false);
  });
});
