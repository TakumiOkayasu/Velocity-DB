import type { VirtualItem } from '@tanstack/react-virtual';

export const GRID_DIAGNOSTIC_LIMITS = { rows: 40, cellsPerRow: 3, virtualItems: 80, bytes: 65536 };

interface DiagnosticModel {
  rowCount: number;
  columnCount: number;
  virtualRows: readonly VirtualItem[];
  totalSize: number;
  virtualizer: {
    scrollOffset: number | null;
    scrollRect: { width: number; height: number } | null;
    range: { startIndex: number; endIndex: number } | null;
    isScrolling: boolean;
  };
}

// 固定スキーマのみを採取する。DOM のテキスト・HTML・属性一覧やデータモデルは読まない。
// 数値も有限値に制限し、ログサイズと JSON 形式を安定させる。
function number(value: number): number | null {
  return Number.isFinite(value)
    ? Math.round(Math.max(-1e9, Math.min(1e9, value)) * 100) / 100
    : null;
}

function rowIndex(value: string | undefined): number | null {
  return value !== undefined && /^\d{1,9}$/.test(value) ? Number(value) : null;
}

function rect(element: Element) {
  const bounds = element.getBoundingClientRect();
  return {
    top: number(bounds.top),
    bottom: number(bounds.bottom),
    left: number(bounds.left),
    right: number(bounds.right),
    width: number(bounds.width),
    height: number(bounds.height),
  };
}

