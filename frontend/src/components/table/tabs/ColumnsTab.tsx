import { useMemo } from 'react';
import type { Column } from '../../../types';
import { SimpleTable } from '../../common/SimpleTable';

interface ColumnsTabProps {
  columns: Column[];
  showLogicalNames: boolean;
}

export function ColumnsTab({ columns, showLogicalNames }: ColumnsTabProps) {
  const tableColumns = useMemo(
    () => [
      { field: 'ordinal', headerName: '#', width: 60 },
      {
        field: 'name',
        headerName: showLogicalNames ? 'Logical Name' : 'Column Name',
        width: '25%',
      },
      { field: 'type', headerName: 'Data Type', width: 120 },
      {
        field: 'size',
        headerName: 'Size',
        width: 80,
        formatter: (value: unknown) => {
          const num = Number(value);
          if (num === 0 || num === -1) return 'MAX';
          return String(value ?? '');
        },
      },
      {
        field: 'nullable',
        headerName: 'Nullable',
        width: 80,
        formatter: (value: unknown) => (value ? 'Yes' : 'No'),
      },
      {
        field: 'isPrimaryKey',
        headerName: 'PK',
        width: 60,
        formatter: (value: unknown) => (value ? 'Yes' : ''),
      },
    ],
    [showLogicalNames]
  );

  const data = useMemo(
    () =>
      columns.map((col, idx) => ({
        ordinal: idx + 1,
        name: col.name,
        type: col.type,
        size: col.size,
        nullable: col.nullable,
        isPrimaryKey: col.isPrimaryKey,
      })),
    [columns]
  );

  return <SimpleTable columns={tableColumns} data={data} />;
}
