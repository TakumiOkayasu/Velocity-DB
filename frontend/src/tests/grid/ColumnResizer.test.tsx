import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ColumnResizer } from '../../components/grid/ColumnResizer';

function renderResizer(
  overrides: Partial<React.ComponentProps<typeof ColumnResizer>> = {}
): HTMLElement {
  const { container } = render(
    <ColumnResizer
      columnId="col_a"
      onResizeStart={overrides.onResizeStart ?? vi.fn()}
      onAutoSizeColumn={overrides.onAutoSizeColumn}
      {...overrides}
    />
  );
  const el = container.firstElementChild;
  if (!el) throw new Error('ColumnResizer rendered no root element');
  return el as HTMLElement;
}

describe('ColumnResizer', () => {
  it('ダブルクリックで onAutoSizeColumn(columnId) を呼ぶ', () => {
    const onAutoSizeColumn = vi.fn();
    const el = renderResizer({ onAutoSizeColumn });

    fireEvent.doubleClick(el);

    expect(onAutoSizeColumn).toHaveBeenCalledTimes(1);
    expect(onAutoSizeColumn).toHaveBeenCalledWith('col_a');
  });

  it('ダブルクリックイベントは親に伝播しない (th の列選択ハンドラ干渉を防ぐ)', () => {
    const parentDblClick = vi.fn();
    const { container } = render(
      <div onDoubleClick={parentDblClick}>
        <ColumnResizer columnId="col_a" onResizeStart={vi.fn()} onAutoSizeColumn={vi.fn()} />
      </div>
    );
    const el = container.querySelector('[class*="columnResizer"]');
    if (!el) throw new Error('ColumnResizer not found');

    fireEvent.doubleClick(el);

    expect(parentDblClick).not.toHaveBeenCalled();
  });

  it('クリックイベントは親に伝播しない (th の列選択ハンドラ干渉を防ぐ)', () => {
    const parentClick = vi.fn();
    const { container } = render(
      <div onClick={parentClick}>
        <ColumnResizer columnId="col_a" onResizeStart={vi.fn()} />
      </div>
    );
    const el = container.querySelector('[class*="columnResizer"]');
    if (!el) throw new Error('ColumnResizer not found');

    fireEvent.click(el);

    expect(parentClick).not.toHaveBeenCalled();
  });

  it('mousedown / touchstart で onResizeStart を呼ぶ (drag resize の起点)', () => {
    const onResizeStart = vi.fn();
    const el = renderResizer({ onResizeStart });

    fireEvent.mouseDown(el);
    fireEvent.touchStart(el);

    expect(onResizeStart).toHaveBeenCalledTimes(2);
  });

  it('onAutoSizeColumn 未指定でもダブルクリックで例外を投げない', () => {
    const el = renderResizer({ onAutoSizeColumn: undefined });

    expect(() => fireEvent.doubleClick(el)).not.toThrow();
  });
});
