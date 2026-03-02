import type { DatabaseType, ResultSet } from '../../../types';

export type ExportFormat = 'csv' | 'json' | 'sql' | 'html' | 'markdown';

export interface ExportOptions {
  format: ExportFormat;
  includeHeaders: boolean;
  delimiter: string;
  nullValue: string;
  tableName: string;
  dbType?: DatabaseType;
}

export interface Exportable {
  generate(resultSet: ResultSet, options: ExportOptions): string;
}
