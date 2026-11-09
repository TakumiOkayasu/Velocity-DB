import { schemaProvider } from '../api/providers';
import { toERDiagramModel } from './erDiagramParser';

export async function readERDiagramFile(file: File) {
  const result = await schemaProvider.parseERDiagram({
    content: await file.text(),
    filename: file.name,
  });
  return { model: toERDiagramModel(result, file.name), ddl: result.ddl };
}
