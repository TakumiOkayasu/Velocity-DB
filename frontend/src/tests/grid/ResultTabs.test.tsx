import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResultTabs } from '../../components/grid/ResultTabs';
import type { ResultSet } from '../../types';

const emptyResult: ResultSet = {
  columns: [],
  rows: [],
  affectedRows: 0,
  executionTimeMs: 0,
};

describe('ResultTabs', () => {
  it('results が空配列ならボタンを描画しない', () => {
    render(<ResultTabs results={[]} activeIndex={0} onSelect={vi.fn()} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('statement が重複している 6 タブを全て個別に描画する', () => {
    const results = Array.from({ length: 6 }, () => ({
      statement: 'SELECT',
      data: emptyResult,
    }));
    const onSelect = vi.fn();

    render(<ResultTabs results={results} activeIndex={0} onSelect={onSelect} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(6);
  });

  it('異なるタブをクリックするとそれぞれ対応する index で onSelect が呼ばれる', () => {
    const results = Array.from({ length: 6 }, () => ({
      statement: 'SELECT',
      data: emptyResult,
    }));
    const onSelect = vi.fn();

    render(<ResultTabs results={results} activeIndex={0} onSelect={onSelect} />);

    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[3]);
    fireEvent.click(buttons[5]);

    expect(onSelect).toHaveBeenNthCalledWith(1, 0);
    expect(onSelect).toHaveBeenNthCalledWith(2, 3);
    expect(onSelect).toHaveBeenNthCalledWith(3, 5);
  });

  it('activeIndex が指すタブにアクティブ用クラスが付く', () => {
    const results = Array.from({ length: 3 }, () => ({
      statement: 'SELECT',
      data: emptyResult,
    }));

    render(<ResultTabs results={results} activeIndex={1} onSelect={vi.fn()} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons[0].className).not.toMatch(/activeResultTab/);
    expect(buttons[1].className).toMatch(/activeResultTab/);
    expect(buttons[2].className).not.toMatch(/activeResultTab/);
  });
});
