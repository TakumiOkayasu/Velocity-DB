import { useCallback, useEffect, useRef, useState } from 'react';

interface UseFileDropOptions {
  addQueryFromFile: (name: string, content: string, connectionId?: string | null) => void;
  activeQueryConnectionId: string | null;
}

export function useFileDrop({ addQueryFromFile, activeQueryConnectionId }: UseFileDropOptions) {
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const readAndOpen = useCallback(
    (files: FileList) => {
      for (const file of Array.from(files)) {
        if (!file.name.toLowerCase().endsWith('.sql')) continue;
        const reader = new FileReader();
        reader.onload = () => {
          const content = reader.result as string;
          const name = file.name.replace(/\.sql$/i, '');
          addQueryFromFile(name, content, activeQueryConnectionId);
        };
        reader.readAsText(file);
      }
    },
    [addQueryFromFile, activeQueryConnectionId]
  );

  useEffect(() => {
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      dragCounterRef.current++;
      if (dragCounterRef.current === 1) {
        setIsFileDragOver(true);
      }
    };

    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    };

    const leave = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      dragCounterRef.current--;
      if (dragCounterRef.current === 0) {
        setIsFileDragOver(false);
      }
    };

    const drop = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsFileDragOver(false);
      if (e.dataTransfer?.files.length) {
        readAndOpen(e.dataTransfer.files);
      }
    };

    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);

    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [readAndOpen]);

  return { isFileDragOver };
}
