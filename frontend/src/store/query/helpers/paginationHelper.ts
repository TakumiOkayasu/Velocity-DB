import { log } from '../../../utils/logger';
import type { PaginatedBridgeable } from '../interfaces/PaginatedBridgeable';
import type { SetState } from '../types';

/** Fetch total row count in background and update paginationStates + results */
export function fetchAndUpdateRowCount(
  set: SetState,
  bridge: PaginatedBridgeable,
  id: string,
  baseSql: string,
  connectionId: string
): void {
  bridge
    .getRowCount(connectionId, baseSql)
    .then(({ rowCount }) => {
      set((state) => {
        const pag = state.paginationStates[id];
        if (!pag) return {};
        const current = state.results[id];
        if (!current || 'multipleResults' in current) return {};
        return {
          results: {
            ...state.results,
            [id]: { ...current, totalRowCount: rowCount },
          },
          paginationStates: {
            ...state.paginationStates,
            [id]: { ...pag, totalRowCount: rowCount, hasMore: pag.loadedRowCount < rowCount },
          },
        };
      });
    })
    .catch((err) => {
      log.error(`[QueryStore] Failed to get row count: ${err}`);
    });
}
