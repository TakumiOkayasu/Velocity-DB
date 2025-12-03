import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SessionState {
  // Layout state
  leftPanelWidth: number
  bottomPanelHeight: number
  isLeftPanelVisible: boolean
  isBottomPanelVisible: boolean

  // Last used connection
  lastConnectionId: string | null

  // Open tabs (query IDs)
  openTabs: string[]
  activeTabId: string | null

  // Actions
  setLeftPanelWidth: (width: number) => void
  setBottomPanelHeight: (height: number) => void
  setLeftPanelVisible: (visible: boolean) => void
  setBottomPanelVisible: (visible: boolean) => void
  setLastConnectionId: (id: string | null) => void
  setOpenTabs: (tabs: string[]) => void
  setActiveTabId: (id: string | null) => void
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      leftPanelWidth: 250,
      bottomPanelHeight: 200,
      isLeftPanelVisible: true,
      isBottomPanelVisible: true,
      lastConnectionId: null,
      openTabs: [],
      activeTabId: null,

      setLeftPanelWidth: (width) => set({ leftPanelWidth: width }),
      setBottomPanelHeight: (height) => set({ bottomPanelHeight: height }),
      setLeftPanelVisible: (visible) => set({ isLeftPanelVisible: visible }),
      setBottomPanelVisible: (visible) => set({ isBottomPanelVisible: visible }),
      setLastConnectionId: (id) => set({ lastConnectionId: id }),
      setOpenTabs: (tabs) => set({ openTabs: tabs }),
      setActiveTabId: (id) => set({ activeTabId: id }),
    }),
    {
      name: 'session-state',
    }
  )
)
