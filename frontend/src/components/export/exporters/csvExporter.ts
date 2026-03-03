import type { ResultSet } from '../../../types';
import type { Exportable, ExportOptions } from './types';

export const csvExporter: Exportable = {
  generate(resultSet: ResultSet, options: ExportOptions): string {
    const { columns, rows } = resultSet;
    const { includeHeaders, delimiter, nullValue } = options;

    const lines: string[] = [];
    if (includeHeaders) {
      lines.push(columns.map((c) => `"${c.name.replace(/"/g, '""')}"`).join(delimiter));
    }
    const needsQuoting =
      nullValue.includes(delimiter) ||
      nullValue.includes('"') ||
      nullValue.includes('\n') ||
      nullValue.includes('\r');
    const escapedNullValue = needsQuoting ? `"${nullValue.replace(/"/g, '""')}"` : nullValue;
    for (const row of rows) {
      const values = row.map((val) => {
        if (val === null) return escapedNullValue;
        const escaped = String(val).replace(/"/g, '""');
        return `"${escaped}"`;
      });
      lines.push(values.join(delimiter));
    }
    return lines.join('\n');
  },
};
