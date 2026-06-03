import { log } from '../../../utils/logger';
import { toQueriesById } from '../helpers/queriesMap';
import type { FileBridgeable } from '../interfaces/FileBridgeable';
import type { FileIOable } from '../interfaces/FileIOable';
import type { GetState, SetState } from '../types';

interface FileIOSliceDeps {
  bridge: FileBridgeable;
}

export function createFileIOSlice(set: SetState, get: GetState, deps: FileIOSliceDeps): FileIOable {
  const { bridge } = deps;

  return {
    saveToFile: async (id) => {
      const query = get().queries.find((q) => q.id === id);
      if (!query || !query.content.trim()) return;

      try {
        const defaultFileName = query.filePath
          ? query.filePath.split('\\').pop()?.split('/').pop()
          : `${query.name}.sql`;

        const result = await bridge.saveQueryToFile(query.content, defaultFileName);

        log.info(`[QueryStore] Saved query to file: ${result.filePath}`);

        set((state) => {
          const newQueries = state.queries.map((q) =>
            q.id === id ? { ...q, filePath: result.filePath, isDirty: false } : q
          );
          return { queries: newQueries, queriesById: toQueriesById(newQueries) };
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to save file';
        if (!message.includes('cancelled')) {
          set((state) => ({ errors: { ...state.errors, [id]: message } }));
        }
      }
    },

    loadFromFile: async (id) => {
      try {
        const result = await bridge.loadQueryFromFile();

        log.info(`[QueryStore] Loaded query from file: ${result.filePath}`);

        set((state) => {
          const newQueries = state.queries.map((q) =>
            q.id === id
              ? { ...q, content: result.content, filePath: result.filePath, isDirty: false }
              : q
          );
          return { queries: newQueries, queriesById: toQueriesById(newQueries) };
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load file';
        if (!message.includes('cancelled')) {
          set((state) => ({ errors: { ...state.errors, [id]: message } }));
        }
      }
    },
  };
}
