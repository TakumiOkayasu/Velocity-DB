import { useState } from 'react';
import { bridge } from '../../api/bridge';
import type { SshAuthType } from '../../types';
import styles from './ConnectionDialog.module.css';
import { useConnectionProfile } from './hooks/useConnectionProfile';
import { ConnectionFormSection } from './sections/ConnectionFormSection';
import { EnvironmentSection } from './sections/EnvironmentSection';
import { SshTunnelSection } from './sections/SshTunnelSection';

interface ConnectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (config: ConnectionConfig) => void;
}

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

export function ConnectionDialog({ isOpen, onClose, onConnect }: ConnectionDialogProps) {
  const {
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
  } = useConnectionProfile(isOpen);

  const [testing, setTesting] = useState(false);

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
            <div className={styles.formModeIndicator}>
              {mode === 'new' ? 'New Connection' : 'Edit Connection'}
            </div>

            <ConnectionFormSection
              config={config}
              savePassword={savePassword}
              onChange={handleChange}
              onSavePasswordChange={setSavePassword}
            />

            <SshTunnelSection ssh={config.ssh} onChange={handleSshChange} />

            <EnvironmentSection
              isProduction={config.isProduction}
              isReadOnly={config.isReadOnly}
              onChange={handleChange}
            />

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
            <>
              <button
                className={styles.copyButton}
                onClick={handleCopyProfile}
                title="Copy connection profile"
              >
                Copy
              </button>
              <button
                className={styles.deleteButton}
                onClick={handleDeleteProfile}
                title="Delete connection profile"
              >
                Delete
              </button>
            </>
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
