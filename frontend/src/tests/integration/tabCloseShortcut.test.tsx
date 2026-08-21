import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import App from '../../App';
import { useQueryStore } from '../../store/queryStore';

// #391: Ctrl+W 1回押下で複数タブが閉じる二重登録を検知する統合テスト。
// 単体テスト (EditorTabs.test.tsx) は実装詳細 (購読しないこと) しか見ないため、
// App 全体をレンダーして removeQuery の呼び出し回数を直接検証する。
//
// 注意: queries.length の変化では検知できない。二重発火しても 2回目は
// 存在しないidに対する no-op になり -1 で止まってしまうため、spy で回数を見る。
describe('Ctrl+W tab close shortcut (#391)', () => {
  let snapshot: ReturnType<typeof useQueryStore.getState>;

  beforeEach(() => {
    snapshot = { ...useQueryStore.getState() };
  });

  afterEach(() => {
    useQueryStore.setState(snapshot, true);
  });

  it('Ctrl+W 1回で removeQuery は1回だけ呼ばれる (2回呼ばれれば #391 再発)', () => {
    const removeSpy = vi.fn();
    useQueryStore.setState({ removeQuery: removeSpy, activeQueryId: 'q-test-1' });

    render(<App />);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: 'w' }));
    });

    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith('q-test-1');
  });
});
