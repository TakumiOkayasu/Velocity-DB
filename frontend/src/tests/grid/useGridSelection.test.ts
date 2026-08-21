import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';
import { useGridSelection } from '../../components/grid/hooks/useGridSelection';

function makeRefs(rowsLength: number, columnOrder: string[]) {
  return {
    rowsLengthRef: { current: rowsLength },
    columnOrderRef: { current: columnOrder },
  };
}

describe('useGridSelection', () => {
  describe('selectCell', () => {
    it('単一セルを選択する (selectedRows/selectedColumns がそれぞれ 1 要素)', () => {
      const { rowsLengthRef, columnOrderRef } = makeRefs(5, ['a', 'b', 'c']);
      const { result } = renderHook(() => useGridSelection(rowsLengthRef, columnOrderRef));

      act(() => result.current.selectCell(2, 'b'));

      expect(Array.from(result.current.selectedRows)).toEqual([2]);
      expect(Array.from(result.current.selectedColumns)).toEqual(['b']);
    });
  });

  describe('rangeCellSelect (Shift+クリックで矩形選択)', () => {
    it('同一列内の行レンジを選択する (既存挙動)', () => {
      const { rowsLengthRef, columnOrderRef } = makeRefs(5, ['a', 'b', 'c']);
      const { result } = renderHook(() => useGridSelection(rowsLengthRef, columnOrderRef));

      act(() => result.current.selectCell(1, 'b'));
      act(() => result.current.rangeCellSelect(3, 'b'));

      expect(Array.from(result.current.selectedRows).sort()).toEqual([1, 2, 3]);
      expect(Array.from(result.current.selectedColumns)).toEqual(['b']);
    });

    it('異なる列にまたがる矩形 (行×列) を選択する', () => {
      const { rowsLengthRef, columnOrderRef } = makeRefs(5, ['a', 'b', 'c', 'd']);
      const { result } = renderHook(() => useGridSelection(rowsLengthRef, columnOrderRef));

      act(() => result.current.selectCell(1, 'b'));
      act(() => result.current.rangeCellSelect(3, 'd'));

      expect(Array.from(result.current.selectedRows).sort()).toEqual([1, 2, 3]);
      expect(Array.from(result.current.selectedColumns).sort()).toEqual(['b', 'c', 'd']);
    });

    it('逆方向 (右下 → 左上) の矩形選択も対応する', () => {
      const { rowsLengthRef, columnOrderRef } = makeRefs(5, ['a', 'b', 'c', 'd']);
      const { result } = renderHook(() => useGridSelection(rowsLengthRef, columnOrderRef));

      act(() => result.current.selectCell(3, 'c'));
      act(() => result.current.rangeCellSelect(1, 'a'));

      expect(Array.from(result.current.selectedRows).sort()).toEqual([1, 2, 3]);
      expect(Array.from(result.current.selectedColumns).sort()).toEqual(['a', 'b', 'c']);
    });

    it('アンカー未設定時は単一セル選択にフォールバック', () => {
      const { rowsLengthRef, columnOrderRef } = makeRefs(5, ['a', 'b', 'c']);
      const { result } = renderHook(() => useGridSelection(rowsLengthRef, columnOrderRef));

      act(() => result.current.rangeCellSelect(2, 'b'));

      expect(Array.from(result.current.selectedRows)).toEqual([2]);
      expect(Array.from(result.current.selectedColumns)).toEqual(['b']);
    });

    it('システム列は選択対象外 (__rowIndex 等が列レンジに含まれても除外)', () => {
      const { rowsLengthRef, columnOrderRef } = makeRefs(5, ['__rowIndex', 'a', 'b', 'c']);
      const { result } = renderHook(() => useGridSelection(rowsLengthRef, columnOrderRef));

      act(() => result.current.selectCell(0, 'a'));
      act(() => result.current.rangeCellSelect(1, 'c'));

      expect(Array.from(result.current.selectedColumns).sort()).toEqual(['a', 'b', 'c']);
    });
  });
});
