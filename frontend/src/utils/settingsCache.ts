import { appSettingsProvider } from '../api/providers';
import type { AppSettings as BackendSettings } from '../api/providers/app-settings';
import { type AppSettings, getSettings, SETTINGS_CHANGED_EVENT } from './settingsUtils';

export function mergeBackendSettings(local: AppSettings, backend: BackendSettings): AppSettings {
  return {
    ...local,
    general: { ...local.general, ...backend.general },
    editor: {
      ...local.editor,
      fontSize: backend.editor.fontSize,
      fontFamily: backend.editor.fontFamily,
      tabSize: backend.editor.tabSize,
      wordWrap: backend.editor.wordWrap,
    },
    grid: { ...local.grid, ...backend.grid },
    query: { ...local.query, timeout: backend.query.timeoutSeconds * 1000 },
  };
}

export function cacheSettings(settings: AppSettings): void {
  localStorage.setItem('app-settings', JSON.stringify(settings));
  window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT));
}

/** Hydrate consumers even if the settings dialog is never opened. A later save wins. */
export async function loadSettingsCache(): Promise<void> {
  const initial = localStorage.getItem('app-settings');
  const backend = await appSettingsProvider.getSettings();
  if (localStorage.getItem('app-settings') !== initial) return;
  cacheSettings(mergeBackendSettings(getSettings(), backend));
}
