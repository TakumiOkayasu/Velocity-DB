import type { Query } from '../../types';

export function isRunButtonDisabled(
  activeQuery: Query | null | undefined,
  activeQueryConnectionId: string | null | undefined
): boolean {
  if (!activeQuery || !activeQueryConnectionId) return true;
  if (activeQuery.isDataView === true || activeQuery.isERDiagram === true) return true;
  return activeQuery.content.trim().length === 0;
}
