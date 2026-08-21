import { useCallback, useEffect, useState } from 'react';

interface UseWhereFilterParams {
  activeQueryId: string | null;
  queryConnectionId: string | null;
  storedWhereClause: string;
  applyWhereFilter: (
    queryId: string,
    connectionId: string,
    whereClause: string
  ) => Promise<string | null>;
}

export function useWhereFilter({
  activeQueryId,
  queryConnectionId,
  storedWhereClause,
  applyWhereFilter,
}: UseWhereFilterParams) {
  const [whereClause, setWhereClause] = useState(storedWhereClause);
  const [whereFilterError, setWhereFilterError] = useState<string | null>(null);

  /* oxlint-disable react-hooks/exhaustive-deps -- intentionally triggered by activeQueryId change */
  useEffect(() => {
    setWhereClause(storedWhereClause);
    setWhereFilterError(null);
  }, [activeQueryId]);
  /* oxlint-enable react-hooks/exhaustive-deps */

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

  const whereChange = useCallback(
    (value: string) => {
      setWhereClause(value);
      if (value.trim() === '' && storedWhereClause !== '' && activeQueryId && queryConnectionId) {
        applyWhereFilter(activeQueryId, queryConnectionId, '').then((errorMessage) => {
          setWhereFilterError(errorMessage);
        });
      }
    },
    [storedWhereClause, activeQueryId, queryConnectionId, applyWhereFilter]
  );

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
    whereChange,
  };
}
