import type { DatabaseType, ResultSet } from '../../../types';

const EXPORT_FORMATS = ['csv', 'json', 'sql', 'html', 'markdown'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function isExportFormat(value: string): value is ExportFormat {
  return (EXPORT_FORMATS as readonly string[]).includes(value);
}

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
