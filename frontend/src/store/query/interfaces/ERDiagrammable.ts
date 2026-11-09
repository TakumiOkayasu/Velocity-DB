import type { ERDiagramModel } from '../../../utils/erDiagramParser';

export interface ERDiagrammable {
  openERDiagram: (name: string, model?: ERDiagramModel) => string;
}
