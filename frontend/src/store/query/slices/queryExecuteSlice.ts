import { bridge as apiBridge } from '../../../api/bridge';
import type { SqlMarkerInput } from '../../../utils/editorMarkers';
import { parseErrorMessage } from '../../../utils/errorParser';
import { log } from '../../../utils/logger';
import { getSettings } from '../../../utils/settingsUtils';
import {
  buildDropTableSql,
  buildTruncateTableSql,
  parseDropOrTruncate,
  SQL_BEGIN_TRANSACTION,
} from '../../../utils/sqlIdentifier';
import { useConnectionStore } from '../../connectionStore';
import { useToastStore } from '../../toastStore';
import { executeAsyncWithPolling, toQueryResult } from '../helpers/asyncPolling';
import { endExecution, failExecution, startExecution } from '../helpers/executionState';
import { fetchAndUpdateRowCount } from '../helpers/paginationHelper';
import type { AbortRegistrable } from '../interfaces/AbortRegistrable';
import type { Executable } from '../interfaces/Executable';
import type { PaginatedBridgeable } from '../interfaces/PaginatedBridgeable';
import type { QueryBridgeable } from '../interfaces/QueryBridgeable';
import type { GetState, SetState } from '../types';

interface ExecuteSliceDeps {
  bridge: QueryBridgeable & PaginatedBridgeable;
  abort: AbortRegistrable;
}

function hasExplicitLimit(sql: string): boolean {
  return (
    /\bTOP\s+\d+\b/i.test(sql) ||
    /\bLIMIT\s+\d+\b/i.test(sql) ||
    /\bFETCH\s+(?:FIRST|NEXT)\s+\d+/i.test(sql)
  );
}

const STALE_CONNECTION_PATTERN = /Connection not found|is no longer active/i;
// ODBCエラーは通常 column 情報を持たない。行頭にマーカー配置 (editorMarkers が行末まで伸ばす)
const RUNTIME_MARKER_DEFAULT_COLUMN = 1;

function recoverStaleConnection(
  set: SetState,
  get: GetState,
  id: string,
  staleConnectionId: string
): void {
  const activeConnId = useConnectionStore.getState().activeConnectionId;
  const canRebind = !!activeConnId && activeConnId !== staleConnectionId;
  if (canRebind) {
    get().updateQueryConnection(id, activeConnId);
    set((state) =>
      failExecution(
        state,
        id,
        `接続 ${staleConnectionId} は失われました。アクティブ接続 ${activeConnId} に再バインドしたので、もう一度実行してください。`
      )
    );
    return;
  }
  get().updateQueryConnection(id, null);
  set((state) =>
    failExecution(
      state,
      id,
      `接続 ${staleConnectionId} は失われました。接続ツリーから接続を選択し直してください。`
    )
  );
}

