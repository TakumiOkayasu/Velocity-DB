import { connectionProfileProvider } from '../api/providers';
import { applyConnectionMigration } from '../store/connectionMigration';
import { useConnectionStore } from '../store/connectionStore';
import { useToastStore } from '../store/toastStore';
import { loadSettingsCache } from '../utils/settingsCache';
import { getSettings } from '../utils/settingsUtils';
import { normalizeProfile } from './normalizeProfile';
import { createSavedConnection } from './createSavedConnection';

let startup: Promise<void> | undefined;

/** One attempt per application lifetime, including React StrictMode remounts. */
export function initializeApplication(): Promise<void> {
  startup ??= restoreConnection();
  return startup;
}

async function restoreConnection(): Promise<void> {
  try {
    const settings = await loadSettingsCache();
    if (!getSettings().general.autoConnect || !settings.general.lastConnectionId) return;
    const idle = () => {
      const state = useConnectionStore.getState();
      return !state.isConnecting && state.connections.length === 0;
    };
    if (!idle()) return;
    const { profiles } = await connectionProfileProvider.getConnectionProfiles();
    const profile = profiles.find((item) => item.id === settings.general.lastConnectionId);
    if (!profile) {
      useToastStore
        .getState()
        .addToast('前回の接続設定が見つかりません。接続を選択してください。', 'info');
      return;
    }
    const prepared = await createSavedConnection(
      normalizeProfile(profile),
      connectionProfileProvider,
      useConnectionStore.getState().addConnection
    ).prepare();
    if (!idle() || !getSettings().general.autoConnect) return;
    const result = await prepared.connect();
    if (result.status === 'connected') applyConnectionMigration(result.replaced);
    if (result.status === 'failed') {
      useToastStore
        .getState()
        .addToast('自動接続できませんでした。接続設定を確認してください。', 'error');
    }
  } catch {
    useToastStore.getState().addToast('起動設定または自動接続の読み込みに失敗しました。', 'error');
  }
}
