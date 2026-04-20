import { create } from 'zustand';

/**
 * Preserves grid scroll position per queryId across tab switches.
 * Not persisted (session-only) — cleared on app restart.
 */
export interface ScrollPosition {
  top: number;
  left: number;
}

interface ScrollPositionState {
  positions: Record<string, ScrollPosition>;
  savePosition: (queryId: string, pos: ScrollPosition) => void;
  getPosition: (queryId: string) => ScrollPosition | undefined;
  clearPosition: (queryId: string) => void;
}

export const useScrollPositionStore = create<ScrollPositionState>((set, get) => ({
  positions: {},

  savePosition: (queryId, pos) => {
    set((state) => ({ positions: { ...state.positions, [queryId]: pos } }));
  },

  getPosition: (queryId) => get().positions[queryId],

  clearPosition: (queryId) => {
    set((state) => {
      if (!(queryId in state.positions)) return state;
      const { [queryId]: _removed, ...rest } = state.positions;
      return { positions: rest };
    });
  },
}));
