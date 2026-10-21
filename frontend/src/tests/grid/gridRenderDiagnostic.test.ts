import type { VirtualItem } from '@tanstack/react-virtual';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  captureGridRenderDiagnostic,
  GRID_DIAGNOSTIC_LIMITS,
  serializeGridRenderDiagnostic,
} from '../../components/grid/gridRenderDiagnostic';

const SECRET = 'SECRET_CELL_SQL_TABLE_DATABASE_CONNECTION_CREDENTIAL';
const RESERVED_COLUMN_SECRET = '123456789';

function model(count = 1000000, virtualCount = 90) {
  return {
    rowCount: count,
    columnCount: 1000,
    totalSize: count * 32,
    virtualRows: Array.from({ length: virtualCount }, (_, index): VirtualItem => ({
      index: index + 100,
      start: (index + 100) * 32,
      end: (index + 101) * 32,
      size: 32,
      key: SECRET,
      lane: 0,
    })),
    virtualizer: {
      scrollOffset: 3500,
      scrollRect: { width: 800, height: 600 },
      range: { startIndex: 110, endIndex: 130 },
      isScrolling: false,
    },
  };
}

function grid(rowCount = 50, cellCount = 6) {
  const container = document.createElement('div');
  const table = document.createElement('table');
  container.append(table);
  const header = table.createTHead().insertRow().insertCell();
  header.textContent = SECRET;
  const body = table.createTBody();
  const spacer = (side: 'top' | 'bottom') => {
    const row = body.insertRow();
    row.dataset.gridSpacer = side;
    row.insertCell().style.height = side === 'top' ? '3200px' : '4000px';
  };
  spacer('top');
  for (let i = 0; i < rowCount; i++) {
    const row = body.insertRow();
    row.dataset.rowIndex = String(i + 100);
    // 実際の結果に __originalIndex 列がある場合、既存の行モデルでは値が上書きされる。
    row.dataset.originalIndex = RESERVED_COLUMN_SECRET;
    row.setAttribute('aria-label', SECRET);
    row.style.setProperty('--private-label', SECRET);
    for (let c = 0; c < cellCount; c++) {
      const cell = row.insertCell();
      cell.dataset.field = SECRET;
      cell.title = SECRET;
      cell.textContent = SECRET;
      cell.style.backgroundImage = `url(https://example.invalid/${SECRET})`;
    }
  }
  spacer('bottom');
  document.body.append(container);
  container.scrollTop = 3500;
  container.scrollLeft = 123;
  return container;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('表示診断の固定スキーマ', () => {
  it('実 DOM と仮想範囲・spacer・位置を別々に記録し、データや属性を漏らさない', () => {
    const container = grid();
    const snapshot = captureGridRenderDiagnostic(container, model());
    const json = serializeGridRenderDiagnostic(snapshot);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain(RESERVED_COLUMN_SECRET);
    expect(json).not.toContain('example.invalid');
    expect(json).not.toContain('data-field');
    expect(json).not.toContain('innerHTML');
    expect(snapshot.build.frontendSource).toBe(__VELOCITYDB_FRONTEND_SOURCE__);
    expect(snapshot.build.mode).toBe('development');
    expect(snapshot.dom.connected).toBe(true);
    expect(snapshot.dom.container?.scrollTop).toBe(3500);
    expect(snapshot.dom.container?.scrollLeft).toBe(123);
    expect(snapshot.dom.rowCount).toBe(50);
    expect(snapshot.dom.rows[0]).toMatchObject({ index: 100, cellCount: 6 });
    expect(snapshot.dom.rows[snapshot.dom.rows.length - 1]?.index).toBe(149);
    expect(snapshot.dom.topSpacer).not.toBeNull();
    expect(snapshot.dom.bottomSpacer).not.toBeNull();
    expect(snapshot.model.virtualizer.range).toEqual({ startIndex: 110, endIndex: 130 });
    expect(snapshot.model.virtualItems[snapshot.model.virtualItems.length - 1]?.index).toBe(189);
    expect(snapshot.model.fallback).toBe(false);
  });

  it('欠けた DOM・想定範囲と異なる spacer・非表示 CSS を修復せず記録する', () => {
    const container = grid(5);
    container.querySelector('[data-row-index="101"]')?.remove();
    const hiddenRow = container.querySelector<HTMLElement>('[data-row-index="102"]');
    if (!hiddenRow) throw new Error('Missing test row');
    hiddenRow.style.visibility = 'hidden';
    const spacer = container.querySelector('[data-grid-spacer="top"]');
    if (!spacer) throw new Error('Missing test spacer');
    vi.spyOn(spacer, 'getBoundingClientRect').mockReturnValue({
      top: 10,
      bottom: 910,
      left: 0,
      right: 500,
      width: 500,
      height: 900,
      x: 0,
      y: 10,
      toJSON: () => ({}),
    });
    const source = model(5, 5);
    source.virtualizer.scrollOffset = 0;
    const snapshot = captureGridRenderDiagnostic(container, source);
    expect(snapshot.dom.rows.map((row) => row.index)).toEqual([100, 102, 103, 104]);
    expect(snapshot.model.virtualItems.map((row) => row.index)).toEqual([100, 101, 102, 103, 104]);
    expect(snapshot.dom.topSpacer?.bounds.height).toBe(900);
    expect(snapshot.dom.rows[1].css?.visibility).toBe('hidden');
    expect(snapshot.dom.container?.scrollTop).toBe(3500);
    expect(snapshot.model.virtualizer.scrollOffset).toBe(0);
    expect(hiddenRow.style.visibility).toBe('hidden');
    expect(container.querySelector('[data-row-index="101"]')).toBeNull();
  });

  it('DOM の値・HTML を読み取らず、変更しないまま繰り返し採取できる', () => {
    const container = grid(3);
    const before = container.outerHTML;
    const input = document.createElement('input');
    container.querySelector('td')?.append(input);
    input.value = SECRET;
    input.focus();
    const nodes = Array.from(container.querySelectorAll('*'));
    for (const node of nodes) {
      for (const property of ['innerHTML', 'outerHTML', 'textContent']) {
        Object.defineProperty(node, property, {
          get: () => {
            throw new Error('private text read');
          },
          configurable: true,
        });
      }
    }
    const observer = new MutationObserver(() => {});
    observer.observe(container, {
      subtree: true,
      attributes: true,
      childList: true,
      characterData: true,
    });
    const source = model();
    const originalModel = JSON.stringify(source);
    for (let i = 0; i < 3; i++) {
      expect(
        serializeGridRenderDiagnostic(captureGridRenderDiagnostic(container, source))
      ).not.toContain(SECRET);
    }
    expect(observer.takeRecords()).toEqual([]);
    expect(container.scrollTop).toBe(3500);
    expect(container.scrollLeft).toBe(123);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe(SECRET);
    expect(JSON.stringify(source)).toBe(originalModel);
    expect(nodes.every((node) => node.isConnected)).toBe(true);
    expect(before).toContain(SECRET);
    observer.disconnect();
  });

  it('読込中や未マウント、切離し後、空グリッドでも例外にしない', () => {
    for (const source of [model(0, 0), model(100, 0)]) {
      const snapshot = captureGridRenderDiagnostic(null, source);
      expect(snapshot.dom.container).toBeNull();
      expect(snapshot.dom.rowCount).toBe(0);
      expect(snapshot.dom.connected).toBe(false);
      expect(snapshot.model.fallback).toBe(source.rowCount > 0);
    }
    const container = grid(0);
    expect(captureGridRenderDiagnostic(container, model(0, 0)).dom.rows).toEqual([]);
    container.remove();
    expect(captureGridRenderDiagnostic(container, model(0, 0)).dom.connected).toBe(false);
  });

  it('大きな結果でもサンプル数・DOM 読取回数・UTF-8 サイズを上限内に保つ', () => {
    const container = grid(120, 100);
    const bounds = vi.spyOn(Element.prototype, 'getBoundingClientRect');
    const snapshot = captureGridRenderDiagnostic(container, model(1000000, 1000));
    const json = serializeGridRenderDiagnostic(snapshot);
    expect(bounds.mock.calls.length).toBeLessThanOrEqual(6 + GRID_DIAGNOSTIC_LIMITS.rows * 4);
    expect(snapshot.dom.rows.length).toBeLessThanOrEqual(GRID_DIAGNOSTIC_LIMITS.rows);
    expect(
      snapshot.dom.rows.every((row) => row.cells.length <= GRID_DIAGNOSTIC_LIMITS.cellsPerRow)
    ).toBe(true);
    expect(snapshot.model.virtualItems).toHaveLength(GRID_DIAGNOSTIC_LIMITS.virtualItems);
    expect(snapshot.truncated).toMatchObject({ rows: true, virtualItems: true });
    expect(new TextEncoder().encode(json).length).toBeLessThanOrEqual(GRID_DIAGNOSTIC_LIMITS.bytes);
    expect(JSON.parse(json).schemaVersion).toBe(1);
  });

  it('長い数値 CSS でもサイズを制限し、任意文字列と非有限値を拒否する', () => {
    const container = grid(40);
    const original = window.getComputedStyle;
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const actual = original(element);
      return new Proxy(actual, {
        get(target, property) {
          if (property === 'contain' || property === 'color') return SECRET;
          if (property === 'transform') return `matrix3d(${Array(16).fill('999999999').join(',')})`;
          return Reflect.get(target, property);
        },
      });
    });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 1e9,
      bottom: 1e9,
      left: 1e9,
      right: 1e9,
      width: 1e9,
      height: 1e9,
      x: 1e9,
      y: 1e9,
      toJSON: () => ({}),
    });
    const source = model();
    source.totalSize = Infinity;
    const snapshot = captureGridRenderDiagnostic(container, source);
    const json = serializeGridRenderDiagnostic(snapshot);
    expect(json).not.toContain(SECRET);
    expect(snapshot.model.totalSize).toBeNull();
    expect(snapshot.dom.container?.css?.contain).toBeNull();
    expect(snapshot.truncated.bytes).toBe(true);
    expect(new TextEncoder().encode(json).length).toBeLessThanOrEqual(GRID_DIAGNOSTIC_LIMITS.bytes);
    expect(snapshot.dom.rows[0]?.index).toBe(100);
    expect(snapshot.dom.rows[snapshot.dom.rows.length - 1]?.index).toBe(139);
  });
});
