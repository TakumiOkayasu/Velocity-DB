import type { ResultSet } from '../../../types';
import type { Exportable, ExportOptions } from './types';

function escapeMarkdownCell(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export const markdownExporter: Exportable = {
  generate(resultSet: ResultSet, options: ExportOptions): string {
    const { columns, rows } = resultSet;
    const { includeHeaders, nullValue } = options;

    const lines: string[] = [];
    if (includeHeaders) {
      lines.push(`| ${columns.map((c) => escapeMarkdownCell(c.name)).join(' | ')} |`);
      lines.push(`| ${columns.map(() => '---').join(' | ')} |`);
    }
    for (const row of rows) {
      const values = row.map((val) =>
        val === null ? escapeMarkdownCell(nullValue) : escapeMarkdownCell(String(val))
      );
      lines.push(`| ${values.join(' | ')} |`);
    }
    return lines.join('\n');
  },
};
