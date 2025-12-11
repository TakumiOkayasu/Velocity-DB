import { useMemo } from 'react';
import type { ForeignKeyInfo } from '../../../types';
import { SimpleTable } from '../../common/SimpleTable';

interface ForeignKeysTabProps {
  foreignKeys: ForeignKeyInfo[];
}

export function ForeignKeysTab({ foreignKeys }: ForeignKeysTabProps) {
  const tableColumns = useMemo(
    () => [
      { field: 'name', headerName: 'FK Name', width: '25%' },
      { field: 'column', headerName: 'Column', width: '20%' },
      { field: 'referencedTable', headerName: 'Referenced Table', width: '25%' },
      { field: 'referencedColumn', headerName: 'Referenced Column', width: '20%' },
    ],
    []
  );

  const data = useMemo(
    () =>
      foreignKeys.map((fk) => ({
        name: fk.name,
        column: fk.columns.join(', '),
        referencedTable: fk.referencedTable,
        referencedColumn: fk.referencedColumns.join(', '),
      })),
    [foreignKeys]
  );

  return <SimpleTable columns={tableColumns} data={data} />;
}
