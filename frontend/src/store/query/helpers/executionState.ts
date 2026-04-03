import type { QueryState } from '../types';

let queryCounter = 0;

export function generateQueryId(): string {
  return `query-${++queryCounter}`;
}

export function getQueryCounter(): number {
  return queryCounter;
}

/** Reset counter for tests / HMR. Not for production use. */
export function resetQueryCounter(): void {
  queryCounter = 0;
}

export type ExecutionFields = Pick<QueryState, 'executingQueryIds' | 'errors' | 'isExecuting'>;

export function startExecution(state: ExecutionFields, id: string): Partial<ExecutionFields> {
  const newExecuting = new Set(state.executingQueryIds).add(id);
  return {
    executingQueryIds: newExecuting,
    errors: { ...state.errors, [id]: null },
    isExecuting: true,
  };
}

export function endExecution(state: ExecutionFields, id: string): Partial<ExecutionFields> {
  const newExecuting = new Set(state.executingQueryIds);
  newExecuting.delete(id);
  return {
    executingQueryIds: newExecuting,
    isExecuting: newExecuting.size > 0,
  };
}

export function failExecution(
  state: ExecutionFields,
  id: string,
  errorMessage: string
): Partial<ExecutionFields> {
  return {
    ...endExecution(state, id),
    errors: { ...state.errors, [id]: errorMessage },
  };
}
