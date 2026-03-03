import type { ResultSet } from '../../../types';
import type { Exportable, ExportOptions } from './types';

export const jsonExporter: Exportable = {
  generate(resultSet: ResultSet, _options: ExportOptions): string {
    const { columns, rows } = resultSet;
    const data = rows.map((row) => {
      const obj: Record<string, string | null> = {};
      columns.forEach((col, idx) => {
        const val = row[idx];
        obj[col.name] = val;
      });
      return obj;
    });
    return JSON.stringify(data, null, 2);
  },
};
