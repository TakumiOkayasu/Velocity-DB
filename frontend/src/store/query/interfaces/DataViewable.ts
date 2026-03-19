export interface DataViewable {
  openTableData: (
    connectionId: string,
    tableName: string,
    whereClause?: string,
    logicalName?: string
  ) => Promise<void>;
  applyWhereFilter: (
    id: string,
    connectionId: string,
    whereClause: string
  ) => Promise<string | null>;
  refreshDataView: (id: string, connectionId: string) => Promise<void>;
  fetchMoreRows: (id: string) => Promise<void>;
  resetPaginatedSort: (
    id: string,
    sortModel: Array<{ colId: string; sort: 'asc' | 'desc' }>
  ) => Promise<void>;
}
