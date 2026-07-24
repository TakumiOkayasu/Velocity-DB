import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TREE_ROW_HEIGHT, VirtualTreeList } from '../../components/tree/VirtualTreeList';
import type { FlattenedTreeRow } from '../../utils/flattenVisibleTree';

const buildRows = (count: number): FlattenedTreeRow[] =>
  Array.from({ length: count }, (_, i) => ({
    node: { id: `n${i}`, name: `row-${i}`, type: 'table' as const },
    level: 0,
  }));

const renderRow = (row: FlattenedTreeRow) => <span>{row.node.name}</span>;

describe('VirtualTreeList', () => {
  it('先頭付近の行のみを描画し、範囲外の行は DOM に存在しない', () => {
    render(<VirtualTreeList rows={buildRows(1000)} renderRow={renderRow} />);

    expect(screen.getByText('row-0')).toBeInTheDocument();
    // jsdom ではスクロール親が見つからず window フォールバック (viewport ~768px) になるため
    // 描画されるのは先頭 40 行前後。500 行目は描画されない
    expect(screen.queryByText('row-500')).not.toBeInTheDocument();
    expect(screen.queryByText('row-999')).not.toBeInTheDocument();
  });

  it('スペーサーの高さは全行数 × 行高になる', () => {
    render(<VirtualTreeList rows={buildRows(1000)} renderRow={renderRow} />);
    const list = screen.getByRole('tree');
    expect(list.style.height).toBe(`${1000 * TREE_ROW_HEIGHT}px`);
  });

  it('行数がビューポートより少なければ全行を描画する', () => {
    render(<VirtualTreeList rows={buildRows(5)} renderRow={renderRow} />);
    for (let i = 0; i < 5; i++) {
      expect(screen.getByText(`row-${i}`)).toBeInTheDocument();
    }
  });

  it('行は index × 行高の位置に absolute 配置される', () => {
    render(<VirtualTreeList rows={buildRows(3)} renderRow={renderRow} />);
    const secondRow = screen.getByText('row-1').parentElement;
    expect(secondRow).not.toBeNull();
    expect(secondRow?.style.top).toBe(`${TREE_ROW_HEIGHT}px`);
    expect(secondRow?.style.height).toBe(`${TREE_ROW_HEIGHT}px`);
  });

  it('空の行リストでも描画が壊れない', () => {
    render(<VirtualTreeList rows={[]} renderRow={renderRow} />);
    const list = screen.getByRole('tree');
    expect(list.style.height).toBe('0px');
    expect(list.childElementCount).toBe(0);
  });
});
