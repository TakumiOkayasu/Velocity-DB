import { useCallback, useState } from 'react';
import { useQueryStore } from '../store/queryStore';

export function useERImport() {
  const [isOpen, setIsOpen] = useState(false);
  const openERDiagram = useQueryStore((s) => s.openERDiagram);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  return { isOpen, open, close, importModel: openERDiagram };
}
