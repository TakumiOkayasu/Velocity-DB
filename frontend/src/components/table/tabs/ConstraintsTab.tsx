import { useMemo } from 'react';
import type { ConstraintInfo } from '../../../types';
import { SimpleTable } from '../../common/SimpleTable';

interface ConstraintsTabProps {
  constraints: ConstraintInfo[];
}

export function ConstraintsTab({ constraints }: ConstraintsTabProps) {
  const tableColumns = useMemo(
    () => [
      { field: 'name', headerName: 'Constraint Name', width: '30%' },
      { field: 'type', headerName: 'Type', width: 120 },
      { field: 'definition', headerName: 'Definition', width: '50%' },
    ],
    []
  );

  const data = useMemo(
    () =>
      constraints.map((constraint) => ({
        name: constraint.name,
        type: constraint.type,
        definition: constraint.definition,
      })),
    [constraints]
  );

  return <SimpleTable columns={tableColumns} data={data} />;
}
