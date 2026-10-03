import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vite-plus/test';
import { appSettingsProvider } from '../../api/providers';
import type { AppSettings as BackendAppSettings } from '../../api/providers/app-settings';
import { useEditorSettings } from '../../hooks/useEditorSettings';
import { useGridSettings } from '../../hooks/useGridSettings';
import { cacheSettings, loadSettingsCache } from '../../utils/settingsCache';
import { getSettings } from '../../utils/settingsUtils';
vi.mock('../../api/providers', () => ({ appSettingsProvider: { getSettings: vi.fn() } }));
const BACKEND_SETTINGS: BackendAppSettings = {
  general: {
    autoConnect: true,
    lastConnectionId: 'conn-1',
    confirmOnExit: false,
    maxQueryHistory: 250,
    maxRecentConnections: 10,
    language: 'ja',
  },
  editor: {
    fontSize: 18,
    fontFamily: 'Cascadia Code',
    wordWrap: false,
    tabSize: 2,
    insertSpaces: true,
    showLineNumbers: true,
    showMinimap: false,
    theme: 'dark',
  },
  grid: {
    defaultPageSize: 500,
    showRowNumbers: false,
    enableCellEditing: false,
    dateFormat: 'yyyy-MM-dd',
    nullDisplay: '<null>',
  },
  query: {
    timeoutSeconds: 45,
  },
};

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
});
it('hydrates editor and grid from backend without opening SettingsDialog', async () => {
  vi.mocked(appSettingsProvider.getSettings).mockResolvedValue(BACKEND_SETTINGS);
  const { result } = renderHook(() => ({ editor: useEditorSettings(), grid: useGridSettings() }));
  await act(() => loadSettingsCache());
  expect(result.current.editor.fontSize).toBe(18);
  expect(result.current.grid.defaultPageSize).toBe(500);
  expect(result.current.grid.nullDisplay).toBe('<null>');
});
it('does not replace a newer save with a late startup response', async () => {
  let finish: ((value: BackendAppSettings) => void) | undefined;
  vi.mocked(appSettingsProvider.getSettings).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const loading = loadSettingsCache();
  const settings = getSettings();
  cacheSettings({ ...settings, editor: { ...settings.editor, fontSize: 22 } });
  finish?.(BACKEND_SETTINGS);
  await loading;
  expect(getSettings().editor.fontSize).toBe(22);
});
