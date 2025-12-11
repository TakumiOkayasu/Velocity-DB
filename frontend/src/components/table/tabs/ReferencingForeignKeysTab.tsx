import { useMemo } from 'react';
import type { ReferencingForeignKeyInfo } from '../../../types';
import { SimpleTable } from '../../common/SimpleTable';

interface ReferencingForeignKeysTabProps {
  referencingForeignKeys: ReferencingForeignKeyInfo[];
}

export function ReferencingForeignKeysTab({
  referencingForeignKeys,
}: ReferencingForeignKeysTabProps) {
  const tableColumns = useMemo(
    () => [
      { field: 'name', headerName: 'FK Name', width: '25%' },
      { field: 'table', headerName: 'Referencing Table', width: '25%' },
      { field: 'column', headerName: 'Referencing Column', width: '20%' },
      { field: 'referencedColumn', headerName: 'Referenced Column', width: '20%' },
    ],
    []
  );

  const data = useMemo(
    () =>
      referencingForeignKeys.map((fk) => ({
        name: fk.name,
        table: fk.referencingTable,
        column: fk.referencingColumns.join(', '),
        referencedColumn: fk.columns.join(', '),
      })),
    [referencingForeignKeys]
  );

  return <SimpleTable columns={tableColumns} data={data} />;
}
