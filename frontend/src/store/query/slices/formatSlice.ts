import { formatSQL } from '../../../utils/sqlFormat';
import { useToastStore } from '../../toastStore';
import type { Formattable } from '../interfaces/Formattable';
import type { GetState, SetState } from '../types';

export function createFormatSlice(set: SetState, get: GetState): Formattable {
  return {
    formatQuery: async (id) => {
      const query = get().queries.find((q) => q.id === id);
      if (!query || !query.content.trim() || query.isDataView) return;

      try {
        const formatted = await formatSQL(query.content);
        set((state) => ({
          queries: state.queries.map((q) =>
            q.id === id ? { ...q, content: formatted, isDirty: true } : q
          ),
        }));
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Failed to format SQL';
        useToastStore.getState().addToast(`フォーマットできません: ${reason}`, 'error');
      }
    },

    clearError: (id?) => {
      if (id) {
        set((state) => ({
          errors: { ...state.errors, [id]: null },
        }));
      } else {
        set({ errors: {} });
      }
    },
  };
}
