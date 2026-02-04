import { useCallback, useEffect, useRef, useState } from 'react';
import { bridge } from '../../../api/bridge';
import type { SavedConnectionProfile, SshAuthType } from '../../../types';
import type { ConnectionConfig, SshConfig } from '../ConnectionDialog';

export type ProfileMode = 'new' | 'edit';

const DEFAULT_SSH_CONFIG: SshConfig = {
  enabled: false,
  host: '',
  port: 22,
  username: '',
  authType: 'password',
  password: '',
  privateKeyPath: '',
  keyPassphrase: '',
};

const DEFAULT_CONFIG: ConnectionConfig = {
  name: 'New Connection',
  server: 'localhost',
  port: 1433,
  database: 'master',
  username: '',
  password: '',
  useWindowsAuth: true,
  isProduction: false,
  isReadOnly: false,
  ssh: { ...DEFAULT_SSH_CONFIG },
};

interface UseConnectionProfileResult {
  profiles: SavedConnectionProfile[];
  mode: ProfileMode;
  editingProfileId: string | null;
  config: ConnectionConfig;
  savePassword: boolean;
  testResult: { success: boolean; message: string } | null;
  setConfig: React.Dispatch<React.SetStateAction<ConnectionConfig>>;
  setSavePassword: React.Dispatch<React.SetStateAction<boolean>>;
  setTestResult: React.Dispatch<React.SetStateAction<{ success: boolean; message: string } | null>>;
  handleProfileSelect: (profileId: string) => void;
  handleNewProfile: () => void;
  handleSaveProfile: () => Promise<void>;
  handleDeleteProfile: () => Promise<void>;
  handleCopyProfile: () => void;
}

