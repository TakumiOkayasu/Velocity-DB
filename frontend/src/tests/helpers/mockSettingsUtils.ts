import { vi } from 'vite-plus/test';

const mockSettings = {
  version: 2,
  general: { autoConnect: false, confirmOnExit: true, maxQueryHistory: 1000, language: 'en' },
  editor: { fontSize: 14, fontFamily: 'Consolas', tabSize: 4, wordWrap: true, minimap: false },
  query: { autoCommit: true, timeout: 300000, maxRows: 10000 },
  grid: { defaultPageSize: 100000, showRowNumbers: true, nullDisplay: '(NULL)' },
  appearance: { theme: 'dark' as const },
  shortcuts: {
    execute: 'F9',
    newQuery: 'Ctrl+N',
    format: 'Ctrl+Shift+F',
    search: 'Ctrl+Shift+P',
  },
};

const mockModule = {
  defaultSettings: mockSettings,
  getSettings: vi.fn(() => ({ ...mockSettings })),
  SETTINGS_CHANGED_EVENT: 'settings-changed',
};

// Mock both the canonical location and the re-export
vi.mock('../../utils/settingsUtils', () => mockModule);
vi.mock('../../components/dialogs/settingsUtils', () => mockModule);
