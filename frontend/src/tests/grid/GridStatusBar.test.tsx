import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GridStatusBar } from '../../components/grid/GridStatusBar';
import type { PaginationState } from '../../store/query/types';
import type { ResultSet } from '../../types';

const baseProps = {
  resultSet: {
    columns: [],
    rows: [],
    executionTimeMs: 1.23,
    affectedRows: 0,
    truncated: false,
  } satisfies ResultSet,
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
      const resultSet: ResultSet = { ...baseProps.resultSet, rows: [[], [], []] };
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

  describe('pagination mode', () => {
    const rows10k = Array.from<unknown, string[]>({ length: 10000 }, () => []);
    const paginatedResultSet: ResultSet = {
      ...baseProps.resultSet,
      rows: rows10k,
      truncated: false,
    };

    const basePagination: PaginationState = {
      totalRowCount: 50000,
      loadedRowCount: 10000,
      isLoadingMore: false,
      hasMore: true,
      baseSql: 'SELECT * FROM t',
      connectionId: 'conn_1',
    };

    it('pagination有りで「N / M 件」形式を表示', () => {
      render(
        <GridStatusBar
          {...baseProps}
          resultSet={paginatedResultSet}
          filteredRowCount={10000}
          pagination={basePagination}
        />
      );
      expect(screen.getByText(/10,000 \/ 50,000 件/)).toBeInTheDocument();
    });

    it('totalRowCount不明(-1)で「N+」形式を表示', () => {
      const unknownPagination = { ...basePagination, totalRowCount: -1 };
      render(
        <GridStatusBar
          {...baseProps}
          resultSet={paginatedResultSet}
          filteredRowCount={10000}
          pagination={unknownPagination}
        />
      );
      expect(screen.getByText(/10,000\+/)).toBeInTheDocument();
    });

    it('isLoadingMore中に「(読込中...)」を表示', () => {
      const loadingPagination = { ...basePagination, isLoadingMore: true };
      render(
        <GridStatusBar
          {...baseProps}
          resultSet={paginatedResultSet}
          filteredRowCount={10000}
          pagination={loadingPagination}
        />
      );
      expect(screen.getByText(/読込中/)).toBeInTheDocument();
    });

    it('hasMore=true で「スクロールで追加読み込み」ヒントを表示', () => {
      render(
        <GridStatusBar
          {...baseProps}
          resultSet={paginatedResultSet}
          filteredRowCount={10000}
          pagination={basePagination}
        />
      );
      expect(screen.getByText(/スクロールで追加読み込み/)).toBeInTheDocument();
    });

    it('hasMore=false でスクロールヒントを非表示', () => {
      const donePagination = { ...basePagination, hasMore: false };
      render(
        <GridStatusBar
          {...baseProps}
          resultSet={paginatedResultSet}
          filteredRowCount={10000}
          pagination={donePagination}
        />
      );
      expect(screen.queryByText(/スクロールで追加読み込み/)).not.toBeInTheDocument();
    });

    it('pagination有り+フィルタで「表示数/総数 件 (フィルタ中)」形式を表示', () => {
      render(
        <GridStatusBar
          {...baseProps}
          resultSet={paginatedResultSet}
          filteredRowCount={5000}
          isFiltered={true}
          pagination={basePagination}
        />
      );
      expect(screen.getByText(/5,000 \/ 50,000 件 \(フィルタ中\)/)).toBeInTheDocument();
    });
  });
});
