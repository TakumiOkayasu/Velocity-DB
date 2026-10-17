import type { Virtualizer } from '@tanstack/react-virtual';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { type RefObject, StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { useScrollRestoreHandler } from '../../components/grid/hooks/useScrollRestoreHandler';
import { useScrollPositionStore } from '../../store/scrollPositionStore';

// 1 回の flush は 1 フレーム。入れ子の rAF は同一フレーム内に実行しない。
let frames: Map<number, FrameRequestCallback>;
let nextFrameId: number;
function advanceFrames(count = 1) {
  for (let i = 0; i < count; i++) {
    act(() => {
      for (const id of [...frames.keys()]) {
        const callback = frames.get(id);
        frames.delete(id);
        callback?.(0);
      }
    });
  }
}

interface HarnessProps {
  queryId: string | null;
  rowsLength?: number;
  mounted?: boolean;
  scrollerRef: RefObject<HTMLDivElement | null>;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
}

function Harness({
  queryId,
  rowsLength = 100,
  mounted = true,
  scrollerRef,
  virtualizer,
}: HarnessProps) {
  const { handleScroll, setScrollerRef } = useScrollRestoreHandler({
    targetQueryId: queryId,
    scrollerRef,
    rowVirtualizer: virtualizer,
    rowsLength,
  });
  return mounted ? (
    <div data-testid="scroller" ref={setScrollerRef} onScroll={handleScroll} />
  ) : null;
}

function createHarness() {
  const scrollerRef: RefObject<HTMLDivElement | null> = { current: null };
  const measure = vi.fn();
  const getTotalSize = vi.fn(() => 3200);
  const scrollToOffset = vi.fn((top: number) => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = top;
  });
  // virtualizer の API だけをスタブ化し、React の effect / ref は実物を使う。
  const virtualizer = { measure, getTotalSize, scrollToOffset } as unknown as Virtualizer<
    HTMLDivElement,
    Element
  >;
  return { scrollerRef, virtualizer, measure, getTotalSize, scrollToOffset };
}

function setHeight(el: HTMLElement, height = 200) {
  Object.defineProperty(el, 'clientHeight', { value: height, configurable: true });
}

function scroll(el: HTMLElement, top: number, left = 0) {
  el.scrollTop = top;
  el.scrollLeft = left;
  fireEvent.scroll(el);
}

const position = (id: string) => useScrollPositionStore.getState().getPosition(id);
const save = (id: string, top: number, left = 0) =>
  useScrollPositionStore.getState().savePosition(id, { top, left });

