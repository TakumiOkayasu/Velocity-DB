import { csvExporter } from './csvExporter';
import { htmlExporter } from './htmlExporter';
import { jsonExporter } from './jsonExporter';
import { markdownExporter } from './markdownExporter';
import { sqlExporter } from './sqlExporter';
import type { Exportable, ExportFormat } from './types';

export type { Exportable, ExportFormat, ExportOptions } from './types';
export { isExportFormat } from './types';

const exporterRegistry: Record<ExportFormat, Exportable> = {
  csv: csvExporter,
  json: jsonExporter,
  sql: sqlExporter,
  html: htmlExporter,
  markdown: markdownExporter,
};

export function getExporter(format: ExportFormat): Exportable {
  return exporterRegistry[format];
}
