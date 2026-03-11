import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GridStatusBar } from '../../components/grid/GridStatusBar';
import type { ResultSet } from '../../types';

const baseProps = {
  resultSet: {
    columns: [],
    rows: [],
    executionTimeMs: 1.23,
    affectedRows: 0,
    truncated: false,
  } as unknown as ResultSet,
  filteredRowCount: 0,
  isFiltered: false,
  isReadOnly: false,
};

describe('GridStatusBar', () => {
  it('isReadOnly=true で「読取専用」インジケーター表示', () => {
    render(<GridStatusBar {...baseProps} isReadOnly={true} />);
    expect(screen.getByText('読取専用')).toBeInTheDocument();
  });

  it('isReadOnly=false で「読取専用」インジケーター非表示', () => {
    render(<GridStatusBar {...baseProps} isReadOnly={false} />);
    expect(screen.queryByText('読取専用')).not.toBeInTheDocument();
  });

  describe('transpose mode', () => {
    it('viewMode=transpose で「行 N / M」形式を表示', () => {
      const resultSet = { ...baseProps.resultSet, rows: [[], [], []] } as unknown as ResultSet;
      render(
        <GridStatusBar
          {...baseProps}
          resultSet={resultSet}
          viewMode="transpose"
          transposeRowIndex={1}
        />
      );
      expect(screen.getByText('行 2 / 3')).toBeInTheDocument();
    });

    it('viewMode=transpose で0行時に「行 0 / 0」を表示', () => {
      render(<GridStatusBar {...baseProps} viewMode="transpose" transposeRowIndex={0} />);
      expect(screen.getByText('行 0 / 0')).toBeInTheDocument();
    });
  });
});
