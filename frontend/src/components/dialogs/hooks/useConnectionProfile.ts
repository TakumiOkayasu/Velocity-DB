import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useReducer,
  useRef,
} from 'react';
import { bridge } from '../../../api/bridge';
import { useConnectionStore } from '../../../store/connectionStore';
import {
  isDatabaseType,
  isEnvironmentType,
  isSshAuthType,
  type SavedConnectionProfile,
} from '../../../types';
import type { ConnectionConfig } from '../../../types/connectionForm';
import {
  initialProfileFormState,
  type ProfileMode,
  profileFormReducer,
} from './useConnectionProfile.reducer';

type BridgeProfile = Awaited<ReturnType<typeof bridge.getConnectionProfiles>>['profiles'][number];

function normalizeProfile(p: BridgeProfile): SavedConnectionProfile {
  return {
    id: p.id,
    name: p.name,
    server: p.server,
    port: p.port ?? 1433,
    database: p.database,
    username: p.username,
    useWindowsAuth: p.useWindowsAuth,
    savePassword: p.savePassword ?? false,
    isProduction: p.isProduction ?? false,
    isReadOnly: p.isReadOnly ?? false,
    environment: isEnvironmentType(p.environment ?? '')
      ? p.environment
      : p.isProduction
        ? 'production'
        : 'development',
    dbType: isDatabaseType(p.dbType ?? '') ? p.dbType : 'sqlserver',
    folderPath: p.folderPath ?? '',
    ssh: p.ssh
      ? {
          enabled: p.ssh.enabled ?? false,
          host: p.ssh.host ?? '',
          port: p.ssh.port ?? 22,
          username: p.ssh.username ?? '',
          authType: isSshAuthType(p.ssh.authType ?? '') ? p.ssh.authType : 'password',
          privateKeyPath: p.ssh.privateKeyPath ?? '',
          savePassword: p.ssh.savePassword ?? false,
        }
      : undefined,
  };
}

interface UseConnectionProfileResult {
  profiles: SavedConnectionProfile[];
  mode: ProfileMode;
  editingProfileId: string | null;
  config: ConnectionConfig;
  savePassword: boolean;
  testResult: { success: boolean; message: string } | null;
  deleteConfirmOpen: boolean;
  setConfig: Dispatch<SetStateAction<ConnectionConfig>>;
  setSavePassword: Dispatch<SetStateAction<boolean>>;
  setTestResult: Dispatch<SetStateAction<{ success: boolean; message: string } | null>>;
  handleProfileSelect: (profileId: string) => void;
  handleNewProfile: () => void;
  handleSaveProfile: () => Promise<void>;
  handleDeleteProfile: () => void;
  confirmDeleteProfile: () => Promise<void>;
  cancelDeleteProfile: () => void;
  handleCopyProfile: () => void;
}