describe('useScrollRestoreHandler', () => {
  beforeEach(() => {
    useScrollPositionStore.setState({ positions: {} });
    frames = new Map();
    nextFrameId = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++nextFrameId;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('縦横位置を復元し、過渡期のイベントを抑止してからスクロール保存を再開する', () => {
    const props = createHarness();
    save('A', 800, 120);
    const { getByTestId } = render(<Harness {...props} queryId="A" />);
    const el = getByTestId('scroller');
    setHeight(el);
    scroll(el, 0);
    expect(position('A')).toEqual({ top: 800, left: 120 });
    advanceFrames();
    expect(props.scrollToOffset).toHaveBeenCalledExactlyOnceWith(800);
    expect([el.scrollTop, el.scrollLeft]).toEqual([800, 120]);
    scroll(el, 0);
    advanceFrames();
    scroll(el, 0);
    expect(position('A')).toEqual({ top: 800, left: 120 });
    advanceFrames();
    scroll(el, 900, 50);
    expect(position('A')).toEqual({ top: 900, left: 50 });
  });

  it.each([0, 1])('解除用 rAF を %i 回進めた旧タブが B の保存抑止を解除しない', (elapsed) => {
    const props = createHarness();
    save('A', 800);
    save('B', 600, 30);
    const { getByTestId, rerender } = render(<Harness {...props} queryId="A" />);
    const el = getByTestId('scroller');
    setHeight(el);
    advanceFrames(1 + elapsed);
    setHeight(el, 0);
    rerender(<Harness {...props} queryId="B" />);
    advanceFrames(3);
    scroll(el, 0);
    expect(position('B')).toEqual({ top: 600, left: 30 });
    setHeight(el);
    advanceFrames(3);
    expect([el.scrollTop, el.scrollLeft]).toEqual([600, 30]);
    scroll(el, 700, 40);
    expect(position('A')).toEqual({ top: 800, left: 0 });
    expect(position('B')).toEqual({ top: 700, left: 40 });
  });

  it('高速な A → B → A でも新しい A の復元待ち中は保存しない', () => {
    const props = createHarness();
    save('A', 800);
    save('B', 600);
    const { getByTestId, rerender } = render(<Harness {...props} queryId="A" />);
    const el = getByTestId('scroller');
    setHeight(el);
    advanceFrames();
    rerender(<Harness {...props} queryId="B" />);
    advanceFrames();
    setHeight(el, 0);
    rerender(<Harness {...props} queryId="A" />);
    advanceFrames(3);
    scroll(el, 0);
    expect(position('A')).toEqual({ top: 800, left: 0 });
    setHeight(el);
    advanceFrames(3);
    expect(el.scrollTop).toBe(800);
  });

  it('未保存タブは前タブの位置を引き継がず原点に戻る', () => {
    const props = createHarness();
    save('A', 800, 120);
    const { getByTestId, rerender } = render(<Harness {...props} queryId="A" />);
    const el = getByTestId('scroller');
    setHeight(el);
    advanceFrames(3);
    rerender(<Harness {...props} queryId="new" />);
    advanceFrames(3);
    expect([el.scrollTop, el.scrollLeft]).toEqual([0, 0]);
    expect(position('A')).toEqual({ top: 800, left: 120 });
  });

  it.each([0, 1])('行追加後は再復元せず保存抑止の解除を完了する（%i フレーム）', (elapsed) => {
    const props = createHarness();
    save('A', 800);
    const { getByTestId, rerender } = render(<Harness {...props} queryId="A" />);
    const el = getByTestId('scroller');
    setHeight(el);
    advanceFrames(1 + elapsed);
    rerender(<Harness {...props} queryId="A" rowsLength={200} />);
    advanceFrames(3);
    expect(props.scrollToOffset).toHaveBeenCalledExactlyOnceWith(800);
    scroll(el, 900);
    expect(position('A')?.top).toBe(900);
  });

  it('行と有効な viewport が揃ってから復元する', () => {
    const props = createHarness();
    save('A', 800);
    const { getByTestId, rerender } = render(<Harness {...props} queryId="A" rowsLength={0} />);
    const el = getByTestId('scroller');
    advanceFrames(3);
    expect(props.scrollToOffset).not.toHaveBeenCalled();
    rerender(<Harness {...props} queryId="A" />);
    advanceFrames(3);
    scroll(el, 0);
    expect(props.scrollToOffset).not.toHaveBeenCalled();
    expect(position('A')?.top).toBe(800);
    setHeight(el);
    advanceFrames(3);
    expect(props.scrollToOffset).toHaveBeenCalledExactlyOnceWith(800);
  });

  it('仮想行のサイズを待ち、unmount でリトライを解除する', () => {
    const props = createHarness();
    props.getTotalSize.mockReturnValue(0);
    const { getByTestId, unmount } = render(<Harness {...props} queryId="A" />);
    setHeight(getByTestId('scroller'));
    advanceFrames(2);
    expect(props.scrollToOffset).not.toHaveBeenCalled();
    unmount();
    expect(frames.size).toBe(0);
  });

  it('loading でスクローラーが再生成された同じ queryId も復元する', () => {
    const props = createHarness();
    save('A', 800, 120);
    const { getByTestId, rerender } = render(<Harness {...props} queryId="A" />);
    const first = getByTestId('scroller');
    setHeight(first);
    advanceFrames(3);
    scroll(first, 900, 140);
    rerender(<Harness {...props} queryId="A" mounted={false} />);
    expect(frames.size).toBe(0);
    rerender(<Harness {...props} queryId="A" />);
    const second = getByTestId('scroller');
    expect(second).not.toBe(first);
    setHeight(second);
    scroll(second, 0);
    expect(position('A')).toEqual({ top: 900, left: 140 });
    advanceFrames(3);
    expect([second.scrollTop, second.scrollLeft]).toEqual([900, 140]);
    expect(props.scrollToOffset).toHaveBeenCalledTimes(2);
  });

  it('復元済みの表がフィルターで 0 行になっても保存抑止を解除する', () => {
    const props = createHarness();
    save('A', 800);
    const { getByTestId, rerender } = render(<Harness {...props} queryId="A" />);
    const el = getByTestId('scroller');
    setHeight(el);
    advanceFrames();
    rerender(<Harness {...props} queryId="A" rowsLength={0} />);
    advanceFrames(3);
    expect(props.scrollToOffset).toHaveBeenCalledExactlyOnceWith(800);
    scroll(el, 0, 20);
    expect(position('A')).toEqual({ top: 0, left: 20 });
  });

  it('仮想行のサイズが確定したら復元する', () => {
    const props = createHarness();
    props.getTotalSize.mockReturnValue(0);
    save('A', 800);
    const { getByTestId } = render(<Harness {...props} queryId="A" />);
    const el = getByTestId('scroller');
    setHeight(el);
    advanceFrames(3);
    expect(props.scrollToOffset).not.toHaveBeenCalled();
    props.getTotalSize.mockReturnValue(3200);
    advanceFrames(3);
    expect(el.scrollTop).toBe(800);
    expect(props.scrollToOffset).toHaveBeenCalledExactlyOnceWith(800);
  });

  it('viewport 待機の上限を超えたら保存抑止を解除する', () => {
    const props = createHarness();
    const { getByTestId } = render(<Harness {...props} queryId="A" />);
    advanceFrames(31);
    expect(frames.size).toBe(0);
    scroll(getByTestId('scroller'), 100);
    expect(position('A')?.top).toBe(100);
  });

  it('queryId が null の場合は復元も保存もしない', () => {
    const props = createHarness();
    const { getByTestId } = render(<Harness {...props} queryId={null} />);
    setHeight(getByTestId('scroller'));
    advanceFrames(3);
    scroll(getByTestId('scroller'), 100);
    expect(props.scrollToOffset).not.toHaveBeenCalled();
    expect(useScrollPositionStore.getState().positions).toEqual({});
  });

  it.each([0, 1, 2])('%i フレーム後の unmount で全ての予約済み rAF を解除する', (elapsed) => {
    const props = createHarness();
    const { getByTestId, unmount } = render(<Harness {...props} queryId="A" />);
    setHeight(getByTestId('scroller'));
    advanceFrames(elapsed);
    unmount();
    expect(frames.size).toBe(0);
    advanceFrames(3);
    expect(useScrollPositionStore.getState().positions).toEqual({});
  });

  it('StrictMode の setup / cleanup 再実行後も復元できる', () => {
    const props = createHarness();
    save('A', 800, 120);
    const { getByTestId } = render(
      <StrictMode>
        <Harness {...props} queryId="A" />
      </StrictMode>
    );
    const el = getByTestId('scroller');
    setHeight(el);
    advanceFrames(3);
    expect(props.scrollToOffset).toHaveBeenCalledExactlyOnceWith(800);
    scroll(el, 900, 30);
    expect(position('A')).toEqual({ top: 900, left: 30 });
  });
});
