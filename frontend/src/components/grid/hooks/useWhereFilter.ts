import { useCallback, useState } from 'react';

interface UseWhereFilterParams {
  activeQueryId: string | null;
  queryConnectionId: string | null;
  applyWhereFilter: (
    queryId: string,
    connectionId: string,
    whereClause: string
  ) => Promise<string | null>;
}

export function useWhereFilter({
  activeQueryId,
  queryConnectionId,
  applyWhereFilter,
}: UseWhereFilterParams) {
  const [whereClause, setWhereClause] = useState('');
  const [whereFilterError, setWhereFilterError] = useState<string | null>(null);

  const whereKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && activeQueryId && queryConnectionId) {
        applyWhereFilter(activeQueryId, queryConnectionId, whereClause).then((errorMessage) => {
          if (errorMessage) setWhereFilterError(errorMessage);
        });
      }
    },
    [activeQueryId, queryConnectionId, whereClause, applyWhereFilter]
  );

  const whereApply = useCallback(() => {
    if (activeQueryId && queryConnectionId) {
      applyWhereFilter(activeQueryId, queryConnectionId, whereClause).then((errorMessage) => {
        if (errorMessage) setWhereFilterError(errorMessage);
      });
    }
  }, [activeQueryId, queryConnectionId, whereClause, applyWhereFilter]);

  const whereClear = useCallback(() => {
    setWhereClause('');
    setWhereFilterError(null);
    if (activeQueryId && queryConnectionId) {
      applyWhereFilter(activeQueryId, queryConnectionId, '').then((errorMessage) => {
        if (errorMessage) setWhereFilterError(errorMessage);
      });
    }
  }, [activeQueryId, queryConnectionId, applyWhereFilter]);

  return {
    whereClause,
    setWhereClause,
    whereFilterError,
    setWhereFilterError,
    whereKeyDown,
    whereApply,
    whereClear,
  };
}
