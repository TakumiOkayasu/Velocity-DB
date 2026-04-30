import { type Dispatch, type SetStateAction, useState } from 'react';
import type {
  Column,
  ConstraintInfo,
  ForeignKeyInfo,
  IndexInfo,
  ReferencingForeignKeyInfo,
  TableMetadata,
  TriggerInfo,
} from '../../../types';

export interface UseTableSchemaStateReturn {
  columns: Column[];
  setColumns: Dispatch<SetStateAction<Column[]>>;
  indexes: IndexInfo[];
  setIndexes: Dispatch<SetStateAction<IndexInfo[]>>;
  constraints: ConstraintInfo[];
  setConstraints: Dispatch<SetStateAction<ConstraintInfo[]>>;
  foreignKeys: ForeignKeyInfo[];
  setForeignKeys: Dispatch<SetStateAction<ForeignKeyInfo[]>>;
  referencingForeignKeys: ReferencingForeignKeyInfo[];
  setReferencingForeignKeys: Dispatch<SetStateAction<ReferencingForeignKeyInfo[]>>;
  triggers: TriggerInfo[];
  setTriggers: Dispatch<SetStateAction<TriggerInfo[]>>;
  metadata: TableMetadata | null;
  setMetadata: Dispatch<SetStateAction<TableMetadata | null>>;
  ddl: string;
  setDdl: Dispatch<SetStateAction<string>>;
}

export function useTableSchemaState(): UseTableSchemaStateReturn {
  const [columns, setColumns] = useState<Column[]>([]);
  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [constraints, setConstraints] = useState<ConstraintInfo[]>([]);
  const [foreignKeys, setForeignKeys] = useState<ForeignKeyInfo[]>([]);
  const [referencingForeignKeys, setReferencingForeignKeys] = useState<ReferencingForeignKeyInfo[]>(
    []
  );
  const [triggers, setTriggers] = useState<TriggerInfo[]>([]);
  const [metadata, setMetadata] = useState<TableMetadata | null>(null);
  const [ddl, setDdl] = useState<string>('');

  return {
    columns,
    setColumns,
    indexes,
    setIndexes,
    constraints,
    setConstraints,
    foreignKeys,
    setForeignKeys,
    referencingForeignKeys,
    setReferencingForeignKeys,
    triggers,
    setTriggers,
    metadata,
    setMetadata,
    ddl,
    setDdl,
  };
}
