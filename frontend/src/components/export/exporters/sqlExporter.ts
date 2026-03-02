import type { ResultSet } from '../../../types';
import { quoteIdentifier, quoteLiteral } from '../../../utils/sqlIdentifier';
import type { Exportable, ExportOptions } from './types';

export const sqlExporter: Exportable = {
  generate(resultSet: ResultSet, options: ExportOptions): string {
    const { columns, rows } = resultSet;
    const { tableName, dbType } = options;

    const q = (n: string) => quoteIdentifier(n, dbType);
    const quotedTable = q(tableName);
    const quotedColumns = columns.map((c) => q(c.name)).join(', ');

    const lines: string[] = [];
    for (const row of rows) {
      const values = row.map((val) => {
        if (val === null) return 'NULL';
        return quoteLiteral(String(val), dbType);
      });
      lines.push(`INSERT INTO ${quotedTable} (${quotedColumns}) VALUES (${values.join(', ')});`);
    }
    return lines.join('\n');
  },
};
