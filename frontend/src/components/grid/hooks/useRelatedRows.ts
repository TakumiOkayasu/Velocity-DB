import { useCallback, useEffect, useState } from 'react';
import { bridge } from '../../../api/bridge';
import type { ForeignKeyInfo } from '../../../types';
import { log } from '../../../utils/logger';

interface UseRelatedRowsOptions {
  connectionId: string | null;
  tableName: string | null;
  onOpenRelatedTable: (tableName: string, whereClause: string) => void;
}

interface UseRelatedRowsResult {
  foreignKeys: ForeignKeyInfo[];
  isForeignKeyColumn: (columnName: string) => boolean;
  getForeignKeyInfo: (columnName: string) => ForeignKeyInfo | null;
  navigateToRelatedRow: (columnName: string, rowData: Record<string, string | null>) => void;
}

export function useRelatedRows({
  connectionId,
  tableName,
  onOpenRelatedTable,
}: UseRelatedRowsOptions): UseRelatedRowsResult {
  const [foreignKeys, setForeignKeys] = useState<ForeignKeyInfo[]>([]);

  // Fetch foreign keys when table changes
  useEffect(() => {
    if (!connectionId || !tableName) {
      setForeignKeys([]);
      return;
    }

    const fetchForeignKeys = async () => {
      try {
        const fks = await bridge.getForeignKeys(connectionId, tableName);
        setForeignKeys(fks);
        log.debug(`[useRelatedRows] Loaded ${fks.length} foreign keys for ${tableName}`);
      } catch (error) {
        log.error(`[useRelatedRows] Failed to fetch foreign keys: ${error}`);
        setForeignKeys([]);
      }
    };

    fetchForeignKeys();
  }, [connectionId, tableName]);

  const isForeignKeyColumn = useCallback(
    (columnName: string): boolean => {
      return foreignKeys.some((fk) => fk.columns.includes(columnName));
    },
    [foreignKeys]
  );

  const getForeignKeyInfo = useCallback(
    (columnName: string): ForeignKeyInfo | null => {
      return foreignKeys.find((fk) => fk.columns.includes(columnName)) ?? null;
    },
    [foreignKeys]
  );

  const navigateToRelatedRow = useCallback(
    (columnName: string, rowData: Record<string, string | null>) => {
      const fkInfo = getForeignKeyInfo(columnName);
      if (!fkInfo) {
        log.debug(`[useRelatedRows] No FK info for column: ${columnName}`);
        return;
      }

      // Build WHERE clause for referenced table
      const whereClauses: string[] = [];
      for (let i = 0; i < fkInfo.columns.length; i++) {
        const fkColumn = fkInfo.columns[i];
        const refColumn = fkInfo.referencedColumns[i];
        const fkValue = rowData[fkColumn];

        if (fkValue === null) {
          whereClauses.push(`[${refColumn}] IS NULL`);
        } else {
          whereClauses.push(`[${refColumn}] = N'${fkValue.replace(/'/g, "''")}'`);
        }
      }

      const whereClause = whereClauses.join(' AND ');
      log.debug(`[useRelatedRows] Navigate to ${fkInfo.referencedTable} WHERE ${whereClause}`);

      onOpenRelatedTable(fkInfo.referencedTable, whereClause);
    },
    [getForeignKeyInfo, onOpenRelatedTable]
  );

  return {
    foreignKeys,
    isForeignKeyColumn,
    getForeignKeyInfo,
    navigateToRelatedRow,
  };
}
