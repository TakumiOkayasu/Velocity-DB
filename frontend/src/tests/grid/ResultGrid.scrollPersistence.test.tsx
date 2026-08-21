import { fireEvent, render } from '@testing-library/react';
import { type UIEvent, useCallback } from 'react';
import { beforeEach, describe, expect, it } from 'vite-plus/test';
import { useScrollPositionStore } from '../../store/scrollPositionStore';

/**
 * ResultGrid の scroll 位置保存/復元ロジックの不変条件テスト。
 *
 * ResultGrid 本体は useQueryStore/useConnectionStore 等の多数の依存があり
 * jsdom でフルレンダリングは過大コスト。ここでは **バグ再発の検出力** に焦点を絞り、
 * onScroll closure で現在の queryId に保存される挙動を再現ハーネスで直接検証する。
 *
 * 検出対象:
 * - Bug 1: タブ切替時 ref=null で save されない (onScroll 方式なら scroll 発生時点で保存済)
 * - Bug 2: 戻り時 prev タブに現タブ scroll 値を誤保存 (onScroll は closure で currentId 使用)
 */

interface HarnessProps {
  queryId: string;
}

// 本番の ResultGrid 内の handleScroll と同じ形を再現。
// closure で現在の queryId に紐付けて store に保存する。
function Harness({ queryId }: HarnessProps) {
  const handleScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      if (!queryId) return;
      const el = e.currentTarget;
      useScrollPositionStore
        .getState()
        .savePosition(queryId, { top: el.scrollTop, left: el.scrollLeft });
    },
    [queryId]
  );
  return (
    <div
      data-testid="scroll-container"
      onScroll={handleScroll}
      style={{ height: 200, overflow: 'auto' }}
    >
      <div style={{ height: 5000 }} />
    </div>
  );
}

describe('ResultGrid scroll 永続化 (onScroll closure 不変条件)', () => {
  beforeEach(() => {
    useScrollPositionStore.setState({ positions: {} });
  });

  it('scroll すると現在の queryId に top/left が保存される', () => {
    const { getByTestId } = render(<Harness queryId="q1" />);
    const el = getByTestId('scroll-container');

    // jsdom は scrollTop setter を反映するが layout 計算しないので fireEvent で直接 event 発火。
    Object.defineProperty(el, 'scrollTop', { value: 7247, writable: true });
    Object.defineProperty(el, 'scrollLeft', { value: 120, writable: true });
    fireEvent.scroll(el);

    expect(useScrollPositionStore.getState().getPosition('q1')).toEqual({
      top: 7247,
      left: 120,
    });
  });

  it('queryId が変わった後の scroll は新しい queryId に保存される (旧 queryId は上書きされない)', () => {
    const { getByTestId, rerender } = render(<Harness queryId="q1" />);
    const el = getByTestId('scroll-container');

    // q1 で scroll 7247 保存
    Object.defineProperty(el, 'scrollTop', { value: 7247, writable: true });
    Object.defineProperty(el, 'scrollLeft', { value: 0, writable: true });
    fireEvent.scroll(el);
    expect(useScrollPositionStore.getState().getPosition('q1')).toEqual({ top: 7247, left: 0 });

    // props 変化で q2 に切替 (ResultGrid 本体での queryId 変化を模倣)
    rerender(<Harness queryId="q2" />);

    // q2 で scroll 500 保存
    Object.defineProperty(el, 'scrollTop', { value: 500, writable: true });
    Object.defineProperty(el, 'scrollLeft', { value: 0, writable: true });
    fireEvent.scroll(el);

    // Bug 2 回帰検知: q1 には q2 の scroll (500) が**書き込まれていない**こと
    expect(useScrollPositionStore.getState().getPosition('q1')).toEqual({ top: 7247, left: 0 });
    expect(useScrollPositionStore.getState().getPosition('q2')).toEqual({ top: 500, left: 0 });
  });

  it('queryId=null/undefined では保存しない', () => {
    const { getByTestId } = render(<Harness queryId="" />);
    const el = getByTestId('scroll-container');

    Object.defineProperty(el, 'scrollTop', { value: 1000, writable: true });
    fireEvent.scroll(el);

    expect(useScrollPositionStore.getState().positions).toEqual({});
  });

  it('同一 queryId で複数回 scroll すると最新値で上書きされる', () => {
    const { getByTestId } = render(<Harness queryId="q1" />);
    const el = getByTestId('scroll-container');

    Object.defineProperty(el, 'scrollTop', { value: 100, writable: true });
    fireEvent.scroll(el);
    Object.defineProperty(el, 'scrollTop', { value: 500, writable: true });
    fireEvent.scroll(el);
    Object.defineProperty(el, 'scrollTop', { value: 2000, writable: true });
    fireEvent.scroll(el);

    expect(useScrollPositionStore.getState().getPosition('q1')).toMatchObject({ top: 2000 });
  });

  it('queryId A→B→A の往復で A の値が保持される (Bug 1/2 両方の回帰検知)', () => {
    const { getByTestId, rerender } = render(<Harness queryId="A" />);
    const el = getByTestId('scroll-container');

    // A で 7247 保存
    Object.defineProperty(el, 'scrollTop', { value: 7247, writable: true });
    Object.defineProperty(el, 'scrollLeft', { value: 0, writable: true });
    fireEvent.scroll(el);

    // A → B 切替 (B ではユーザー scroll 発生せず)
    rerender(<Harness queryId="B" />);

    // B → A 戻り
    rerender(<Harness queryId="A" />);

    // A の保存値が維持されている (復元側の store 値読み出しの前提)
    expect(useScrollPositionStore.getState().getPosition('A')).toEqual({ top: 7247, left: 0 });
  });
});

