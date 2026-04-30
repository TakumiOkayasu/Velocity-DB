import { type Dispatch, type SetStateAction, useState } from 'react';
import type { ResultSet } from '../../../types';

export interface UseTableDataStateReturn {
  resultSet: ResultSet | null;
  setResultSet: Dispatch<SetStateAction<ResultSet | null>>;
  whereClause: string;
  setWhereClause: Dispatch<SetStateAction<string>>;
}

export function useTableDataState(): UseTableDataStateReturn {
  const [resultSet, setResultSet] = useState<ResultSet | null>(null);
  const [whereClause, setWhereClause] = useState('');

  return {
    resultSet,
    setResultSet,
    whereClause,
    setWhereClause,
  };
}
