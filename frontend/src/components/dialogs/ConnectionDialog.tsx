import { useCallback, useEffect, useState } from 'react';
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
}

interface SavedProfile {
  id: string;
  name: string;
  server: string;
  port: number;
  database: string;
  username: string;
  useWindowsAuth: boolean;
}

const STORAGE_KEY = 'pre-dategrip-connection-profiles';

function loadProfiles(): SavedProfile[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load connection profiles:', e);
  }
  return [];
}

function saveProfiles(profiles: SavedProfile[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  } catch (e) {
    console.error('Failed to save connection profiles:', e);
  }
}

export function ConnectionDialog({ isOpen, onClose, onConnect }: ConnectionDialogProps) {
  const [profiles, setProfiles] = useState<SavedProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [config, setConfig] = useState<ConnectionConfig>({
    name: 'New Connection',
    server: 'localhost',
    port: 1433,
    database: 'master',
    username: '',
    password: '',
    useWindowsAuth: true,
  });

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const loadProfile = useCallback((profile: SavedProfile) => {
    setConfig({
      name: profile.name,
      server: profile.server,
      port: profile.port,
      database: profile.database,
      username: profile.username,
      password: '', // Password is not saved
      useWindowsAuth: profile.useWindowsAuth,
    });
    setTestResult(null);
  }, []);

  const handleNewProfile = useCallback(() => {
    setSelectedProfileId(null);
    setConfig({
      name: 'New Connection',
      server: 'localhost',
      port: 1433,
      database: 'master',
      username: '',
      password: '',
      useWindowsAuth: true,
    });
    setTestResult(null);
  }, []);

  // Load profiles on mount
  useEffect(() => {
    if (isOpen) {
      const loaded = loadProfiles();
      setProfiles(loaded);
      // Select first profile if available
      if (loaded.length > 0 && !selectedProfileId) {
        setSelectedProfileId(loaded[0].id);
        loadProfile(loaded[0]);
      }
    }
  }, [isOpen, loadProfile, selectedProfileId]);

  const handleProfileSelect = (profileId: string) => {
    setSelectedProfileId(profileId);
    const profile = profiles.find((p) => p.id === profileId);
    if (profile) {
      loadProfile(profile);
    }
  };

  const handleSaveProfile = useCallback(() => {
    const newProfile: SavedProfile = {
      id: selectedProfileId || `profile-${Date.now()}`,
      name: config.name,
      server: config.server,
      port: config.port,
      database: config.database,
      username: config.username,
      useWindowsAuth: config.useWindowsAuth,
    };

    let updatedProfiles: SavedProfile[];
    if (selectedProfileId) {
      // Update existing
      updatedProfiles = profiles.map((p) => (p.id === selectedProfileId ? newProfile : p));
    } else {
      // Add new
      updatedProfiles = [...profiles, newProfile];
      setSelectedProfileId(newProfile.id);
    }

    setProfiles(updatedProfiles);
    saveProfiles(updatedProfiles);
  }, [config, profiles, selectedProfileId]);

  const handleDeleteProfile = useCallback(() => {
    if (!selectedProfileId) return;

    const confirmed = window.confirm(`Delete profile "${config.name}"?`);
    if (!confirmed) return;

    const updatedProfiles = profiles.filter((p) => p.id !== selectedProfileId);
    setProfiles(updatedProfiles);
    saveProfiles(updatedProfiles);

    // Select another profile or clear
    if (updatedProfiles.length > 0) {
      setSelectedProfileId(updatedProfiles[0].id);
      loadProfile(updatedProfiles[0]);
    } else {
      handleNewProfile();
    }
  }, [selectedProfileId, profiles, config.name, handleNewProfile, loadProfile]);

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
                  className={`${styles.profileItem} ${selectedProfileId === profile.id ? styles.selected : ''}`}
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
              </>
            )}

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
            title="Save connection profile"
          >
            Save
          </button>
          {selectedProfileId && (
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
