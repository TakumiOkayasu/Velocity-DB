// Issue #417 回帰防止: TanStack Virtual が outerSize=0 で virtualRows=[] を返す
// "broken state" でも、行が **必ず描画される** ことを検証する。
//
// 既存の単体テスト (sqlIdentifier / GridStatusBar / ResultGrid integration) では
// GridTable 本体は () => null で mock されており、本番の virtualization 経路は
// jsdom + offsetHeight=0 + ResizeObserver no-op で **常に空表示** になっていた。
// このテストは GridTable 本体を実 mount し、virtualRows=[] を強制した時に
// 行が空にならない (フォールバック描画) ことで Issue #417 の再発を捕まえる。
//
// 一次ソース根拠:
//   - @tanstack/virtual-core/dist/esm/index.js:497-516 (calculateRange)
//     measurements.length > 0 && outerSize > 0 ? calculateRange(...) : null
//   - 同 file:341-348 (getSize)  scrollRect.height を返す
//   - 同 file:1-5 (getRect)      element.offsetWidth / offsetHeight を読む
//   - 同 file:802-806 (measure)  itemSizeCache のみクリア (scrollRect は更新しない)
// → WebView2 の flex layout race で offsetHeight=0 の瞬間に観測されると
//   scrollRect={0,0} に固定、rowVirtualizer.measure() でも復旧不能になる。

import { useTable } from '@tanstack/react-table';
import type { VirtualItem } from '@tanstack/react-virtual';
import { cleanup, render, within } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  type GridEditContext,
  type GridSelectionState,
  GridTable,
} from '../../components/grid/GridTable';
import type { RowData } from '../../types/grid';
import {
  type GridColumnDef,
  type GridRow,
  gridTableFeatures,
} from '../../components/grid/tableFeatures';

afterEach(cleanup);

const ROW_HEIGHT = 32;

function makeRowData(count: number): RowData[] {
  return Array.from({ length: count }, (_, i) => ({
    __rowIndex: String(i + 1),
    __originalIndex: String(i),
    name: `name-${i}`,
    age: String(20 + i),
  }));
}

const COLUMNS: GridColumnDef[] = [
  { id: '__rowIndex', header: '#', accessorKey: '__rowIndex', size: 40 },
  { id: 'name', header: 'name', accessorKey: 'name', size: 120 },
  { id: 'age', header: 'age', accessorKey: 'age', size: 60 },
];

const NOOP_EDIT: GridEditContext = {
  isEditMode: false,
  editingCell: null,
  editValue: '',
  isRowDeleted: () => false,
  isRowInserted: () => false,
  getCellChange: () => null,
  getValidationError: () => null,
  isForeignKeyColumn: () => false,
};

const NOOP_SELECTION: GridSelectionState = {
  selectedRows: new Set<number>(),
  selectedColumns: new Set<string>(),
};

const NOOP_CALLBACKS = {
  onSetEditValue: vi.fn(),
  onStartEdit: vi.fn(),
  onCommitEdit: vi.fn(),
  onRowToggle: vi.fn(),
  onRowRangeSelect: vi.fn(),
  onCellClick: vi.fn(),
  onCellRangeSelect: vi.fn(),
  onColumnSelect: vi.fn(),
  onColumnRangeSelect: vi.fn(),
  onUpdateCell: vi.fn(),
};

interface HarnessProps {
  data: RowData[];
  /** virtualRows を強制する。空配列なら "broken state" を再現 */
  virtualRows: VirtualItem[];
  totalSize: number;
}

/** 実 useTable で table を構築し、virtualRows / totalSize は外部制御する */
function Harness({ data, virtualRows, totalSize }: HarnessProps) {
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const table = useTable({
    features: gridTableFeatures,
    data,
    columns: COLUMNS,
  });
  const rows: GridRow[] = table.getRowModel().rows;
  return (
    <GridTable
      table={table}
      tableContainerRef={tableContainerRef}
      rows={rows}
      virtualRows={virtualRows}
      totalSize={totalSize}
      showColumnFilters={false}
      showLogicalNamesInGrid={false}
      columnsMeta={[]}
      edit={NOOP_EDIT}
      selection={NOOP_SELECTION}
      callbacks={NOOP_CALLBACKS}
      columnSizing={{}}
    />
  );
}

function dataRows(container: HTMLElement): HTMLTableRowElement[] {
  // tbody 配下の行のみ拾う (thead は除外)。padding 用 spacer 行は data-row-index を持たないため除外。
  return Array.from(
    container.querySelectorAll('tbody tr[data-row-index]')
  ) as HTMLTableRowElement[];
}

