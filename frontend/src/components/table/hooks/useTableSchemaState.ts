import { useState } from 'react';
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
  setColumns: (v: Column[]) => void;
  indexes: IndexInfo[];
  setIndexes: (v: IndexInfo[]) => void;
  constraints: ConstraintInfo[];
  setConstraints: (v: ConstraintInfo[]) => void;
  foreignKeys: ForeignKeyInfo[];
  setForeignKeys: (v: ForeignKeyInfo[]) => void;
  referencingForeignKeys: ReferencingForeignKeyInfo[];
  setReferencingForeignKeys: (v: ReferencingForeignKeyInfo[]) => void;
  triggers: TriggerInfo[];
  setTriggers: (v: TriggerInfo[]) => void;
  metadata: TableMetadata | null;
  setMetadata: (v: TableMetadata | null) => void;
  ddl: string;
  setDdl: (v: string) => void;
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
