import { useCallback, useEffect, useRef, useState } from 'react';
import { bridge } from '../../api/bridge';
import styles from './ConnectionDialog.module.css';

interface ConnectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (config: ConnectionConfig) => void;
}

export type SshAuthType = 'password' | 'privateKey';

export interface SshConfig {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  authType: SshAuthType;
  password: string;
  privateKeyPath: string;
  keyPassphrase: string;
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
  ssh: SshConfig;
}

interface SavedSshConfig {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  authType: SshAuthType;
  privateKeyPath: string;
  savePassword: boolean;
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
  ssh?: SavedSshConfig;
}

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
      ssh: profile.ssh
        ? {
            enabled: profile.ssh.enabled,
            host: profile.ssh.host,
            port: profile.ssh.port,
            username: profile.ssh.username,
            authType: profile.ssh.authType,
            password: '', // Will be loaded separately if needed
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

  const handleSshChange = (field: keyof SshConfig, value: string | number | boolean) => {
    setConfig((prev) => ({
      ...prev,
      ssh: { ...prev.ssh, [field]: value },
    }));
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
        ssh: config.ssh.enabled
          ? {
              enabled: true,
              host: config.ssh.host,
              port: config.ssh.port,
              username: config.ssh.username,
              authType: config.ssh.authType,
              password: config.ssh.password,
              privateKeyPath: config.ssh.privateKeyPath,
              keyPassphrase: config.ssh.keyPassphrase,
            }
          : undefined,
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

            {/* SSH Tunnel Settings */}
            <div className={styles.productionSection}>
              <div className={styles.sectionHeader}>SSH Tunnel</div>
              <div className={styles.formGroup}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={config.ssh.enabled}
                    onChange={(e) => handleSshChange('enabled', e.target.checked)}
                  />
                  Use SSH Tunnel
                </label>
                <span className={styles.hint}>Connect via SSH port forwarding</span>
              </div>
              {config.ssh.enabled && (
                <>
                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label>SSH Host</label>
                      <input
                        type="text"
                        value={config.ssh.host}
                        onChange={(e) => handleSshChange('host', e.target.value)}
                        placeholder="ssh.example.com"
                      />
                    </div>
                    <div className={styles.formGroupSmall}>
                      <label>SSH Port</label>
                      <input
                        type="number"
                        value={config.ssh.port}
                        onChange={(e) =>
                          handleSshChange('port', Number.parseInt(e.target.value, 10) || 22)
                        }
                      />
                    </div>
                  </div>
                  <div className={styles.formGroup}>
                    <label>SSH Username</label>
                    <input
                      type="text"
                      value={config.ssh.username}
                      onChange={(e) => handleSshChange('username', e.target.value)}
                    />
                  </div>
                  <div className={styles.formGroup}>
                    <label>Authentication</label>
                    <select
                      value={config.ssh.authType}
                      onChange={(e) => handleSshChange('authType', e.target.value as SshAuthType)}
                      className={styles.selectInput}
                    >
                      <option value="password">Password</option>
                      <option value="privateKey">Private Key</option>
                    </select>
                  </div>
                  {config.ssh.authType === 'password' && (
                    <div className={styles.formGroup}>
                      <label>SSH Password</label>
                      <input
                        type="password"
                        value={config.ssh.password}
                        onChange={(e) => handleSshChange('password', e.target.value)}
                      />
                    </div>
                  )}
                  {config.ssh.authType === 'privateKey' && (
                    <>
                      <div className={styles.formGroup}>
                        <label>Private Key Path</label>
                        <div className={styles.inputWithButton}>
                          <input
                            type="text"
                            value={config.ssh.privateKeyPath}
                            onChange={(e) => handleSshChange('privateKeyPath', e.target.value)}
                            placeholder="C:\Users\...\.ssh\id_rsa"
                          />
                          <button
                            type="button"
                            className={styles.browseButton}
                            onClick={async () => {
                              try {
                                const result = await bridge.browseFile(
                                  'Private Key Files (*.pem;*.ppk;id_*)|*.pem;*.ppk;id_*|All Files (*.*)|*.*'
                                );
                                if (result.filePath) {
                                  handleSshChange('privateKeyPath', result.filePath);
                                }
                              } catch {
                                // User cancelled dialog
                              }
                            }}
                          >
                            ...
                          </button>
                        </div>
                      </div>
                      <div className={styles.formGroup}>
                        <label>Key Passphrase (optional)</label>
                        <input
                          type="password"
                          value={config.ssh.keyPassphrase}
                          onChange={(e) => handleSshChange('keyPassphrase', e.target.value)}
                        />
                      </div>
                    </>
                  )}
                </>
              )}
            </div>

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
