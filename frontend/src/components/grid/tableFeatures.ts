import {
  columnFilteringFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_includesString,
  filterFn_weakEquals,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_text,
  tableFeatures,
  type ColumnDef,
  type ReactTable,
  type Row,
} from '@tanstack/react-table';
import type { RowData } from '../../types/grid';

export interface GridColumnMeta {
  type?: string;
  align?: 'left' | 'right' | 'center';
}

/**
 * TanStack Table v9 requires features and row-model factories to be explicit.
 * Keep the grid's feature contract centralized so every production/test table
 * uses the same API surface.
 */
export const gridTableFeatures = tableFeatures({
  columnFilteringFeature,
  columnSizingFeature,
  columnResizingFeature,
  columnVisibilityFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  filterFns: {
    includesString: filterFn_includesString,
    weakEquals: filterFn_weakEquals,
  },
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    text: sortFn_text,
  },
  columnMeta: {} as GridColumnMeta,
});

export type GridTableFeatures = typeof gridTableFeatures;
export type GridColumnDef = ColumnDef<GridTableFeatures, RowData>;
export type GridRow = Row<GridTableFeatures, RowData>;
export type GridTableInstance = ReactTable<GridTableFeatures, RowData>;