function style(element: Element) {
  const css = getComputedStyle(element);
  // 値まで許可リスト化する。CSS custom property・url・任意の文字列は記録しない。
  const token = (value: string, allowed: string[]) => (allowed.includes(value) ? value : null);
  const numericCss = (value: string) =>
    value.length <= 180 && /^(?:matrix(?:3d)?\(|rgba?\()[-\d.,\s]+\)$/.test(value) ? value : null;
  return {
    display: token(css.display, [
      'none',
      'block',
      'inline',
      'flex',
      'grid',
      'table',
      'table-row',
      'table-cell',
      'table-row-group',
      'table-header-group',
    ]),
    visibility: token(css.visibility, ['visible', 'hidden', 'collapse']),
    position: token(css.position, ['static', 'relative', 'absolute', 'fixed', 'sticky']),
    contain: token(css.contain, [
      'none',
      'strict',
      'content',
      'size',
      'layout',
      'paint',
      'style',
      'size layout paint',
      'layout paint',
    ]),
    contentVisibility: token(css.contentVisibility, ['visible', 'auto', 'hidden']),
    overflowX: token(css.overflowX, ['visible', 'hidden', 'clip', 'scroll', 'auto']),
    overflowY: token(css.overflowY, ['visible', 'hidden', 'clip', 'scroll', 'auto']),
    borderCollapse: token(css.borderCollapse, ['collapse', 'separate']),
    tableLayout: token(css.tableLayout, ['auto', 'fixed']),
    opacity: css.opacity === '' ? null : number(Number(css.opacity)),
    zIndex: css.zIndex === 'auto' ? 'auto' : css.zIndex === '' ? null : number(Number(css.zIndex)),
    transform: css.transform === 'none' ? 'none' : numericCss(css.transform),
    color: numericCss(css.color),
    backgroundColor: numericCss(css.backgroundColor),
  };
}

function elementSnapshot(element: Element | null) {
  return element ? { bounds: rect(element), css: style(element) } : null;
}

// 先頭と末尾を等分して採取する。全行/全列を列挙せず、大きい DOM でも固定回数に抑える。
function sampleIndices(length: number, limit: number): number[] {
  if (length <= limit) return Array.from({ length }, (_, index) => index);
  const first = Math.ceil(limit / 2);
  return Array.from({ length: limit }, (_, index) =>
    index < first ? index : length - (limit - index)
  );
}

/** 同期・読み取り専用。virtualizer の計算/measure/scroll、DOM 書換えや描画待ちは行わない。 */
export function captureGridRenderDiagnostic(
  container: HTMLDivElement | null,
  model: DiagnosticModel
) {
  const table =
    container?.firstElementChild instanceof HTMLTableElement ? container.firstElementChild : null;
  const body = table?.tBodies.item(0) ?? null;
  const first = body?.rows.item(0) ?? null;
  const last = body?.rows.item((body?.rows.length ?? 0) - 1) ?? null;
  const topSpacer = first?.dataset.gridSpacer === 'top' ? first : null;
  const bottomSpacer = last?.dataset.gridSpacer === 'bottom' ? last : null;
  const rowCount = (body?.rows.length ?? 0) - (topSpacer ? 1 : 0) - (bottomSpacer ? 1 : 0);
  const sampledRows = sampleIndices(rowCount, GRID_DIAGNOSTIC_LIMITS.rows).flatMap((position) => {
    const row = body?.rows.item(position + (topSpacer ? 1 : 0));
    if (!row) return [];
    const cellPositions =
      row.cells.length <= GRID_DIAGNOSTIC_LIMITS.cellsPerRow
        ? sampleIndices(row.cells.length, GRID_DIAGNOSTIC_LIMITS.cellsPerRow)
        : [0, Math.floor(row.cells.length / 2), row.cells.length - 1];
    return [
      {
        position,
        index: rowIndex(row.dataset.rowIndex),
        ...elementSnapshot(row),
        cellCount: row.cells.length,
        cells: cellPositions.flatMap((columnIndex) => {
          const cell = row.cells.item(columnIndex);
          return cell ? [{ columnIndex, ...elementSnapshot(cell) }] : [];
        }),
      },
    ];
  });
  const { virtualRows, virtualizer } = model;
  const frontendSource =
    typeof __VELOCITYDB_FRONTEND_SOURCE__ === 'string' ? __VELOCITYDB_FRONTEND_SOURCE__ : 'unknown';
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    build: {
      frontendSource: /^[0-9a-f]{12,40}(?:-dirty)?$/.test(frontendSource)
        ? frontendSource
        : 'unknown',
      mode: import.meta.env.DEV ? 'development' : 'artifact',
    },
    viewport: {
      width: number(window.innerWidth),
      height: number(window.innerHeight),
      devicePixelRatio: number(window.devicePixelRatio),
      visibility: document.visibilityState === 'visible' ? 'visible' : 'hidden',
    },
    model: {
      rowCount: number(model.rowCount),
      columnCount: number(model.columnCount),
      totalSize: number(model.totalSize),
      fallback: model.rowCount > 0 && virtualRows.length === 0,
      virtualItemCount: virtualRows.length,
      virtualItems: sampleIndices(virtualRows.length, GRID_DIAGNOSTIC_LIMITS.virtualItems).map(
        (position) => {
          const item = virtualRows[position];
          return {
            index: number(item.index),
            start: number(item.start),
            end: number(item.end),
            size: number(item.size),
          };
        }
      ),
      virtualizer: {
        scrollOffset: virtualizer.scrollOffset === null ? null : number(virtualizer.scrollOffset),
        scrollRect: virtualizer.scrollRect
          ? {
              width: number(virtualizer.scrollRect.width),
              height: number(virtualizer.scrollRect.height),
            }
          : null,
        range: virtualizer.range
          ? {
              startIndex: number(virtualizer.range.startIndex),
              endIndex: number(virtualizer.range.endIndex),
            }
          : null,
        isScrolling: virtualizer.isScrolling,
      },
    },
    dom: {
      connected: container?.isConnected ?? false,
      container: container
        ? {
            ...elementSnapshot(container),
            scrollTop: number(container.scrollTop),
            scrollLeft: number(container.scrollLeft),
            clientHeight: number(container.clientHeight),
            clientWidth: number(container.clientWidth),
            scrollHeight: number(container.scrollHeight),
            scrollWidth: number(container.scrollWidth),
          }
        : null,
      table: elementSnapshot(table),
      header: elementSnapshot(table?.tHead ?? null),
      body: elementSnapshot(body),
      topSpacer: elementSnapshot(topSpacer),
      bottomSpacer: elementSnapshot(bottomSpacer),
      rowCount,
      rows: sampledRows,
    },
    truncated: {
      rows: rowCount > sampledRows.length,
      virtualItems: virtualRows.length > GRID_DIAGNOSTIC_LIMITS.virtualItems,
      bytes: false,
    },
  };
}

export function serializeGridRenderDiagnostic(
  snapshot: ReturnType<typeof captureGridRenderDiagnostic>
): string {
  // 全文字列は固定 ASCII/数値なので文字数 = UTF-8 byte 数。計測対象に応じて上限内へ縮小する。
  let json = JSON.stringify(snapshot);
  while (json.length > GRID_DIAGNOSTIC_LIMITS.bytes && snapshot.dom.rows.length > 0) {
    snapshot.dom.rows.splice(Math.floor(snapshot.dom.rows.length / 2), 1);
    snapshot.truncated.rows = true;
    snapshot.truncated.bytes = true;
    json = JSON.stringify(snapshot);
  }
  return json;
}
