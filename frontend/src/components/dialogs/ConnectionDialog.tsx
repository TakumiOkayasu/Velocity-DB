import { useCallback, useEffect, useRef, useState } from 'react';
import { bridge } from '../../api/bridge';
import styles from './ConnectionDialog.module.css';

interface ConnectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (config: ConnectionConfig) => void;
}

export interface ConnectionConfig {
  name: string;
  server: string;
  port: number;
  database: string;
  username: string;
  password: string;
  useWindowsAuth: boolean;
  isProduction: boolean;
  isReadOnly: boolean;
}

interface SavedProfile {
  id: string;
  name: string;
  server: string;
  port: number;
  database: string;
  username: string;
  useWindowsAuth: boolean;
  savePassword: boolean;
  isProduction: boolean;
  isReadOnly: boolean;
}

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
};

export function ConnectionDialog({ isOpen, onClose, onConnect }: ConnectionDialogProps) {
  const [profiles, setProfiles] = useState<SavedProfile[]>([]);
  // Use explicit mode tracking instead of relying on selectedProfileId being null
  const [mode, setMode] = useState<'new' | 'edit'>('new');
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [savePassword, setSavePassword] = useState(false);
  const [config, setConfig] = useState<ConnectionConfig>({ ...DEFAULT_CONFIG });

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [, setIsLoading] = useState(false);

  // Use a ref to track which profile we're loading to prevent race conditions
  const loadingProfileIdRef = useRef<string | null>(null);
  // Counter to invalidate stale async operations
  const operationCounterRef = useRef(0);

  const loadProfile = useCallback(async (profile: SavedProfile, operationId: number) => {
    // Mark which profile we're loading
    loadingProfileIdRef.current = profile.id;

    let password = '';
    // Load password from backend if saved
    if (profile.savePassword) {
      try {
        const result = await bridge.getProfilePassword(profile.id);
        // Check if this operation is still valid
        if (operationCounterRef.current !== operationId) {
          return; // Abort - operation was invalidated
        }
        if (result.password) {
          password = result.password;
        }
      } catch (e) {
        console.error('Failed to load password:', e);
      }
    }

    // Double-check this operation is still valid
    if (operationCounterRef.current !== operationId) {
      return; // Abort - operation was invalidated
    }

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
    });
    setSavePassword(profile.savePassword);
    setTestResult(null);
    setMode('edit');
    setEditingProfileId(profile.id);
  }, []);

  const handleNewProfile = useCallback(() => {
    // Invalidate any in-flight operations
    operationCounterRef.current += 1;
    loadingProfileIdRef.current = null;

    // Explicitly set to new mode
    setMode('new');
    setEditingProfileId(null);
    setConfig({ ...DEFAULT_CONFIG });
    setSavePassword(false);
    setTestResult(null);
  }, []);

  // Refs to capture current state for async operations
  const modeRef = useRef(mode);
  const editingProfileIdRef = useRef(editingProfileId);
  modeRef.current = mode;
  editingProfileIdRef.current = editingProfileId;

  // Load profiles from backend on mount (only when dialog opens)
  useEffect(() => {
    if (isOpen) {
      setIsLoading(true);
      const currentOperationId = operationCounterRef.current;

      bridge
        .getConnectionProfiles()
        .then((result) => {
          // Check if operation is still valid
          if (operationCounterRef.current !== currentOperationId) {
            return;
          }

          const loaded: SavedProfile[] = result.profiles.map((p) => ({
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
          }));
          setProfiles(loaded);

          // Select first profile if available and we're in new mode with no editing profile
          // Use refs to get current state without adding dependencies
          if (
            loaded.length > 0 &&
            modeRef.current === 'new' &&
            editingProfileIdRef.current === null
          ) {
            const newOperationId = ++operationCounterRef.current;
            // Inline the profile loading to avoid dependency on loadProfile
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
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [isOpen]);

  const handleProfileSelect = (profileId: string) => {
    const profile = profiles.find((p) => p.id === profileId);
    if (profile) {
      const operationId = ++operationCounterRef.current;
      loadProfile(profile, operationId);
    }
  };

  const handleSaveProfile = useCallback(async () => {
    // Capture the current mode at the time of save
    const isNewProfile = mode === 'new';
    const currentEditingId = editingProfileId;

    try {
      // For new profiles, send empty ID; for edits, send the editing profile's ID
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
      });

      const savedProfile: SavedProfile = {
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
      };

      let updatedProfiles: SavedProfile[];
      if (isNewProfile) {
        // Add new profile to the list
        updatedProfiles = [...profiles, savedProfile];
      } else {
        // Update existing profile
        updatedProfiles = profiles.map((p) => (p.id === currentEditingId ? savedProfile : p));
      }

      setProfiles(updatedProfiles);
      // Switch to edit mode for the saved profile
      setMode('edit');
      setEditingProfileId(result.id);
      setTestResult({ success: true, message: 'Profile saved' });
    } catch (e) {
      console.error('Failed to save profile:', e);
      setTestResult({ success: false, message: 'Failed to save profile' });
    }
  }, [config, profiles, mode, editingProfileId, savePassword]);

  const handleDeleteProfile = useCallback(async () => {
    if (mode !== 'edit' || !editingProfileId) return;

    const confirmed = window.confirm(`Delete profile "${config.name}"?`);
    if (!confirmed) return;

    try {
      await bridge.deleteConnectionProfile(editingProfileId);

      const updatedProfiles = profiles.filter((p) => p.id !== editingProfileId);
      setProfiles(updatedProfiles);

      // Select another profile or switch to new mode
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

  if (!isOpen) return null;

  const handleChange = (field: keyof ConnectionConfig, value: string | number | boolean) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      const response = await bridge.testConnection({
        server: config.server,
        port: config.port,
        database: config.database,
        username: config.username,
        password: config.password,
        useWindowsAuth: config.useWindowsAuth,
      });

      if (response.success) {
        setTestResult({
          success: true,
          message: response.message || 'Connection successful!',
        });
      } else {
        setTestResult({
          success: false,
          message: response.message || 'Connection failed',
        });
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setTesting(false);
    }
  };

  const handleConnect = () => {
    onConnect(config);
    onClose();
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.dialog}>
        <div className={styles.header}>
          <h2>Database Connection</h2>
          <button className={styles.closeButton} onClick={onClose}>
            {'\u00D7'}
          </button>
        </div>

        <div className={styles.body}>
          {/* Left: Saved Profiles */}
          <div className={styles.profileList}>
            <div className={styles.profileListHeader}>
              <span>Saved Connections</span>
              <button
                className={styles.profileAddButton}
                onClick={handleNewProfile}
                title="New Connection"
              >
                +
              </button>
            </div>
            <div className={styles.profileItems}>
              {profiles.map((profile) => (
                <div
                  key={profile.id}
                  className={`${styles.profileItem} ${mode === 'edit' && editingProfileId === profile.id ? styles.selected : ''}`}
                  onClick={() => handleProfileSelect(profile.id)}
                >
                  <span className={styles.profileIcon}>🗄️</span>
                  <div className={styles.profileInfo}>
                    <span className={styles.profileName}>{profile.name}</span>
                    <span className={styles.profileServer}>
                      {profile.server}/{profile.database}
                    </span>
                  </div>
                </div>
              ))}
              {profiles.length === 0 && (
                <div className={styles.noProfiles}>No saved connections</div>
              )}
            </div>
          </div>

          {/* Right: Connection Form */}
          <div className={styles.content}>
            {/* Show indicator for new vs edit mode */}
            <div className={styles.formModeIndicator}>
              {mode === 'new' ? 'New Connection' : 'Edit Connection'}
            </div>
            <div className={styles.formGroup}>
              <label>Connection Name</label>
              <input
                type="text"
                value={config.name}
                onChange={(e) => handleChange('name', e.target.value)}
              />
            </div>

            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label>Server</label>
                <input
                  type="text"
                  value={config.server}
                  onChange={(e) => handleChange('server', e.target.value)}
                  placeholder="localhost or hostname"
                />
              </div>

              <div className={styles.formGroupSmall}>
                <label>Port</label>
                <input
                  type="number"
                  value={config.port}
                  onChange={(e) =>
                    handleChange('port', Number.parseInt(e.target.value, 10) || 1433)
                  }
                />
              </div>
            </div>

            <div className={styles.formGroup}>
              <label>Database</label>
              <input
                type="text"
                value={config.database}
                onChange={(e) => handleChange('database', e.target.value)}
                placeholder="master"
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={config.useWindowsAuth}
                  onChange={(e) => handleChange('useWindowsAuth', e.target.checked)}
                />
                Use Windows Authentication
              </label>
            </div>

            {!config.useWindowsAuth && (
              <>
                <div className={styles.formGroup}>
                  <label>Username</label>
                  <input
                    type="text"
                    value={config.username}
                    onChange={(e) => handleChange('username', e.target.value)}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label>Password</label>
                  <input
                    type="password"
                    value={config.password}
                    onChange={(e) => handleChange('password', e.target.value)}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={savePassword}
                      onChange={(e) => setSavePassword(e.target.checked)}
                    />
                    Save password (encrypted)
                  </label>
                </div>
              </>
            )}

            {/* Production Environment Settings */}
            <div className={styles.productionSection}>
              <div className={styles.sectionHeader}>Environment Settings</div>
              <div className={styles.formGroup}>
                <label className={`${styles.checkboxLabel} ${styles.productionCheckbox}`}>
                  <input
                    type="checkbox"
                    checked={config.isProduction}
                    onChange={(e) => handleChange('isProduction', e.target.checked)}
                  />
                  Production Environment
                </label>
                <span className={styles.hint}>Enables safety warnings and visual indicators</span>
              </div>
              {config.isProduction && (
                <div className={styles.formGroup}>
                  <label className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={config.isReadOnly}
                      onChange={(e) => handleChange('isReadOnly', e.target.checked)}
                    />
                    Read-Only Mode
                  </label>
                  <span className={styles.hint}>
                    Prevents data modifications (INSERT, UPDATE, DELETE)
                  </span>
                </div>
              )}
            </div>

            {testResult && (
              <div
                className={`${styles.testResult} ${testResult.success ? styles.success : styles.error}`}
              >
                {testResult.message}
              </div>
            )}
          </div>
        </div>

        <div className={styles.footer}>
          <button
            className={styles.saveButton}
            onClick={handleSaveProfile}
            title={mode === 'new' ? 'Save as new profile' : 'Update profile'}
          >
            {mode === 'new' ? 'Save New' : 'Save'}
          </button>
          {mode === 'edit' && editingProfileId && (
            <button
              className={styles.deleteButton}
              onClick={handleDeleteProfile}
              title="Delete connection profile"
            >
              Delete
            </button>
          )}
          <button className={styles.testButton} onClick={handleTestConnection} disabled={testing}>
            {testing ? 'Testing...' : 'Test'}
          </button>
          <div className={styles.spacer} />
          <button className={styles.cancelButton} onClick={onClose}>
            Cancel
          </button>
          <button className={styles.connectButton} onClick={handleConnect}>
            Connect
          </button>
        </div>
      </div>
    </div>
  );
}
