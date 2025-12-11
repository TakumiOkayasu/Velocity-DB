import { useMemo } from 'react';
import type { IndexInfo } from '../../../types';
import { SimpleTable } from '../../common/SimpleTable';

interface IndexesTabProps {
  indexes: IndexInfo[];
  showLogicalNames: boolean;
}

export function IndexesTab({ indexes, showLogicalNames }: IndexesTabProps) {
  const tableColumns = useMemo(
    () => [
      { field: 'name', headerName: showLogicalNames ? 'Logical Name' : 'Index Name', width: '30%' },
      { field: 'type', headerName: 'Type', width: 120 },
      { field: 'columns', headerName: 'Columns', width: '40%' },
      {
        field: 'isUnique',
        headerName: 'Unique',
        width: 80,
        formatter: (value: unknown) => (value ? 'Yes' : 'No'),
      },
    ],
    [showLogicalNames]
  );

  const data = useMemo(
    () =>
      indexes.map((index) => ({
        name: index.name,
        type: index.type,
        columns: index.columns.join(', '),
        isUnique: index.isUnique,
      })),
    [indexes]
  );

  return <SimpleTable columns={tableColumns} data={data} />;
}