export function useConnectionProfile(isOpen: boolean): UseConnectionProfileResult {
  const [profiles, setProfiles] = useState<SavedConnectionProfile[]>([]);
  const [mode, setMode] = useState<ProfileMode>('new');
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [savePassword, setSavePassword] = useState(false);
  const [config, setConfig] = useState<ConnectionConfig>({ ...DEFAULT_CONFIG });
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const loadingProfileIdRef = useRef<string | null>(null);
  const operationCounterRef = useRef(0);
  const modeRef = useRef(mode);
  const editingProfileIdRef = useRef(editingProfileId);
  modeRef.current = mode;
  editingProfileIdRef.current = editingProfileId;

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

    setConfig({
      name: profile.name,
      server: profile.server,
      port: profile.port,
      database: profile.database,
      username: profile.username,
      password,
      useWindowsAuth: profile.useWindowsAuth,
      isProduction: profile.isProduction,
      isReadOnly: profile.isReadOnly,
      ssh: profile.ssh
        ? {
            enabled: profile.ssh.enabled,
            host: profile.ssh.host,
            port: profile.ssh.port,
            username: profile.ssh.username,
            authType: profile.ssh.authType,
            password: '',
            privateKeyPath: profile.ssh.privateKeyPath,
            keyPassphrase: '',
          }
        : { ...DEFAULT_SSH_CONFIG },
    });
    setSavePassword(profile.savePassword);
    setTestResult(null);
    setMode('edit');
    setEditingProfileId(profile.id);
  }, []);

  const handleNewProfile = useCallback(() => {
    operationCounterRef.current += 1;
    loadingProfileIdRef.current = null;
    setMode('new');
    setEditingProfileId(null);
    setConfig({ ...DEFAULT_CONFIG });
    setSavePassword(false);
    setTestResult(null);
  }, []);

  // Load profiles from backend when dialog opens
  useEffect(() => {
    if (!isOpen) return;

    const currentOperationId = operationCounterRef.current;

    bridge
      .getConnectionProfiles()
      .then((result) => {
        if (operationCounterRef.current !== currentOperationId) return;

        const loaded: SavedConnectionProfile[] = result.profiles.map((p) => ({
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
          ssh: p.ssh
            ? {
                enabled: p.ssh.enabled ?? false,
                host: p.ssh.host ?? '',
                port: p.ssh.port ?? 22,
                username: p.ssh.username ?? '',
                authType: (p.ssh.authType as SshAuthType) ?? 'password',
                privateKeyPath: p.ssh.privateKeyPath ?? '',
                savePassword: p.ssh.savePassword ?? false,
              }
            : undefined,
        }));
        setProfiles(loaded);

        // Auto-select first profile if in new mode
        if (
          loaded.length > 0 &&
          modeRef.current === 'new' &&
          editingProfileIdRef.current === null
        ) {
          const newOperationId = ++operationCounterRef.current;
          const profile = loaded[0];
          loadingProfileIdRef.current = profile.id;

          const loadPasswordAndSetConfig = async () => {
            let password = '';
            if (profile.savePassword) {
              try {
                const passwordResult = await bridge.getProfilePassword(profile.id);
                if (operationCounterRef.current !== newOperationId) return;
                if (passwordResult.password) {
                  password = passwordResult.password;
                }
              } catch (e) {
                console.error('Failed to load password:', e);
              }
            }
            if (operationCounterRef.current !== newOperationId) return;

            setConfig({
              name: profile.name,
              server: profile.server,
              port: profile.port,
              database: profile.database,
              username: profile.username,
              password,
              useWindowsAuth: profile.useWindowsAuth,
              isProduction: profile.isProduction,
              isReadOnly: profile.isReadOnly,
              ssh: profile.ssh
                ? {
                    enabled: profile.ssh.enabled,
                    host: profile.ssh.host,
                    port: profile.ssh.port,
                    username: profile.ssh.username,
                    authType: profile.ssh.authType,
                    password: '',
                    privateKeyPath: profile.ssh.privateKeyPath,
                    keyPassphrase: '',
                  }
                : { ...DEFAULT_SSH_CONFIG },
            });
            setSavePassword(profile.savePassword);
            setTestResult(null);
            setMode('edit');
            setEditingProfileId(profile.id);
          };
          loadPasswordAndSetConfig();
        }
      })
      .catch((e) => {
        console.error('Failed to load profiles:', e);
      });
  }, [isOpen]);

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

      if (isNewProfile) {
        setProfiles((prev) => [...prev, savedProfile]);
      } else {
        setProfiles((prev) => prev.map((p) => (p.id === currentEditingId ? savedProfile : p)));
      }

      setMode('edit');
      setEditingProfileId(result.id);
      setTestResult({ success: true, message: 'Profile saved' });
    } catch (e) {
      console.error('Failed to save profile:', e);
      setTestResult({ success: false, message: 'Failed to save profile' });
    }
  }, [config, mode, editingProfileId, savePassword]);

  const handleDeleteProfile = useCallback(async () => {
    if (mode !== 'edit' || !editingProfileId) return;

    const confirmed = window.confirm(`Delete profile "${config.name}"?`);
    if (!confirmed) return;

    try {
      await bridge.deleteConnectionProfile(editingProfileId);

      const updatedProfiles = profiles.filter((p) => p.id !== editingProfileId);
      setProfiles(updatedProfiles);

      if (updatedProfiles.length > 0) {
        const operationId = ++operationCounterRef.current;
        loadProfile(updatedProfiles[0], operationId);
      } else {
        handleNewProfile();
      }
    } catch (e) {
      console.error('Failed to delete profile:', e);
      setTestResult({ success: false, message: 'Failed to delete profile' });
    }
  }, [editingProfileId, mode, profiles, config.name, handleNewProfile, loadProfile]);

  const handleCopyProfile = useCallback(() => {
    if (mode !== 'edit' || !editingProfileId) return;

    operationCounterRef.current += 1;
    loadingProfileIdRef.current = null;
    setMode('new');
    setEditingProfileId(null);
    setConfig((prev) => ({ ...prev, name: `${prev.name} (Copy)` }));
    setTestResult(null);
  }, [mode, editingProfileId]);

  return {
    profiles,
    mode,
    editingProfileId,
    config,
    savePassword,
    testResult,
    setConfig,
    setSavePassword,
    setTestResult,
    handleProfileSelect,
    handleNewProfile,
    handleSaveProfile,
    handleDeleteProfile,
    handleCopyProfile,
  };
}
