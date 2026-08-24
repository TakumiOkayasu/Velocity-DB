// 列幅オートアジャストは toolbar ボタン / ContextMenu / dblclick / Ctrl+Shift+A の 4 経路で
// 起動する。hook 単体と UI 単体はそれぞれ pass するが、実機で「toolbar ボタン」「ContextMenu
// 全列/単列」経路のみアジャストが反映されない報告が出た (fix/drag-lag-probe, progress.md 3rd round)。
// このファイルは hook (useColumnAutoSize) と UI (GridToolbar / useGridContextMenu) を
// 実際に wiring した integration レベルで「click/action → columnSizing state 更新」の
// end-to-end が成立しているかを検証する RED。GREEN 後も回帰テストとして残す。
//
// 検出戦略:
//   1. 初期 rowData 短 content で mount → useLayoutEffect が初回 auto-size を実行
//   2. descriptionText を長 content に rerender。columnsKey (name:type) は不変のため
//      useLayoutEffect の guard で再計算がスキップされ columnSizing は初期値のまま
//   3. 各経路から trigger → runFullMeasurement が新 rowData で再計算するはず
//   4. 300px (varchar clamp) への変化を検証

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useMemo } from 'react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

vi.mock('../../utils/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

import { GridToolbar } from '../../components/grid/GridToolbar';
import { useColumnAutoSize } from '../../components/grid/hooks/useColumnAutoSize';
import { useGridContextMenu } from '../../components/grid/hooks/useGridContextMenu';
import type { ResultSet } from '../../types';
import type { ColumnMeta, RowData } from '../../types/grid';
import type { GridColumnDef } from '../../components/grid/tableFeatures';

const CONTEXT_MENU_ALL_COLUMNS = '全列をオートアジャスト';
const CONTEXT_MENU_SINGLE_COLUMN = 'この列をオートアジャスト';
// varchar 型の maxWidth 上限 (TEXT/JSON 暴発防止、useColumnAutoSize.ts の config と同値)
const VARCHAR_MAX_WIDTH = 300;
// setup.ts の mock: width = text.length * fontSize * 0.6。
// useColumnAutoSize.ts の FONT は `14px ${MONO_STACK}` (ResultGrid.module.css `.table` と一致)。
const MOCK_CHAR_WIDTH = 14 * 0.6;
// CELL_HORIZONTAL_PADDING (CSS .th/.td 24 + sort indicator 8)
const EXPECTED_PADDING = 32;

interface MenuItemRef {
  current: Array<{ label: string; action: () => void }>;
}

interface HarnessProps {
  sizingObserver: { current: Record<string, number> | null };
  menuItemsObserver?: MenuItemRef;
  descriptionText: string;
  /** 行数。>500 で useColumnAutoSize が async chunk path に入る (SYNC_THRESHOLD=500) */
  rowCount?: number;
}

function Harness({
  sizingObserver,
  menuItemsObserver,
  descriptionText,
  rowCount = 1,
}: HarnessProps) {
  const resultSet = useMemo<ResultSet>(
    () => ({
      columns: [
        { name: 'description', type: 'varchar', size: 0, nullable: true, isPrimaryKey: false },
      ],
      rows: Array.from({ length: rowCount }, () => [descriptionText]),
      affectedRows: 0,
      executionTimeMs: 0,
    }),
    [descriptionText, rowCount]
  );

  const columns = useMemo<GridColumnDef[]>(
    () => [
      {
        id: 'description',
        header: 'description',
        accessorKey: 'description',
        size: 150,
        minSize: 80,
      },
    ],
    []
  );

  const rowData = useMemo<RowData[]>(
    () =>
      Array.from({ length: rowCount }, (_, i) => ({
        __rowIndex: String(i + 1),
        __originalIndex: String(i),
        description: descriptionText,
      })),
    [descriptionText, rowCount]
  );

  const columnsMeta = useMemo<ColumnMeta[]>(
    () => [{ name: 'description', comment: '', type: 'varchar' }],
    []
  );

  const { columnSizing, triggerAutoSize, triggerAutoSizeForColumn } = useColumnAutoSize({
    resultSet,
    columns,
    rowData,
  });
  sizingObserver.current = columnSizing;

  const gridRows = useMemo(() => rowData.map((r) => ({ original: r })), [rowData]);
  const tableShim = useMemo(() => ({ getColumn: () => undefined }), []);

  const { openHeaderMenu, getMenuItems } = useGridContextMenu(columnsMeta, gridRows, tableShim, {
    isEditMode: false,
    onAutoSizeColumn: triggerAutoSizeForColumn,
    onAutoSizeColumns: triggerAutoSize,
  });

  // contextMenu state 確定後 (click で open した後) の getMenuItems を外部へ公開
  if (menuItemsObserver) menuItemsObserver.current = getMenuItems();

  return (
    <div>
      <GridToolbar
        showRefresh={false}
        canEdit={false}
        hasChanges={false}
        isApplying={false}
        applyError={null}
        hasValidationErrors={false}
        showLogicalNamesInGrid={false}
        showColumnFilters={false}
        isReadOnly={false}
        viewMode="table"
        onRefresh={() => {}}
        onInsertRow={() => {}}
        onDeleteRow={() => {}}
        onRevertChanges={() => {}}
        onApplyChanges={() => {}}
        onSetShowLogicalNames={() => {}}
        onToggleColumnFilters={() => {}}
        onExport={() => {}}
        onAutoSizeColumns={triggerAutoSize}
        onChangeViewMode={() => {}}
      />
      <button
        type="button"
        data-testid="open-header-menu"
        onClick={(e) => openHeaderMenu(e, 'description')}
      >
        open
      </button>
    </div>
  );
}

describe('ResultGrid auto-adjust 経路 integration (4 経路の state 末端まで)', () => {
  afterEach(() => cleanup());

  it('初期 mount で useLayoutEffect 経由の auto-size が短 content を反映する', () => {
    const sizingRef = { current: null as Record<string, number> | null };
    render(<Harness sizingObserver={sizingRef} descriptionText="short" />);

    // header 'description' = 11 chars, content 'short' = 5 chars → header の方が広い
    // 11 * 8.4 + 32 = 124.4
    const expected = 'description'.length * MOCK_CHAR_WIDTH + EXPECTED_PADDING;
    expect(sizingRef.current?.description).toBeCloseTo(expected, 5);
  });

  it('ツールバー ↔ ボタン click: content 長変更後に click すると新 content で再計算される', () => {
    const sizingRef = { current: null as Record<string, number> | null };
    const { rerender } = render(<Harness sizingObserver={sizingRef} descriptionText="short" />);
    const initialWidth = sizingRef.current?.description;

    // content を 100 chars に変更。columnsKey (description:varchar) 不変のため
    // useLayoutEffect の guard で再計算スキップ → sizing は初期値のまま
    rerender(<Harness sizingObserver={sizingRef} descriptionText={'X'.repeat(100)} />);
    expect(sizingRef.current?.description).toBe(initialWidth);

    // button click → triggerAutoSize → 新 rowData で再計算 → 100*8.4+32=872 → varchar 300 にクランプ
    act(() => {
      fireEvent.click(screen.getByTitle(/列幅をオートアジャスト/));
    });
    expect(sizingRef.current?.description).toBe(VARCHAR_MAX_WIDTH);
  });

  it('ContextMenu "全列をオートアジャスト" action: triggerAutoSize 経由で state が更新される', () => {
    const sizingRef = { current: null as Record<string, number> | null };
    const menuRef: MenuItemRef = { current: [] };
    const { rerender } = render(
      <Harness sizingObserver={sizingRef} menuItemsObserver={menuRef} descriptionText="short" />
    );
    const initialWidth = sizingRef.current?.description;

    rerender(
      <Harness
        sizingObserver={sizingRef}
        menuItemsObserver={menuRef}
        descriptionText={'X'.repeat(100)}
      />
    );
    expect(sizingRef.current?.description).toBe(initialWidth);

    // header menu を開く (contextMenu state をセット → 再 render で getMenuItems が実アイテムを返す)
    act(() => {
      fireEvent.click(screen.getByTestId('open-header-menu'));
    });

    const allItem = menuRef.current.find((i) => i.label === CONTEXT_MENU_ALL_COLUMNS);
    expect(allItem, 'ContextMenu に "全列をオートアジャスト" が存在する').toBeDefined();

    act(() => {
      allItem?.action();
    });
    expect(sizingRef.current?.description).toBe(VARCHAR_MAX_WIDTH);
    expect(sizingRef.current?.description).not.toBe(initialWidth);
  });

  it('ContextMenu "この列をオートアジャスト" action: triggerAutoSizeForColumn 経由で state が更新される', () => {
    const sizingRef = { current: null as Record<string, number> | null };
    const menuRef: MenuItemRef = { current: [] };
    const { rerender } = render(
      <Harness sizingObserver={sizingRef} menuItemsObserver={menuRef} descriptionText="short" />
    );
    const initialWidth = sizingRef.current?.description;

    rerender(
      <Harness
        sizingObserver={sizingRef}
        menuItemsObserver={menuRef}
        descriptionText={'X'.repeat(100)}
      />
    );
    expect(sizingRef.current?.description).toBe(initialWidth);

    act(() => {
      fireEvent.click(screen.getByTestId('open-header-menu'));
    });

    const singleItem = menuRef.current.find((i) => i.label === CONTEXT_MENU_SINGLE_COLUMN);
    expect(singleItem, 'ContextMenu に "この列をオートアジャスト" が存在する').toBeDefined();

    act(() => {
      singleItem?.action();
    });
    expect(sizingRef.current?.description).toBe(VARCHAR_MAX_WIDTH);
    expect(sizingRef.current?.description).not.toBe(initialWidth);
  });

  // 実機 (fix/drag-lag-probe, 4/23 17:21 ログ) で発覚した abort 連鎖を UI 末端で回帰ガード。
  // sync path (rowCount=1) の既存 4 test は Harness が SYNC_THRESHOLD(500) 以下のため
  // cancellation token を通らず false GREEN になっていた。async path を踏む構成で
  // 「全列 triggerAutoSize 進行中に単列 trigger を割込んでも全列が commit される」を検証する。
  it('async path: toolbar 全列 trigger 進行中に ContextMenu 単列 trigger しても全列結果が反映される', async () => {
    const ASYNC_ROW_COUNT = 600; // > SYNC_THRESHOLD(500)
    const sizingRef = { current: null as Record<string, number> | null };
    const menuRef: MenuItemRef = { current: [] };

    // 長 content で mount → useLayoutEffect の全列 async が開始される
    render(
      <Harness
        sizingObserver={sizingRef}
        menuItemsObserver={menuRef}
        descriptionText={'X'.repeat(100)}
        rowCount={ASYNC_ROW_COUNT}
      />
    );

    // async 完了前の初期状態では columnSizing は未設定 ({})
    expect(sizingRef.current?.description).toBeUndefined();

    // 全列 async 進行中に ContextMenu 単列を割込ませる
    act(() => {
      fireEvent.click(screen.getByTestId('open-header-menu'));
    });
    const singleItem = menuRef.current.find((i) => i.label === CONTEXT_MENU_SINGLE_COLUMN);
    expect(singleItem, 'ContextMenu 単列アイテムが存在する').toBeDefined();
    act(() => {
      singleItem?.action();
    });

    // 修正前 (measurementIdRef 共有) では全列 async が単列 trigger で abort され、
    // description が VARCHAR_MAX_WIDTH に到達しなかった (undefined のまま)。
    // 修正後 (token 分離) では全列完走 → 300 にクランプされる。
    await waitFor(
      () => {
        expect(sizingRef.current?.description).toBe(VARCHAR_MAX_WIDTH);
      },
      { timeout: 3000 }
    );
  });
});