describe('GridTable virtualizer broken-state フォールバック (Issue #417)', () => {
  it('virtualRows=[] / rows が存在する時、行が空にならない (フォールバック描画)', () => {
    // Bug 再現条件: outerSize=0 で TanStack Virtual が空配列を返した状態。
    // 修正前: tbody が空、ユーザーは何も見えない (Issue #417 主因)。
    // 修正後: フォールバック経路で先頭 N 行が描画される。
    const data = makeRowData(10);
    const { container } = render(
      <Harness data={data} virtualRows={[]} totalSize={data.length * ROW_HEIGHT} />
    );

    const rows = dataRows(container);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('virtualRows=[] / rows=10 件: 全 10 行がフォールバックで描画される', () => {
    const data = makeRowData(10);
    const { container } = render(
      <Harness data={data} virtualRows={[]} totalSize={data.length * ROW_HEIGHT} />
    );

    const rows = dataRows(container);
    expect(rows).toHaveLength(10);
    // 描画行のセル内容が data と一致する (順序不変)
    rows.forEach((tr, i) => {
      expect(within(tr).getByText(`name-${i}`)).toBeInTheDocument();
      expect(within(tr).getByText(String(20 + i))).toBeInTheDocument();
    });
  });

  it('virtualRows=[] / rows=1000 件: フォールバックは上限 (50 行) で打ち切る', () => {
    // 大規模データで全行を非仮想描画するとメモリ・初期描画コストが膨らむ。
    // フォールバックは "見える分" を超える固定上限 (= viewport を埋める最低限) で打ち切る。
    const data = makeRowData(1000);
    const { container } = render(
      <Harness data={data} virtualRows={[]} totalSize={data.length * ROW_HEIGHT} />
    );

    const rows = dataRows(container);
    // FALLBACK_RENDER_LIMIT (= 50) を超えない。下限は実装定数に依存しすぎないため緩く検査:
    //   - 上限 50 を超えない
    //   - 1 行は確実に出ている (空表示でない)
    expect(rows.length).toBeLessThanOrEqual(50);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('virtualRows が提供される通常ケースでは virtualRows.index の行のみ描画される (フォールバックは発動しない)', () => {
    // 通常経路の回帰検知: virtualRows が空でなければフォールバックは絶対に作動してはならない。
    // (フォールバックが優先されると スクロール位置 ≠ 描画位置 になり、padding 計算が破綻する)
    const data = makeRowData(100);
    const virtualRows: VirtualItem[] = [
      { key: 5, index: 5, start: 5 * ROW_HEIGHT, end: 6 * ROW_HEIGHT, size: ROW_HEIGHT, lane: 0 },
      { key: 6, index: 6, start: 6 * ROW_HEIGHT, end: 7 * ROW_HEIGHT, size: ROW_HEIGHT, lane: 0 },
      { key: 7, index: 7, start: 7 * ROW_HEIGHT, end: 8 * ROW_HEIGHT, size: ROW_HEIGHT, lane: 0 },
    ];
    const { container } = render(
      <Harness data={data} virtualRows={virtualRows} totalSize={data.length * ROW_HEIGHT} />
    );

    const rows = dataRows(container);
    expect(rows).toHaveLength(3);
    // 描画されたのは index 5, 6, 7 の行のみ
    expect(within(rows[0]).getByText('name-5')).toBeInTheDocument();
    expect(within(rows[1]).getByText('name-6')).toBeInTheDocument();
    expect(within(rows[2]).getByText('name-7')).toBeInTheDocument();
  });

  it('rows=[] / virtualRows=[] では行を描画しない (空状態でフォールバックを誤発動しない)', () => {
    // 空 ResultSet で行 0 件は正当な状態。フォールバックで偽の行を出してはならない。
    const { container } = render(<Harness data={[]} virtualRows={[]} totalSize={0} />);

    const rows = dataRows(container);
    expect(rows).toHaveLength(0);
  });

  it('virtualRows={index:0,...} 1 件提供時はその 1 行のみ描画 (フォールバックで上書きしない)', () => {
    // virtualRows.length === 1 でもフォールバック経路に流れない (`length === 0` のみが broken state)
    const data = makeRowData(100);
    const virtualRows: VirtualItem[] = [
      { key: 0, index: 0, start: 0, end: ROW_HEIGHT, size: ROW_HEIGHT, lane: 0 },
    ];
    const { container } = render(
      <Harness data={data} virtualRows={virtualRows} totalSize={data.length * ROW_HEIGHT} />
    );

    const rows = dataRows(container);
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText('name-0')).toBeInTheDocument();
  });
});
