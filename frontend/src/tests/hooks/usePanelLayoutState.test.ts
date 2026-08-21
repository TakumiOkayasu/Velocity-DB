import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vite-plus/test';
import {
  type UsePanelLayoutStateParams,
  usePanelLayoutState,
} from '../../hooks/usePanelLayoutState';
import { useSessionStore } from '../../store/sessionStore';

const DEFAULT_PARAMS: UsePanelLayoutStateParams = {
  activeQueryId: null,
  hasActiveResult: false,
  isDataView: false,
};

describe('usePanelLayoutState', () => {
  beforeEach(() => {
    localStorage.clear();
    useSessionStore.setState({
      leftPanelWidth: 320,
      bottomPanelHeight: 200,
      isLeftPanelVisible: true,
      isBottomPanelVisible: false,
    });
  });

  it('初期状態 → sessionStore の永続値で width/height/leftVisible が初期化され bottomVisible は false', () => {
    useSessionStore.setState({
      leftPanelWidth: 280,
      bottomPanelHeight: 150,
      isLeftPanelVisible: false,
    });

    const { result } = renderHook(() => usePanelLayoutState(DEFAULT_PARAMS));

    expect(result.current.leftPanelWidth).toBe(280);
    expect(result.current.bottomPanelHeight).toBe(150);
    expect(result.current.isLeftPanelVisible).toBe(false);
    expect(result.current.isBottomPanelVisible).toBe(false);
    expect(result.current.shouldShowBottomPanel).toBe(false);
  });

  it('setLeftPanelWidth → ローカル state 更新と sessionStore への永続化', () => {
    const { result } = renderHook(() => usePanelLayoutState(DEFAULT_PARAMS));

    act(() => {
      result.current.setLeftPanelWidth(420);
    });

    expect(result.current.leftPanelWidth).toBe(420);
    expect(useSessionStore.getState().leftPanelWidth).toBe(420);
  });

  it('setBottomPanelHeight → ローカル state 更新と sessionStore への永続化', () => {
    const { result } = renderHook(() => usePanelLayoutState(DEFAULT_PARAMS));

    act(() => {
      result.current.setBottomPanelHeight(350);
    });

    expect(result.current.bottomPanelHeight).toBe(350);
    expect(useSessionStore.getState().bottomPanelHeight).toBe(350);
  });

  it('setIsLeftPanelVisible → ローカル state 更新と sessionStore への永続化', () => {
    const { result } = renderHook(() => usePanelLayoutState(DEFAULT_PARAMS));

    act(() => {
      result.current.setIsLeftPanelVisible(false);
    });

    expect(result.current.isLeftPanelVisible).toBe(false);
    expect(useSessionStore.getState().isLeftPanelVisible).toBe(false);
  });

  it('setIsBottomPanelVisible → bottom panel は永続化されない (sessionStore は変化しない)', () => {
    const { result } = renderHook(() => usePanelLayoutState(DEFAULT_PARAMS));
    const initialPersisted = useSessionStore.getState().isBottomPanelVisible;

    act(() => {
      result.current.setIsBottomPanelVisible(true);
    });

    expect(result.current.isBottomPanelVisible).toBe(true);
    expect(useSessionStore.getState().isBottomPanelVisible).toBe(initialPersisted);
  });

  it('auto-show: activeQueryId + hasActiveResult + !isDataView → isBottomPanelVisible が true', () => {
    const { result, rerender } = renderHook(
      (props: UsePanelLayoutStateParams) => usePanelLayoutState(props),
      { initialProps: DEFAULT_PARAMS }
    );

    expect(result.current.isBottomPanelVisible).toBe(false);

    rerender({ activeQueryId: 'q1', hasActiveResult: true, isDataView: false });

    expect(result.current.isBottomPanelVisible).toBe(true);
    expect(result.current.shouldShowBottomPanel).toBe(true);
  });

  it('auto-show 抑止: isDataView=true の時は結果取得しても auto-show しない', () => {
    const { result, rerender } = renderHook(
      (props: UsePanelLayoutStateParams) => usePanelLayoutState(props),
      { initialProps: DEFAULT_PARAMS }
    );

    rerender({ activeQueryId: 'q1', hasActiveResult: true, isDataView: true });

    expect(result.current.isBottomPanelVisible).toBe(false);
    expect(result.current.shouldShowBottomPanel).toBe(false);
  });

  it('auto-show 抑止: hasActiveResult=false の時は auto-show しない', () => {
    const { result, rerender } = renderHook(
      (props: UsePanelLayoutStateParams) => usePanelLayoutState(props),
      { initialProps: DEFAULT_PARAMS }
    );

    rerender({ activeQueryId: 'q1', hasActiveResult: false, isDataView: false });

    expect(result.current.isBottomPanelVisible).toBe(false);
  });

  it('shouldShowBottomPanel: isBottomPanelVisible=true でも isDataView=true なら false', () => {
    const { result, rerender } = renderHook(
      (props: UsePanelLayoutStateParams) => usePanelLayoutState(props),
      { initialProps: DEFAULT_PARAMS }
    );

    act(() => {
      result.current.setIsBottomPanelVisible(true);
    });
    expect(result.current.shouldShowBottomPanel).toBe(true);

    rerender({ activeQueryId: 'q1', hasActiveResult: false, isDataView: true });

    expect(result.current.isBottomPanelVisible).toBe(true);
    expect(result.current.shouldShowBottomPanel).toBe(false);
  });
});
