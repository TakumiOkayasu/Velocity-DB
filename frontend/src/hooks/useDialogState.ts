import { useCallback, useState } from 'react';

export interface QueryConfirmState {
  isOpen: boolean;
  title: string;
  message: string;
  details?: string;
  isBlocked?: boolean;
}

export interface UseDialogStateResult {
  isConnectionDialogOpen: boolean;
  openConnectionDialog: () => void;
  closeConnectionDialog: () => void;

  isSearchDialogOpen: boolean;
  openSearchDialog: () => void;
  closeSearchDialog: () => void;

  isSettingsDialogOpen: boolean;
  openSettingsDialog: () => void;
  closeSettingsDialog: () => void;

  isSchemaCompareDialogOpen: boolean;
  openSchemaCompareDialog: () => void;
  closeSchemaCompareDialog: () => void;

  queryConfirm: QueryConfirmState;
  openQueryConfirm: (params: Omit<QueryConfirmState, 'isOpen'>) => void;
  closeQueryConfirm: () => void;

  hasOpenDialog: boolean;
}

const QUERY_CONFIRM_INITIAL: QueryConfirmState = {
  isOpen: false,
  title: '',
  message: '',
};

/**
 * MainLayout の dialog open/close state を集約する管理層 hook。
 * Connection / Search / Settings / QueryConfirm の 4 系統を保持し、open/close API と
 * keyboard shortcut 抑止用の hasOpenDialog (queryConfirm を除く 3 dialog の OR) を返す。
 *
 * 運用ルール: callback (e.g. handleConfirmExecute) はビジネスロジックとの結合点のため
 * 本 hook には含めず、呼び出し側 (MainLayout) で組み立てる。
 */
export function useDialogState(): UseDialogStateResult {
  const [isConnectionDialogOpen, setIsConnectionDialogOpen] = useState(false);
  const [isSearchDialogOpen, setIsSearchDialogOpen] = useState(false);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [isSchemaCompareDialogOpen, setIsSchemaCompareDialogOpen] = useState(false);
  const [queryConfirm, setQueryConfirm] = useState<QueryConfirmState>(QUERY_CONFIRM_INITIAL);

  const openConnectionDialog = useCallback(() => setIsConnectionDialogOpen(true), []);
  const closeConnectionDialog = useCallback(() => setIsConnectionDialogOpen(false), []);

  const openSearchDialog = useCallback(() => setIsSearchDialogOpen(true), []);
  const closeSearchDialog = useCallback(() => setIsSearchDialogOpen(false), []);

  const openSettingsDialog = useCallback(() => setIsSettingsDialogOpen(true), []);
  const closeSettingsDialog = useCallback(() => setIsSettingsDialogOpen(false), []);

  const openSchemaCompareDialog = useCallback(() => setIsSchemaCompareDialogOpen(true), []);
  const closeSchemaCompareDialog = useCallback(() => setIsSchemaCompareDialogOpen(false), []);

  const openQueryConfirm = useCallback((params: Omit<QueryConfirmState, 'isOpen'>) => {
    setQueryConfirm({ isOpen: true, ...params });
  }, []);
  const closeQueryConfirm = useCallback(() => setQueryConfirm(QUERY_CONFIRM_INITIAL), []);

  // queryConfirm は意図的に除外: production/read-only 警告ダイアログ open 中も
  // Escape (cancelQuery) を効かせるため、キーボードショートカット抑止対象外とする
  const hasOpenDialog =
    isConnectionDialogOpen ||
    isSearchDialogOpen ||
    isSettingsDialogOpen ||
    isSchemaCompareDialogOpen;

  return {
    isConnectionDialogOpen,
    openConnectionDialog,
    closeConnectionDialog,
    isSearchDialogOpen,
    openSearchDialog,
    closeSearchDialog,
    isSettingsDialogOpen,
    openSettingsDialog,
    closeSettingsDialog,
    isSchemaCompareDialogOpen,
    openSchemaCompareDialog,
    closeSchemaCompareDialog,
    queryConfirm,
    openQueryConfirm,
    closeQueryConfirm,
    hasOpenDialog,
  };
}
