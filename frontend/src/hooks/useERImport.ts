import { useCallback, useState } from 'react';
import { useERDiagramStore } from '../store/erDiagramStore';
import { useQueryStore } from '../store/queryStore';
import type { ERDiagramModel } from '../utils/erDiagramParser';

export function useERImport() {
  const [isOpen, setIsOpen] = useState(false);
  const loadFromParsedModel = useERDiagramStore((s) => s.loadFromParsedModel);
  const openERDiagram = useQueryStore((s) => s.openERDiagram);

  const importModel = useCallback(
    (model: ERDiagramModel) => {
      loadFromParsedModel(model);
      openERDiagram(model.name || 'ER Diagram');
    },
    [loadFromParsedModel, openERDiagram]
  );

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  return { isOpen, open, close, importModel };
}
