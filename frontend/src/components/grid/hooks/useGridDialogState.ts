import { useCallback, useState } from 'react';
import { useEphemeralOpen } from '../../../hooks/useEphemeralOpen';

export interface ValueEditorState {
  isOpen: boolean;
  rowIndex: number;
  columnName: string;
  value: string | null;
}

export interface UseGridDialogStateArgs {
  error: string | null;
}

export interface UseGridDialogStateResult {
  isErrorDialogOpen: boolean;
  dismissErrorDialog: () => void;
  reopenErrorDialog: () => void;

  isExportDialogOpen: boolean;
  openExportDialog: () => void;
  closeExportDialog: () => void;

  valueEditor: ValueEditorState;
  openValueEditor: (rowIndex: number, columnName: string, value: string | null) => void;
  closeValueEditor: () => void;
}

const VALUE_EDITOR_INITIAL: ValueEditorState = {
  isOpen: false,
  rowIndex: 0,
  columnName: '',
  value: null,
};

/**
 * ResultGrid の dialog open/close state を集約する管理層 hook。
 * Error / Export / ValueEditor の 3 系統を保持。
 *
 * 運用ルール: callback (e.g. saveValueEditor) はビジネスロジックとの結合点のため
 * 本 hook には含めず、呼び出し側 (ResultGrid) で組み立てる。
 *
 * DML preview dialog は useGridEdit 側で既に管理されているため対象外。
 */
export function useGridDialogState({ error }: UseGridDialogStateArgs): UseGridDialogStateResult {
  const {
    isOpen: isErrorDialogOpen,
    dismiss: dismissErrorDialog,
    reopen: reopenErrorDialog,
  } = useEphemeralOpen(error);

  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [valueEditor, setValueEditor] = useState<ValueEditorState>(VALUE_EDITOR_INITIAL);

  const openExportDialog = useCallback(() => setIsExportDialogOpen(true), []);
  const closeExportDialog = useCallback(() => setIsExportDialogOpen(false), []);

  const openValueEditor = useCallback(
    (rowIndex: number, columnName: string, value: string | null) => {
      setValueEditor({ isOpen: true, rowIndex, columnName, value });
    },
    []
  );
  const closeValueEditor = useCallback(
    () => setValueEditor((prev) => ({ ...prev, isOpen: false })),
    []
  );

  return {
    isErrorDialogOpen,
    dismissErrorDialog,
    reopenErrorDialog,
    isExportDialogOpen,
    openExportDialog,
    closeExportDialog,
    valueEditor,
    openValueEditor,
    closeValueEditor,
  };
}
