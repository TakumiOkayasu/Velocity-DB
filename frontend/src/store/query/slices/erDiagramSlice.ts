import { createERDiagramStore } from '../../erDiagramStore';
import type { Query } from '../../../types';
import { generateQueryId } from '../helpers/executionState';
import { toQueriesById } from '../helpers/queriesMap';
import type { ERDiagrammable } from '../interfaces/ERDiagrammable';
import type { GetState, SetState } from '../types';

export function createERDiagramSlice(set: SetState, get: GetState): ERDiagrammable {
  return {
    openERDiagram: (name, model) => {
      if (!model) {
        const existing = get().queries.find((q) => q.erDiagram && q.name === name);
        if (existing) {
          set({ activeQueryId: existing.id });
          return existing.id;
        }
      }

      const id = generateQueryId();
      const erDiagram = createERDiagramStore();
      if (model) erDiagram.getState().loadFromParsedModel(model);
      const newQuery: Query = {
        id,
        name,
        content: '',
        connectionId: null,
        isDirty: false,
        erDiagram,
      };

      set((state) => {
        const newQueries = [...state.queries, newQuery];
        return { queries: newQueries, queriesById: toQueriesById(newQueries), activeQueryId: id };
      });

      return id;
    },
  };
}
