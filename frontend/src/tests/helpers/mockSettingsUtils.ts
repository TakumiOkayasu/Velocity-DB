import { vi } from 'vitest';

const mockSettings = {
  editor: { fontSize: 14, tabSize: 4, wordWrap: true, minimap: false },
  query: { autoCommit: true, timeout: 30000, maxRows: 10000 },
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
};

// Mock both the canonical location and the re-export
vi.mock('../../utils/settingsUtils', () => mockModule);
vi.mock('../../components/dialogs/settingsUtils', () => mockModule);
