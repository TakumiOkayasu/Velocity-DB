import { useCallback, useEffect, useMemo, useState } from 'react';
// bridge: getForeignKeys (Schema系) — #521 で SchemaProvider に移管予定
// queryProvider: buildWhereClause (Query系) — #520 移管済
import { bridge } from '../../../api/bridge';
import { queryProvider } from '../../../api/providers';
import type { ForeignKeyInfo } from '../../../types';
import { log } from '../../../utils/logger';

interface UseRelatedRowsOptions {
  connectionId: string | null;
  tableName: string | null;
  onOpenRelatedTable: (tableName: string, whereClause: string) => Promise<void> | void;
}

interface UseRelatedRowsResult {
  foreignKeys: ForeignKeyInfo[];
  isForeignKeyColumn: (columnName: string) => boolean;
  getForeignKeyInfo: (columnName: string) => ForeignKeyInfo | null;
  navigateToRelatedRow: (
    columnName: string,
    rowData: Record<string, string | null>
  ) => Promise<void>;
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

  // columnName -> FK の index map を一度だけ構築し、判定/取得を O(1) に
  // 元 .find() と揃えて先勝ち (同一 column が複数 FK に含まれる場合は配列先頭を優先)
  const fkByColumn = useMemo(() => {
    const map = new Map<string, ForeignKeyInfo>();
    for (const fk of foreignKeys) {
      for (const col of fk.columns) {
        if (!map.has(col)) map.set(col, fk);
      }
    }
    return map;
  }, [foreignKeys]);

  const isForeignKeyColumn = useCallback(
    (columnName: string): boolean => fkByColumn.has(columnName),
    [fkByColumn]
  );

  const getForeignKeyInfo = useCallback(
    (columnName: string): ForeignKeyInfo | null => fkByColumn.get(columnName) ?? null,
    [fkByColumn]
  );

  const navigateToRelatedRow = useCallback(
    async (columnName: string, rowData: Record<string, string | null>) => {
      if (!connectionId) return;

      const fkInfo = getForeignKeyInfo(columnName);
      if (!fkInfo) {
        log.debug(`[useRelatedRows] No FK info for column: ${columnName}`);
        return;
      }

      try {
        // W7: Guard against FK/referenced column count mismatch
        if (fkInfo.columns.length !== fkInfo.referencedColumns.length) {
          log.error(
            `[useRelatedRows] FK column count mismatch: ${fkInfo.columns.length} vs ${fkInfo.referencedColumns.length}`
          );
          return;
        }

        // Build WHERE clause via backend (dialect-aware)
        const conditions = fkInfo.columns.map((fkCol, i) => ({
          column: fkInfo.referencedColumns[i],
          value: rowData[fkCol],
        }));

        const { whereClause } = await queryProvider.buildWhereClause(connectionId, conditions);
        log.debug(`[useRelatedRows] Navigate to ${fkInfo.referencedTable} WHERE ${whereClause}`);

        await onOpenRelatedTable(fkInfo.referencedTable, whereClause);
      } catch (error) {
        log.error(`[useRelatedRows] Failed to navigate: ${error}`);
      }
    },
    [connectionId, getForeignKeyInfo, onOpenRelatedTable]
  );

  return {
    foreignKeys,
    isForeignKeyColumn,
    getForeignKeyInfo,
    navigateToRelatedRow,
  };
}
