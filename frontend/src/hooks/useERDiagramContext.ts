import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useERDiagramStore } from '../store/erDiagramStore';
import type { ERRelationEdge, ERShapeNode, ERTableNode } from '../types';
import { ALL_PAGES, DEFAULT_PAGE } from '../utils/erDiagramConstants';

export interface ERDiagramContextValue {
  pages: string[];
  selectedPage: string;
  setSelectedPage: (page: string) => void;
  pageCounts: Map<string, number>;
  totalTableCount: number;
  tables: ERTableNode[];
  relations: ERRelationEdge[];
  shapes: ERShapeNode[];
  isLoading: boolean;
  error: string | null;
}

/**
 * ER図表示に必要な全データを提供するContext Hook。
 * Store への直接アクセスをカプセル化し、View と Store を分離する。
 */
export function useERDiagramContext(): ERDiagramContextValue {
  const { allTables, allRelations, allShapes, selectedPage, setSelectedPage, isLoading, error } =
    useERDiagramStore(
      useShallow((s) => ({
        allTables: s.tables,
        allRelations: s.relations,
        allShapes: s.shapes,
        selectedPage: s.selectedPage,
        setSelectedPage: s.setSelectedPage,
        isLoading: s.isLoading,
        error: s.error,
      }))
    );

  // pages と pageCounts を1回の走査で同時計算
  const { pages, pageCounts } = useMemo(() => {
    const countMap = new Map<string, number>();
    countMap.set(ALL_PAGES, allTables.length);
    for (const t of allTables) {
      const page = t.data.page || DEFAULT_PAGE;
      countMap.set(page, (countMap.get(page) || 0) + 1);
    }
    const pageList = Array.from(countMap.keys()).filter((k) => k !== ALL_PAGES);
    return { pages: pageList, pageCounts: countMap };
  }, [allTables]);

  const tables = useMemo(() => {
    if (selectedPage === ALL_PAGES) return allTables;
    return allTables.filter((t) => (t.data.page || DEFAULT_PAGE) === selectedPage);
  }, [allTables, selectedPage]);

  const relations = useMemo(() => {
    const tableIds = new Set(tables.map((t) => t.id));
    return allRelations.filter((r) => tableIds.has(r.source) && tableIds.has(r.target));
  }, [allRelations, tables]);

  const shapes = useMemo(() => {
    if (selectedPage === ALL_PAGES) return allShapes;
    return allShapes.filter((s) => (s.data.page || DEFAULT_PAGE) === selectedPage);
  }, [allShapes, selectedPage]);

  return {
    pages,
    selectedPage,
    setSelectedPage,
    pageCounts,
    totalTableCount: allTables.length,
    tables,
    relations,
    shapes,
    isLoading,
    error,
  };
}
