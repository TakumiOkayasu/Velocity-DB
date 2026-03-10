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
}
