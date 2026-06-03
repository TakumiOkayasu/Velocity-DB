import type { Query } from '../../../types';

export function toQueriesById(queries: Query[]): Record<string, Query> {
  const map: Record<string, Query> = {};
  for (const q of queries) {
    map[q.id] = q;
  }
  return map;
}