export function createExecuteSlice(
  set: SetState,
  get: GetState,
  deps: ExecuteSliceDeps
): Executable {
  const { bridge, abort } = deps;

  const activeQueryIds = new Map<string, string>();

  async function rewriteWithFkHandling(connectionId: string, sql: string): Promise<string[]> {
    const parsed = parseDropOrTruncate(sql);
    if (!parsed) return [sql];

    const conn = useConnectionStore.getState().connections.find((c) => c.id === connectionId);
    const dbType = conn?.dbType;
    const fullName = parsed.schema ? `${parsed.schema}.${parsed.table}` : parsed.table;

    try {
      const fks = await apiBridge.getReferencingForeignKeys(connectionId, fullName);
      if (fks.length === 0) return [sql];

      if (parsed.type === 'drop') {
        return buildDropTableSql(parsed.schema, parsed.table, dbType, fks);
      }
      return buildTruncateTableSql(parsed.schema, parsed.table, dbType, fks);
    } catch (error) {
      log.error(`[queryExecuteSlice] FK lookup failed, executing original SQL: ${error}`);
      return [sql];
    }
  }

  function buildSyntaxErrorToast(markers: SqlMarkerInput[]): string {
    const first = markers[0];
    if (markers.length === 1) return `構文エラー: L${first.line} ${first.message}`;
    return `構文エラー ${markers.length}件 (L${first.line}...): エディタのマーカーを参照`;
  }

  async function precheckWithSqruff(
    id: string,
    connectionId: string,
    sql: string
  ): Promise<SqlMarkerInput[] | null> {
    // dialect判定不能ならlintスキップ (実行側のfail-openに委ねる)
    const conn = useConnectionStore.getState().connections.find((c) => c.id === connectionId);
    if (!conn?.dbType) return null;

    try {
      const result = await apiBridge.lintSql(sql, conn.dbType);
      if (result.lintUnavailable) {
        log.warning(`[queryExecuteSlice] lint unavailable: ${result.reason ?? 'unknown'}`);
        return null;
      }
      // backend側で既にPRSのみに絞り込み済み。diagnostics破損時の保険として再確認
      const prs = result.diagnostics.filter((d) => d.code.startsWith('PRS'));
      if (prs.length === 0) return null;
      const markers: SqlMarkerInput[] = prs.map((d) => ({
        line: d.line,
        column: d.column,
        code: d.code,
        message: d.message,
      }));
      set((state) => ({
        lintDiagnostics: { ...state.lintDiagnostics, [id]: markers },
      }));
      useToastStore.getState().addToast(buildSyntaxErrorToast(markers), 'error');
      return markers;
    } catch (error) {
      log.warning(`[queryExecuteSlice] lint invocation failed: ${error}`);
      return null;
    }
  }

  async function executeAsync(id: string, connectionId: string, sql: string): Promise<void> {
    // 事前lint: 構文エラー(PRS)検出時はexecuteQueryを呼ばずmarkerのみ
    const prsMarkers = await precheckWithSqruff(id, connectionId, sql);
    if (prsMarkers) {
      set((state) => failExecution(state, id, prsMarkers[0].message));
      return;
    }
    // lint通過 or lintUnavailable: 古いmarker(sqruff/runtime両方)をクリアして実行継続
    set((state) => ({
      lintDiagnostics: { ...state.lintDiagnostics, [id]: [] },
      runtimeDiagnostics: { ...state.runtimeDiagnostics, [id]: [] },
    }));

    const controller = new AbortController();
    abort.register(id, controller);

    set((state) => startExecution(state, id));

    try {
      // FK制約自動処理: DROP/TRUNCATE TABLE検出時のみ非同期でSQL書き換え
      const parsed = parseDropOrTruncate(sql);
      if (parsed) {
        const sqls = await rewriteWithFkHandling(connectionId, sql);
        if (sqls.length > 1) {
          const hasTransaction = sqls[0] === SQL_BEGIN_TRANSACTION;
          try {
            for (const s of sqls) {
              await apiBridge.executeQuery(connectionId, s, false);
            }
          } catch (error) {
            if (hasTransaction) {
              await apiBridge.executeQuery(connectionId, 'ROLLBACK', false).catch(() => {});
            }
            throw error;
          }
          set((state) => ({
            ...endExecution(state, id),
            results: {
              ...state.results,
              [id]: {
                columns: [],
                rows: [],
                affectedRows: 0,
                executionTimeMs: 0,
                message: `${sqls.length} statements executed successfully`,
              },
            },
          }));
          return;
        }
      }

      const timeoutMs = getSettings().query.timeout;
      const result = await executeAsyncWithPolling(
        bridge,
        connectionId,
        sql,
        controller.signal,
        (queryId) => {
          activeQueryIds.set(id, queryId);
        },
        timeoutMs
      );

      const queryResult = toQueryResult(result);

      set((state) => ({
        ...endExecution(state, id),
        results: { ...state.results, [id]: queryResult },
      }));

      if (
        !result.multipleResults &&
        result.truncated &&
        !hasExplicitLimit(sql) &&
        'rows' in queryResult
      ) {
        set((state) => ({
          paginationStates: {
            ...state.paginationStates,
            [id]: {
              totalRowCount: -1,
              loadedRowCount: queryResult.rows.length,
              isLoadingMore: false,
              hasMore: true,
              baseSql: sql,
              connectionId,
            },
          },
        }));

        fetchAndUpdateRowCount(set, bridge, id, sql, connectionId);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        set((state) => endExecution(state, id));
        return;
      }
      const errorMessage = error instanceof Error ? error.message : 'Query execution failed';

      if (STALE_CONNECTION_PATTERN.test(errorMessage)) {
        recoverStaleConnection(set, get, id, connectionId);
        return;
      }

      // 行情報が取れた場合のみruntime markerセット (owner: runtime)。failExecution と1回にまとめる
      const parsedErr = parseErrorMessage(errorMessage);
      const runtimeMarker: SqlMarkerInput | null =
        parsedErr.line !== undefined
          ? {
              line: parsedErr.line,
              column: RUNTIME_MARKER_DEFAULT_COLUMN,
              message: parsedErr.summary,
            }
          : null;
      set((state) => ({
        ...failExecution(state, id, errorMessage),
        ...(runtimeMarker && {
          runtimeDiagnostics: { ...state.runtimeDiagnostics, [id]: [runtimeMarker] },
        }),
      }));
    } finally {
      activeQueryIds.delete(id);
      abort.unregister(id);
    }
  }

  function clearPagination(id: string): void {
    set((state) => {
      const { [id]: _, ...rest } = state.paginationStates;
      return { paginationStates: rest };
    });
  }

  return {
    executeQuery: async (id, connectionId) => {
      const query = get().queries.find((q) => q.id === id);
      if (!query || !query.content.trim()) return;
      clearPagination(id);
      await executeAsync(id, connectionId, query.content);
    },

    executeSelectedText: async (id, connectionId, selectedText) => {
      if (!selectedText.trim()) return;
      clearPagination(id);
      await executeAsync(id, connectionId, selectedText);
    },

    cancelQuery: async (connectionId) => {
      const { executingQueryIds, activeQueryId } = get();
      try {
        // Three-phase cancel: cancelAsyncQuery → abort → cancelQuery
        for (const id of executingQueryIds) {
          const queryId = activeQueryIds.get(id);
          if (queryId) {
            bridge.cancelAsyncQuery(queryId).catch((err) => {
              console.error('Failed to cancel async query:', err);
            });
          }
          abort.abort(id);
        }
        await bridge.cancelQuery(connectionId);
      } catch (error) {
        set((state) => ({
          errors: activeQueryId
            ? {
                ...state.errors,
                [activeQueryId]: error instanceof Error ? error.message : 'Failed to cancel query',
              }
            : state.errors,
        }));
      }
    },
  };
}
