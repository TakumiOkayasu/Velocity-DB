import { useEffect, useState } from 'react';
import { useSessionStore } from '../store/sessionStore';

export interface UsePanelLayoutStateParams {
  activeQueryId: string | null;
  hasActiveResult: boolean;
  isDataView: boolean;
}

export interface UsePanelLayoutStateResult {
  leftPanelWidth: number;
  setLeftPanelWidth: (width: number) => void;
  bottomPanelHeight: number;
  setBottomPanelHeight: (height: number) => void;
  isLeftPanelVisible: boolean;
  setIsLeftPanelVisible: (visible: boolean) => void;
  isBottomPanelVisible: boolean;
  setIsBottomPanelVisible: (visible: boolean) => void;
  shouldShowBottomPanel: boolean;
}

/**
 * MainLayout の panel 幅 / 表示 state を集約する管理層 hook。
 * leftPanelWidth / bottomPanelHeight / isLeftPanelVisible は sessionStore に永続化する。
 * isBottomPanelVisible は意図的に永続化せず、起動時は常に非表示で始まり、クエリ結果取得を
 * 契機に auto-show する (data view モード時は除外)。
 */
export function usePanelLayoutState(params: UsePanelLayoutStateParams): UsePanelLayoutStateResult {
  const { activeQueryId, hasActiveResult, isDataView } = params;

  const savedLeftPanelWidth = useSessionStore((state) => state.leftPanelWidth);
  const savedBottomPanelHeight = useSessionStore((state) => state.bottomPanelHeight);
  const savedLeftPanelVisible = useSessionStore((state) => state.isLeftPanelVisible);
  const saveLeftPanelWidth = useSessionStore((state) => state.setLeftPanelWidth);
  const saveBottomPanelHeight = useSessionStore((state) => state.setBottomPanelHeight);
  const saveLeftPanelVisible = useSessionStore((state) => state.setLeftPanelVisible);

  const [leftPanelWidth, setLeftPanelWidth] = useState(savedLeftPanelWidth);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(savedBottomPanelHeight);
  const [isLeftPanelVisible, setIsLeftPanelVisible] = useState(savedLeftPanelVisible);
  const [isBottomPanelVisible, setIsBottomPanelVisible] = useState(false);

  useEffect(() => {
    if (activeQueryId && hasActiveResult && !isDataView) {
      setIsBottomPanelVisible(true);
    }
  }, [activeQueryId, hasActiveResult, isDataView]);

  useEffect(() => {
    saveLeftPanelWidth(leftPanelWidth);
  }, [leftPanelWidth, saveLeftPanelWidth]);

  useEffect(() => {
    saveBottomPanelHeight(bottomPanelHeight);
  }, [bottomPanelHeight, saveBottomPanelHeight]);

  useEffect(() => {
    saveLeftPanelVisible(isLeftPanelVisible);
  }, [isLeftPanelVisible, saveLeftPanelVisible]);

  const shouldShowBottomPanel = isBottomPanelVisible && !isDataView;

  return {
    leftPanelWidth,
    setLeftPanelWidth,
    bottomPanelHeight,
    setBottomPanelHeight,
    isLeftPanelVisible,
    setIsLeftPanelVisible,
    isBottomPanelVisible,
    setIsBottomPanelVisible,
    shouldShowBottomPanel,
  };
}
