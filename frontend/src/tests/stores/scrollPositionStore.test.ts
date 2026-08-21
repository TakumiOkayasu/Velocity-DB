import { beforeEach, describe, expect, it } from 'vite-plus/test';
import { useScrollPositionStore } from '../../store/scrollPositionStore';

describe('scrollPositionStore', () => {
  beforeEach(() => {
    useScrollPositionStore.setState({ positions: {} });
  });

  it('savePosition で保存した値が getPosition で取得できる', () => {
    useScrollPositionStore.getState().savePosition('q1', { top: 120, left: 40 });
    expect(useScrollPositionStore.getState().getPosition('q1')).toEqual({ top: 120, left: 40 });
  });

  it('未保存の queryId は undefined を返す', () => {
    expect(useScrollPositionStore.getState().getPosition('unknown')).toBeUndefined();
  });

  it('同一 queryId の再保存で上書きされる', () => {
    const { savePosition, getPosition } = useScrollPositionStore.getState();
    savePosition('q1', { top: 10, left: 0 });
    savePosition('q1', { top: 300, left: 50 });
    expect(getPosition('q1')).toEqual({ top: 300, left: 50 });
  });

  it('複数 queryId が独立して保持される', () => {
    const { savePosition, getPosition } = useScrollPositionStore.getState();
    savePosition('q1', { top: 10, left: 0 });
    savePosition('q2', { top: 999, left: 77 });
    expect(getPosition('q1')).toEqual({ top: 10, left: 0 });
    expect(getPosition('q2')).toEqual({ top: 999, left: 77 });
  });

  it('clearPosition で特定 queryId のみ削除される', () => {
    const { savePosition, getPosition, clearPosition } = useScrollPositionStore.getState();
    savePosition('q1', { top: 10, left: 0 });
    savePosition('q2', { top: 999, left: 77 });
    clearPosition('q1');
    expect(getPosition('q1')).toBeUndefined();
    expect(getPosition('q2')).toEqual({ top: 999, left: 77 });
  });

  it('未保存の queryId に対する clearPosition は冪等 (エラーにならない)', () => {
    expect(() => useScrollPositionStore.getState().clearPosition('missing')).not.toThrow();
  });
});
