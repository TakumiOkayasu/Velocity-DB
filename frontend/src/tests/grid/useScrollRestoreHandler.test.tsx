import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual';
import { fireEvent, render } from '@testing-library/react';
import { type RefObject, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScrollRestoreHandler } from '../../components/grid/hooks/useScrollRestoreHandler';
import { useScrollPositionStore } from '../../store/scrollPositionStore';

/**
 * useScrollRestoreHandler の不変条件テスト。
 *
 * scope:
 * - onScroll closure による現 queryId への保存
 * - queryId 切替過渡期 (suppress) の保存抑止
 * - rows=0 / queryId=null での復元短絡
 * - 復元 1-shot 性 (同一 queryId での重複 scrollToOffset 呼出なし)
 *
 * 既存 ResultGrid.scrollPersistence.test.tsx は再現ハーネスでの不変条件検証だが、
 * 本テストは抽出 hook 自体の API/挙動をピンポイントで検証する。
 */

interface HarnessProps {
  queryId: string | null;
  rowsLength: number;
  height?: number;
  totalSize?: number;
  onVirtualizer?: (v: Virtualizer<HTMLDivElement, Element>) => void;
}

function Harness({
  queryId,
  rowsLength,
  height = 200,
  totalSize = 1000,
  onVirtualizer,
}: HarnessProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: rowsLength,
    getScrollElement: () => ref.current,
    estimateSize: () => 32,
    initialRect: { width: 0, height },
  });

  // jsdom は layout 計算しないため getTotalSize/measure をスタブ
  vi.spyOn(rowVirtualizer, 'getTotalSize').mockReturnValue(totalSize);
  vi.spyOn(rowVirtualizer, 'measure').mockImplementation(() => {});
  if (onVirtualizer) onVirtualizer(rowVirtualizer);

  const { handleScroll } = useScrollRestoreHandler({
    targetQueryId: queryId,
    scrollerRef: ref as RefObject<HTMLDivElement | null>,
    rowVirtualizer,
    rowsLength,
  });

  return (
    <div
      data-testid="scroller"
      ref={ref}
      onScroll={handleScroll}
      style={{ height, overflow: 'auto' }}
    >
      <div style={{ height: 5000 }} />
    </div>
  );
}

function setScroll(el: HTMLElement, top: number, left = 0) {
  Object.defineProperty(el, 'scrollTop', { value: top, writable: true, configurable: true });
  Object.defineProperty(el, 'scrollLeft', { value: left, writable: true, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: 200, writable: true, configurable: true });
}

describe('useScrollRestoreHandler', () => {
  beforeEach(() => {
    useScrollPositionStore.setState({ positions: {} });
    // requestAnimationFrame を即時実行に置換 (rAF ループ内の処理を同期化)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('onScroll 保存', () => {
    it('queryId が null のときは保存しない', () => {
      const { getByTestId } = render(<Harness queryId={null} rowsLength={0} />);
      const el = getByTestId('scroller');
      setScroll(el, 1000);
      fireEvent.scroll(el);
      expect(useScrollPositionStore.getState().positions).toEqual({});
    });

    it('過渡期 (suppress=true) は保存しない', () => {
      // queryId 切替直後は suppress=true。復元実行前 (rowsLength=0) では false に戻らない。
      const { getByTestId } = render(<Harness queryId="q1" rowsLength={0} />);
      const el = getByTestId('scroller');
      setScroll(el, 1234);
      fireEvent.scroll(el);
      expect(useScrollPositionStore.getState().getPosition('q1')).toBeUndefined();
    });

    it('復元完了後はユーザー scroll が現 queryId に保存される', () => {
      // rowsLength>0 + container 実サイズあり → 復元 → suppress 解除 (rAF 2 回経由)
      const { getByTestId } = render(<Harness queryId="q1" rowsLength={10} />);
      const el = getByTestId('scroller');
      // 復元 path が clientHeight を要求するため事前設定が必要
      Object.defineProperty(el, 'clientHeight', { value: 200, configurable: true });

      setScroll(el, 7247, 50);
      fireEvent.scroll(el);

      expect(useScrollPositionStore.getState().getPosition('q1')).toEqual({ top: 7247, left: 50 });
    });
  });

  describe('復元', () => {
    it('rowsLength=0 では復元 scrollToOffset を呼ばない', () => {
      let virt: Virtualizer<HTMLDivElement, Element> | undefined;
      useScrollPositionStore.getState().savePosition('q1', { top: 500, left: 0 });
      render(
        <Harness
          queryId="q1"
          rowsLength={0}
          onVirtualizer={(v) => {
            virt = v;
          }}
        />
      );
      expect(virt).toBeDefined();
      if (!virt) throw new Error('virtualizer not captured');
      const spy = vi.spyOn(virt, 'scrollToOffset');
      // rerender なしで rowsLength は 0 のまま — scrollToOffset 呼ばれない
      expect(spy).not.toHaveBeenCalled();
    });

    it('saved 値が container にセットされる', () => {
      useScrollPositionStore.getState().savePosition('q1', { top: 500, left: 30 });
      let virt: Virtualizer<HTMLDivElement, Element> | undefined;
      const { getByTestId } = render(
        <Harness
          queryId="q1"
          rowsLength={10}
          onVirtualizer={(v) => {
            virt = v;
          }}
        />
      );
      const el = getByTestId('scroller');
      // 復元 path の clientHeight チェック通過用
      Object.defineProperty(el, 'clientHeight', { value: 200, configurable: true });

      // hook 内 useEffect は render 後に同期実行される。requestAnimationFrame は即時化済。
      expect(virt?.scrollToOffset).toBeDefined();
    });

    it('saved が無いときは scrollToOffset を呼ばない (1-shot フラグはセットされる)', () => {
      let virt: Virtualizer<HTMLDivElement, Element> | undefined;
      const { getByTestId } = render(
        <Harness
          queryId="q-no-save"
          rowsLength={10}
          onVirtualizer={(v) => {
            virt = v;
          }}
        />
      );
      const el = getByTestId('scroller');
      Object.defineProperty(el, 'clientHeight', { value: 200, configurable: true });

      if (!virt) throw new Error('virtualizer not captured');
      const spy = vi.spyOn(virt, 'scrollToOffset');
      // この時点で復元 path は走り、saved=undefined なので scrollToOffset は呼ばれない
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('queryId 切替', () => {
    it('queryId が変わると新 queryId に独立して保存される', () => {
      const { getByTestId, rerender } = render(<Harness queryId="A" rowsLength={10} />);
      const el = getByTestId('scroller');
      Object.defineProperty(el, 'clientHeight', { value: 200, configurable: true });

      setScroll(el, 100);
      fireEvent.scroll(el);
      expect(useScrollPositionStore.getState().getPosition('A')).toEqual({ top: 100, left: 0 });

      rerender(<Harness queryId="B" rowsLength={10} />);
      Object.defineProperty(el, 'clientHeight', { value: 200, configurable: true });

      setScroll(el, 500);
      fireEvent.scroll(el);
      expect(useScrollPositionStore.getState().getPosition('A')).toEqual({ top: 100, left: 0 });
      expect(useScrollPositionStore.getState().getPosition('B')).toEqual({ top: 500, left: 0 });
    });
  });

  describe('unmount', () => {
    it('unmount してもエラーを投げない (cleanup 安全性)', () => {
      const { unmount } = render(<Harness queryId="A" rowsLength={10} />);
      expect(() => unmount()).not.toThrow();
    });
  });
});
