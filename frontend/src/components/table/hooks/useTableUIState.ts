import { type Dispatch, type SetStateAction, useState } from 'react';

export type TabType =
  | 'data'
  | 'columns'
  | 'indexes'
  | 'constraints'
  | 'foreignKeys'
  | 'referencingForeignKeys'
  | 'triggers'
  | 'rdbmsInfo'
  | 'source';

export interface UseTableUIStateReturn {
  activeTab: TabType;
  setActiveTab: Dispatch<SetStateAction<TabType>>;
  showLogicalNames: boolean;
  setShowLogicalNames: Dispatch<SetStateAction<boolean>>;
  isLoading: boolean;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
}

export function useTableUIState(): UseTableUIStateReturn {
  const [activeTab, setActiveTab] = useState<TabType>('data');
  const [showLogicalNames, setShowLogicalNames] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return {
    activeTab,
    setActiveTab,
    showLogicalNames,
    setShowLogicalNames,
    isLoading,
    setIsLoading,
    error,
    setError,
  };
}
