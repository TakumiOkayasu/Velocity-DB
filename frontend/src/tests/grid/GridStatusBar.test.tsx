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
});