export function useConnectionProfile(isOpen: boolean): UseConnectionProfileResult {
  const [state, dispatch] = useReducer(profileFormReducer, initialProfileFormState);
  const { profiles, mode, editingProfileId, savePassword, config, testResult, deleteConfirmOpen } =
    state;

  const loadingProfileIdRef = useRef<string | null>(null);
  const operationCounterRef = useRef(0);
  const modeRef = useRef(mode);
  const editingProfileIdRef = useRef(editingProfileId);
  modeRef.current = mode;
  editingProfileIdRef.current = editingProfileId;

  const setConfig = useCallback<Dispatch<SetStateAction<ConnectionConfig>>>((value) => {
    dispatch({ type: 'SET_CONFIG', payload: value });
  }, []);

  const setSavePassword = useCallback<Dispatch<SetStateAction<boolean>>>((value) => {
    dispatch({ type: 'SET_SAVE_PASSWORD', payload: value });
  }, []);

  const setTestResult = useCallback<
    Dispatch<SetStateAction<{ success: boolean; message: string } | null>>
  >((value) => {
    dispatch({ type: 'SET_TEST_RESULT', payload: value });
  }, []);

  const loadProfile = useCallback(async (profile: SavedConnectionProfile, operationId: number) => {
    loadingProfileIdRef.current = profile.id;

    let password = '';
    if (profile.savePassword) {
      try {
        const result = await bridge.getProfilePassword(profile.id);
        if (operationCounterRef.current !== operationId) return;
        if (result.password) {
          password = result.password;
        }
      } catch (e) {
        console.error('Failed to load password:', e);
      }
    }

    if (operationCounterRef.current !== operationId) return;

    dispatch({ type: 'SELECT_PROFILE', payload: { profile, password } });
  }, []);

  const handleNewProfile = useCallback(() => {
    operationCounterRef.current += 1;
    loadingProfileIdRef.current = null;
    dispatch({ type: 'NEW_PROFILE' });
  }, []);

  // Load profiles from backend when dialog opens
  useEffect(() => {
    if (!isOpen) return;

    const currentOperationId = operationCounterRef.current;

    bridge
      .getConnectionProfiles()
      .then((result) => {
        if (operationCounterRef.current !== currentOperationId) return;

        const loaded = result.profiles.map(normalizeProfile);
        dispatch({ type: 'SET_PROFILES', payload: loaded });

        // Auto-select first profile if in new mode
        if (
          loaded.length > 0 &&
          modeRef.current === 'new' &&
          editingProfileIdRef.current === null
        ) {
          const newOperationId = ++operationCounterRef.current;
          loadProfile(loaded[0], newOperationId);
        }
      })
      .catch((e) => {
        console.error('Failed to load profiles:', e);
      });
  }, [isOpen, loadProfile]);

  const handleProfileSelect = useCallback(
    (profileId: string) => {
      const profile = profiles.find((p) => p.id === profileId);
      if (profile) {
        const operationId = ++operationCounterRef.current;
        loadProfile(profile, operationId);
      }
    },
    [profiles, loadProfile]
  );

  const handleSaveProfile = useCallback(async () => {
    const isNewProfile = mode === 'new';
    const currentEditingId = editingProfileId;
    const folderPath = config.folderPath.trim();

    try {
      const result = await bridge.saveConnectionProfile({
        id: isNewProfile ? '' : (currentEditingId ?? ''),
        name: config.name,
        server: config.server,
        port: config.port,
        database: config.database,
        username: config.username,
        useWindowsAuth: config.useWindowsAuth,
        savePassword,
        password: savePassword ? config.password : undefined,
        isProduction: config.isProduction,
        isReadOnly: config.isReadOnly,
        environment: config.environment,
        dbType: config.dbType,
        folderPath,
        ssh: config.ssh.enabled
          ? {
              enabled: true,
              host: config.ssh.host,
              port: config.ssh.port,
              username: config.ssh.username,
              authType: config.ssh.authType,
              privateKeyPath: config.ssh.privateKeyPath,
              savePassword: config.ssh.password !== '' || config.ssh.keyPassphrase !== '',
              password: config.ssh.authType === 'password' ? config.ssh.password : undefined,
              keyPassphrase:
                config.ssh.authType === 'privateKey' ? config.ssh.keyPassphrase : undefined,
            }
          : undefined,
      });

      const savedProfile: SavedConnectionProfile = {
        id: result.id,
        name: config.name,
        server: config.server,
        port: config.port,
        database: config.database,
        username: config.username,
        useWindowsAuth: config.useWindowsAuth,
        savePassword,
        isProduction: config.isProduction,
        isReadOnly: config.isReadOnly,
        environment: config.environment,
        dbType: config.dbType,
        folderPath,
        ssh: config.ssh.enabled
          ? {
              enabled: true,
              host: config.ssh.host,
              port: config.ssh.port,
              username: config.ssh.username,
              authType: config.ssh.authType,
              privateKeyPath: config.ssh.privateKeyPath,
              savePassword: config.ssh.password !== '' || config.ssh.keyPassphrase !== '',
            }
          : undefined,
      };

      dispatch({
        type: 'PROFILE_SAVED',
        payload: isNewProfile
          ? { profile: savedProfile, isNew: true, message: 'Profile saved' }
          : {
              profile: savedProfile,
              isNew: false,
              previousId: currentEditingId ?? savedProfile.id,
              message: 'Profile saved',
            },
      });
      useConnectionStore.getState().incrementProfileVersion();
    } catch (e) {
      console.error('Failed to save profile:', e);
      dispatch({
        type: 'SET_TEST_RESULT',
        payload: { success: false, message: 'Failed to save profile' },
      });
    }
  }, [config, mode, editingProfileId, savePassword]);

  const handleDeleteProfile = useCallback(() => {
    if (mode !== 'edit' || !editingProfileId) return;
    dispatch({ type: 'OPEN_DELETE_CONFIRM' });
  }, [mode, editingProfileId]);

  const confirmDeleteProfile = useCallback(async () => {
    dispatch({ type: 'CLOSE_DELETE_CONFIRM' });
    if (!editingProfileId) return;

    try {
      await bridge.deleteConnectionProfile(editingProfileId);

      const targetId = editingProfileId;
      const updatedProfiles = profiles.filter((p) => p.id !== targetId);
      dispatch({ type: 'REMOVE_PROFILE', payload: targetId });
      useConnectionStore.getState().incrementProfileVersion();

      if (updatedProfiles.length > 0) {
        const operationId = ++operationCounterRef.current;
        loadProfile(updatedProfiles[0], operationId);
      } else {
        handleNewProfile();
      }
    } catch (e) {
      console.error('Failed to delete profile:', e);
      dispatch({
        type: 'SET_TEST_RESULT',
        payload: { success: false, message: 'Failed to delete profile' },
      });
    }
  }, [editingProfileId, profiles, handleNewProfile, loadProfile]);

  const cancelDeleteProfile = useCallback(() => {
    dispatch({ type: 'CLOSE_DELETE_CONFIRM' });
  }, []);

  const handleCopyProfile = useCallback(() => {
    if (mode !== 'edit' || !editingProfileId) return;

    operationCounterRef.current += 1;
    loadingProfileIdRef.current = null;
    dispatch({ type: 'COPY_PROFILE' });
  }, [mode, editingProfileId]);

  return {
    profiles,
    mode,
    editingProfileId,
    config,
    savePassword,
    testResult,
    deleteConfirmOpen,
    setConfig,
    setSavePassword,
    setTestResult,
    handleProfileSelect,
    handleNewProfile,
    handleSaveProfile,
    handleDeleteProfile,
    confirmDeleteProfile,
    cancelDeleteProfile,
    handleCopyProfile,
  };
}
