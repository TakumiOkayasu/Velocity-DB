import type { ResultSet } from '../../../types';
import type { Exportable, ExportOptions } from './types';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const htmlExporter: Exportable = {
  generate(resultSet: ResultSet, options: ExportOptions): string {
    const { columns, rows } = resultSet;
    const { includeHeaders, nullValue } = options;

    const headerRow = includeHeaders
      ? `<tr>${columns.map((c) => `<th>${escapeHtml(c.name)}</th>`).join('')}</tr>`
      : '';
    const dataRows = rows
      .map((row) => {
        const cells = row.map((val) => {
          const display = val === null ? nullValue : val;
          return `<td>${escapeHtml(String(display))}</td>`;
        });
        return `<tr>${cells.join('')}</tr>`;
      })
      .join('\n');
    return `<table>\n<thead>\n${headerRow}\n</thead>\n<tbody>\n${dataRows}\n</tbody>\n</table>`;
  },
};
