export interface PaginatedBridgeable {
  executeQueryPaginated(
    connectionId: string,
    sql: string,
    startRow: number,
    endRow: number,
    sortModel?: Array<{ colId: string; sort: 'asc' | 'desc' }>
  ): Promise<{
    columns: { name: string; type: string }[];
    rows: (string | null)[][];
    affectedRows: number;
    executionTimeMs: number;
  }>;
  getRowCount(connectionId: string, sql: string): Promise<{ rowCount: number }>;
}