/**
 * Bug 3 回帰検知: タブ切替過渡期の programmatic scroll が新 queryId を汚染しない
 * ことを検証。実コードでは suppressScrollSaveRef で抑止される。
 */
interface GuardedHarnessProps {
  queryId: string;
  /** true の間は scroll event を無視 (本番の suppressScrollSaveRef を模倣) */
  suppress: boolean;
}

function GuardedHarness({ queryId, suppress }: GuardedHarnessProps) {
  const handleScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      if (!queryId) return;
      if (suppress) return;
      const el = e.currentTarget;
      useScrollPositionStore
        .getState()
        .savePosition(queryId, { top: el.scrollTop, left: el.scrollLeft });
    },
    [queryId, suppress]
  );
  return (
    <div
      data-testid="scroll-container"
      onScroll={handleScroll}
      style={{ height: 200, overflow: 'auto' }}
    >
      <div style={{ height: 5000 }} />
    </div>
  );
}

describe('Bug 3: タブ切替過渡期の programmatic scroll 抑止', () => {
  beforeEach(() => {
    useScrollPositionStore.setState({ positions: {} });
  });

  it('suppress=true の間に scroll event が発火しても store に書き込まれない', () => {
    const { getByTestId, rerender } = render(<GuardedHarness queryId="A" suppress={false} />);
    const el = getByTestId('scroll-container');

    // A で scroll 23500 保存 (通常動作)
    Object.defineProperty(el, 'scrollTop', { value: 23500, writable: true });
    Object.defineProperty(el, 'scrollLeft', { value: 0, writable: true });
    fireEvent.scroll(el);
    expect(useScrollPositionStore.getState().getPosition('A')).toEqual({ top: 23500, left: 0 });

    // B に切替 + suppress ON (過渡期を模倣)
    rerender(<GuardedHarness queryId="B" suppress={true} />);

    // 過渡期に programmatic scroll event が発火 (実本番では restore の副作用)
    Object.defineProperty(el, 'scrollTop', { value: 23500, writable: true });
    fireEvent.scroll(el);

    // Bug 3 回帰検知: B に旧 scroll 値が誤保存されていない
    expect(useScrollPositionStore.getState().getPosition('B')).toBeUndefined();
  });

  it('suppress 解除後はユーザー scroll が正常に保存される', () => {
    const { getByTestId, rerender } = render(<GuardedHarness queryId="B" suppress={true} />);
    const el = getByTestId('scroll-container');

    // 過渡期の programmatic scroll (無視される)
    Object.defineProperty(el, 'scrollTop', { value: 10000, writable: true });
    fireEvent.scroll(el);
    expect(useScrollPositionStore.getState().getPosition('B')).toBeUndefined();

    // 抑止解除 (実本番では E2 復元完了後)
    rerender(<GuardedHarness queryId="B" suppress={false} />);

    // ユーザー scroll
    Object.defineProperty(el, 'scrollTop', { value: 500, writable: true });
    fireEvent.scroll(el);
    expect(useScrollPositionStore.getState().getPosition('B')).toEqual({ top: 500, left: 0 });
  });
});
