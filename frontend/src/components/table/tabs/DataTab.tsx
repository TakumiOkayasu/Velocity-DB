import type { CellClassParams, ColDef, GridApi, GridReadyEvent } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ResultSet } from '../../../types';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import styles from '../TableViewer.module.css';

interface DataTabProps {
  resultSet: ResultSet | null;
  whereClause: string;
  onWhereClauseChange: (value: string) => void;
  onApplyFilter: () => void;
  showLogicalNames: boolean;
}

export function DataTab({
  resultSet,
  whereClause,
  onWhereClauseChange,
  onApplyFilter,
  showLogicalNames,
}: DataTabProps) {
  const gridRef = useRef<AgGridReact>(null);
  const [gridApi, setGridApi] = useState<GridApi | null>(null);

  const columnDefs = useMemo<ColDef[]>(() => {
    if (!resultSet) return [];

    // Helper function to check if a column type is numeric
    const isNumericType = (typeName: string): boolean => {
      const numericTypes = [
        'int',
        'integer',
        'bigint',
        'smallint',
        'tinyint',
        'decimal',
        'numeric',
        'money',
        'smallmoney',
        'float',
        'real',
        'double',
        'number',
        'bit',
      ];
      const lowerType = typeName.toLowerCase();
      return numericTypes.some((t) => lowerType.includes(t));
    };

    // Helper function to check if a column type is text
    const isTextType = (typeName: string): boolean => {
      const textTypes = ['char', 'varchar', 'nchar', 'nvarchar', 'text', 'ntext', 'string'];
      const lowerType = typeName.toLowerCase();
      return textTypes.some((t) => lowerType.includes(t));
    };

    // Determine text alignment based on column type
    const getCellAlignment = (typeName: string): string => {
      if (isNumericType(typeName)) {
        return 'right'; // Numbers: right-align
      }
      if (isTextType(typeName)) {
        return 'left'; // Text: left-align
      }
      return 'center'; // Others (date, time, etc.): center-align
    };

    return resultSet.columns.map((col) => ({
      field: col.name,
      headerName: showLogicalNames ? col.name : col.name, // TODO: Use logical name when available
      headerTooltip: `${col.name} (${col.type})`,
      sortable: true,
      filter: true,
      resizable: true,
      cellStyle: { textAlign: getCellAlignment(col.type) },
      cellClass: (params: CellClassParams) => {
        if (params.value === null || params.value === '') {
          return styles.nullCell;
        }
        return '';
      },
      valueFormatter: (params) => {
        if (params.value === null || params.value === undefined) {
          return 'NULL';
        }
        return params.value;
      },
    }));
  }, [resultSet, showLogicalNames]);

  // For large datasets, use optimized loop instead of map
  const rowData = useMemo(() => {
    if (!resultSet) return [];

    const rows = resultSet.rows;
    const cols = resultSet.columns;
    const result = new Array(rows.length);

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      const obj: Record<string, string | null> = {
        __rowIndex: String(rowIndex + 1),
      };

      for (let colIdx = 0; colIdx < cols.length; colIdx++) {
        const value = row[colIdx];
        obj[cols[colIdx].name] = value === '' || value === undefined ? null : value;
      }

      result[rowIndex] = obj;
    }

    return result;
  }, [resultSet]);

  const onGridReady = useCallback(
    (params: GridReadyEvent) => {
      setGridApi(params.api);
      // Auto-size all columns to fit content after grid is ready
      // Skip auto-size for large datasets (>10000 rows) to improve performance
      if (resultSet && resultSet.rows.length <= 10000) {
        params.api.autoSizeAllColumns();
      }
    },
    [resultSet]
  );

  // Auto-size columns when data changes (only for small datasets)
  useEffect(() => {
    if (gridApi && resultSet && resultSet.rows.length <= 10000) {
      // Wait for rendering to complete, then auto-size all columns
      requestAnimationFrame(() => {
        gridApi.autoSizeAllColumns();
      });
    }
  }, [gridApi, resultSet]);

  const handleWhereKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        onApplyFilter();
      }
    },
    [onApplyFilter]
  );

  const handleAutoSizeColumns = useCallback(() => {
    if (gridApi) {
      gridApi.autoSizeAllColumns();
    }
  }, [gridApi]);

  if (!resultSet) {
    return <div className={styles.emptyState}>No data loaded</div>;
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* WHERE Filter Bar */}
      <div className={styles.filterBar}>
        <span className={styles.filterLabel}>WHERE</span>
        <input
          type="text"
          className={styles.filterInput}
          placeholder="e.g. id > 100 AND name LIKE '%test%'"
          value={whereClause}
          onChange={(e) => onWhereClauseChange(e.target.value)}
          onKeyDown={handleWhereKeyDown}
        />
        <button className={styles.filterButton} onClick={onApplyFilter}>
          Apply
        </button>
        <button
          className={styles.filterButton}
          onClick={() => {
            onWhereClauseChange('');
            onApplyFilter();
          }}
          disabled={!whereClause}
        >
          Clear
        </button>
        <button
          className={styles.filterButton}
          onClick={handleAutoSizeColumns}
          disabled={!gridApi}
          title="Auto-size All Columns"
        >
          Resize Columns
        </button>
      </div>

      {/* Data Grid */}
      <div className={`ag-theme-alpine-dark ${styles.gridContainer}`}>
        <AgGridReact
          ref={gridRef}
          columnDefs={columnDefs}
          rowData={rowData}
          defaultColDef={{
            minWidth: 100,
            sortable: true,
            filter: true,
            resizable: true,
          }}
          onGridReady={onGridReady}
          enableCellTextSelection={true}
          ensureDomOrder={false}
          animateRows={false}
          rowBuffer={10}
          rowSelection="multiple"
          suppressRowClickSelection={false}
          copyHeadersToClipboard={true}
          suppressCopyRowsToClipboard={false}
          suppressColumnVirtualisation={false}
          suppressRowHoverHighlight={false}
          suppressAnimationFrame={true}
        />
      </div>

      {/* Status Bar */}
      <div className={styles.statusBar}>
        <span>{resultSet.rows.length} rows</span>
        <span>|</span>
        <span>{resultSet.executionTimeMs.toFixed(2)} ms</span>
      </div>
    </div>
  );
}
