import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ColumnResizer } from '../../components/grid/ColumnResizer';

function renderResizer(
  overrides: Partial<React.ComponentProps<typeof ColumnResizer>> = {}
): HTMLElement {
  const { container } = render(
    <ColumnResizer
      columnId="col_a"
      currentWidth={100}
      onResizeCommit={overrides.onResizeCommit ?? vi.fn()}
      onAutoSizeColumn={overrides.onAutoSizeColumn}
      {...overrides}
    />
  );
  const el = container.firstElementChild;
  if (!el) throw new Error('ColumnResizer rendered no root element');
  return el as HTMLElement;
}

describe('ColumnResizer', () => {
  afterEach(() => {
    // 残存した document listener / overlay indicator を必ず解除
    document.dispatchEvent(new MouseEvent('mouseup'));
    cleanup();
  });

  it('ダブルクリックで onAutoSizeColumn(columnId) を呼ぶ', () => {
    const onAutoSizeColumn = vi.fn();
    const el = renderResizer({ onAutoSizeColumn });

    fireEvent.doubleClick(el);

    expect(onAutoSizeColumn).toHaveBeenCalledTimes(1);
    expect(onAutoSizeColumn).toHaveBeenCalledWith('col_a');
  });

  it('ダブルクリックイベントは親に伝播しない', () => {
    const parentDblClick = vi.fn();
    const { container } = render(
      // biome-ignore lint/a11y/noStaticElementInteractions: test wrapper to capture event bubbling
      <div onDoubleClick={parentDblClick}>
        <ColumnResizer columnId="col_a" currentWidth={100} onResizeCommit={vi.fn()} />
      </div>
    );
    const el = container.querySelector('[class*="columnResizer"]');
    if (!el) throw new Error('ColumnResizer not found');

    fireEvent.doubleClick(el);

    expect(parentDblClick).not.toHaveBeenCalled();
  });

  it('クリックイベントは親に伝播しない', () => {
    const parentClick = vi.fn();
    const { container } = render(
      // biome-ignore lint/a11y/noStaticElementInteractions: test wrapper to capture event bubbling
      // biome-ignore lint/a11y/useKeyWithClickEvents: test wrapper; only verifies click bubbling
      <div onClick={parentClick}>
        <ColumnResizer columnId="col_a" currentWidth={100} onResizeCommit={vi.fn()} />
      </div>
    );
    const el = container.querySelector('[class*="columnResizer"]');
    if (!el) throw new Error('ColumnResizer not found');

    fireEvent.click(el);

    expect(parentClick).not.toHaveBeenCalled();
  });

  it('mousedown→mousemove→mouseup で onResizeCommit が呼ばれる (currentWidth + dx)', () => {
    const onResizeCommit = vi.fn();
    const el = renderResizer({ onResizeCommit, currentWidth: 100 });

    fireEvent.mouseDown(el, { clientX: 50 });
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 80 }));
    document.dispatchEvent(new MouseEvent('mouseup'));

    expect(onResizeCommit).toHaveBeenCalledTimes(1);
    expect(onResizeCommit).toHaveBeenCalledWith('col_a', 130);
  });

  it('dx=0 (mouse 動かさず) で mouseup しても onResizeCommit は呼ばれない', () => {
    const onResizeCommit = vi.fn();
    const el = renderResizer({ onResizeCommit, currentWidth: 100 });

    fireEvent.mouseDown(el, { clientX: 50 });
    document.dispatchEvent(new MouseEvent('mouseup'));

    expect(onResizeCommit).not.toHaveBeenCalled();
  });

  it('minWidth で下限 clamp する', () => {
    const onResizeCommit = vi.fn();
    const el = renderResizer({ onResizeCommit, currentWidth: 100, minWidth: 80 });

    // dx=-50 → 50px だが minWidth=80 で clamp
    fireEvent.mouseDown(el, { clientX: 100 });
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50 }));
    document.dispatchEvent(new MouseEvent('mouseup'));

    expect(onResizeCommit).toHaveBeenCalledWith('col_a', 80);
  });

  it('maxWidth で上限 clamp する', () => {
    const onResizeCommit = vi.fn();
    const el = renderResizer({ onResizeCommit, currentWidth: 100, maxWidth: 200 });

    // dx=+500 → 600px だが maxWidth=200 で clamp
    fireEvent.mouseDown(el, { clientX: 0 });
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 500 }));
    document.dispatchEvent(new MouseEvent('mouseup'));

    expect(onResizeCommit).toHaveBeenCalledWith('col_a', 200);
  });

  it('mousedown で overlay indicator が body に挿入され、mouseup で削除される', () => {
    const el = renderResizer();
    const before = document.body.children.length;

    fireEvent.mouseDown(el, { clientX: 50 });
    const during = document.body.children.length;

    document.dispatchEvent(new MouseEvent('mouseup'));
    const after = document.body.children.length;

    expect(during).toBe(before + 1);
    expect(after).toBe(before);
  });

  it('mouseup 後の mousemove は indicator 移動を起こさない (listener 解除確認)', () => {
    const onResizeCommit = vi.fn();
    const el = renderResizer({ onResizeCommit, currentWidth: 100 });

    fireEvent.mouseDown(el, { clientX: 50 });
    document.dispatchEvent(new MouseEvent('mouseup'));
    onResizeCommit.mockClear();

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200 }));
    document.dispatchEvent(new MouseEvent('mouseup'));

    expect(onResizeCommit).not.toHaveBeenCalled();
  });

  it('onAutoSizeColumn 未指定でもダブルクリックで例外を投げない', () => {
    const el = renderResizer({ onAutoSizeColumn: undefined });

    expect(() => fireEvent.doubleClick(el)).not.toThrow();
  });
});
