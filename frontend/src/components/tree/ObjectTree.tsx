import { useCallback, useEffect, useState } from 'react';
import { bridge } from '../../api/bridge';
import { useConnectionActions, useConnectionStore } from '../../store/connectionStore';
import { ConnectionTreeSection } from './ConnectionTreeSection';
import styles from './ObjectTree.module.css';

interface SavedProfile {
  id: string;
  name: string;
  server: string;
  port?: number;
  database: string;
  username: string;
  useWindowsAuth: boolean;
  savePassword?: boolean;
  isProduction?: boolean;
  isReadOnly?: boolean;
  dbType?: 'sqlserver' | 'postgresql' | 'mysql';
  ssh?: {
    enabled: boolean;
    host: string;
    port: number;
    username: string;
    authType: 'password' | 'privateKey';
    privateKeyPath: string;
    savePassword: boolean;
  };
}

interface ObjectTreeProps {
  filter: string;
  onTableOpen?: (tableName: string, tableType: 'table' | 'view', connectionId?: string) => void;
}

export function ObjectTree({ filter, onTableOpen }: ObjectTreeProps) {
  const { connections } = useConnectionStore();
  const { addConnection } = useConnectionActions();
  const [profiles, setProfiles] = useState<SavedProfile[]>([]);
  const [confirmingProfile, setConfirmingProfile] = useState<SavedProfile | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  // Fetch profiles on mount
  useEffect(() => {
    const fetchProfiles = async () => {
      try {
        const result = await bridge.getConnectionProfiles();
        setProfiles(result.profiles);
      } catch (error) {
        console.error('Failed to fetch profiles:', error);
      }
    };
    fetchProfiles();
  }, []);

  // Get active connections
  const activeConnections = connections.filter((c) => c.isActive);

  // Get disconnected profiles (not currently connected)
  const disconnectedProfiles = profiles.filter(
    (profile) => !connections.some((c) => c.name === profile.name)
  );

  const handleProfileClick = useCallback((profile: SavedProfile) => {
    setConfirmingProfile(profile);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!confirmingProfile) return;

    setIsConnecting(true);
    try {
      let password = '';
      let sshPassword = '';
      let sshKeyPassphrase = '';

      if (!confirmingProfile.useWindowsAuth) {
        const pwResult = await bridge.getProfilePassword(confirmingProfile.id);
        password = pwResult.password || '';
      }

      if (confirmingProfile.ssh?.enabled) {
        if (confirmingProfile.ssh.authType === 'password') {
          const sshPwResult = await bridge.getSshPassword(confirmingProfile.id);
          sshPassword = sshPwResult.password || '';
        } else {
          const passphraseResult = await bridge.getSshKeyPassphrase(confirmingProfile.id);
          sshKeyPassphrase = passphraseResult.passphrase || '';
        }
      }

      await addConnection({
        name: confirmingProfile.name,
        server: confirmingProfile.server,
        port: confirmingProfile.port ?? 1433,
        database: confirmingProfile.database,
        username: confirmingProfile.username,
        password,
        useWindowsAuth: confirmingProfile.useWindowsAuth,
        dbType: confirmingProfile.dbType ?? 'sqlserver',
        isProduction: confirmingProfile.isProduction ?? false,
        isReadOnly: confirmingProfile.isReadOnly ?? false,
        ssh: confirmingProfile.ssh?.enabled
          ? {
              enabled: true,
              host: confirmingProfile.ssh.host,
              port: confirmingProfile.ssh.port,
              username: confirmingProfile.ssh.username,
              authType: confirmingProfile.ssh.authType,
              password: sshPassword,
              privateKeyPath: confirmingProfile.ssh.privateKeyPath,
              keyPassphrase: sshKeyPassphrase,
            }
          : undefined,
      });
      setConfirmingProfile(null);
    } catch (error) {
      console.error('Failed to connect:', error);
    } finally {
      setIsConnecting(false);
    }
  }, [confirmingProfile, addConnection]);

  const handleCancel = useCallback(() => {
    setConfirmingProfile(null);
  }, []);

  return (
    <div className={styles.container}>
      {/* Connected databases */}
      {activeConnections.map((connection) => (
        <ConnectionTreeSection
          key={connection.id}
          connection={connection}
          filter={filter}
          onTableOpen={onTableOpen}
        />
      ))}

      {/* Disconnected profiles */}
      {disconnectedProfiles.map((profile) => (
        <div
          key={profile.id}
          className={`${styles.profileItem} ${profile.isProduction ? styles.production : ''}`}
          onClick={() => handleProfileClick(profile)}
          title={`Click to connect to ${profile.name}`}
        >
          <span className={styles.profileIcon}>🗄</span>
          <span className={styles.profileName}>{profile.name}</span>
          <span className={styles.profileStatus}>未接続</span>
        </div>
      ))}

      {/* No connections message */}
      {activeConnections.length === 0 && disconnectedProfiles.length === 0 && (
        <div className={styles.noConnection}>接続なし</div>
      )}

      {/* Connection confirmation dialog */}
      {confirmingProfile && (
        <div className={styles.overlay} onClick={handleCancel}>
          <div
            className={`${styles.dialog} ${confirmingProfile.isProduction ? styles.productionDialog : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.dialogHeader}>
              {confirmingProfile.isProduction && <span className={styles.warningIcon}>⚠</span>}
              <span>データベースに接続</span>
            </div>
            <div className={styles.dialogBody}>
              {confirmingProfile.isProduction ? (
                <p className={styles.warningText}>
                  <strong>本番</strong>データベースに接続しようとしています。
                  <br />
                  続行しますか？
                </p>
              ) : (
                <p>
                  <strong>{confirmingProfile.name}</strong>に接続しますか？
                </p>
              )}
              <div className={styles.profileDetails}>
                <div>サーバー: {confirmingProfile.server}</div>
                <div>データベース: {confirmingProfile.database}</div>
              </div>
            </div>
            <div className={styles.dialogActions}>
              <button
                className={styles.cancelButton}
                onClick={handleCancel}
                disabled={isConnecting}
              >
                キャンセル
              </button>
              <button
                className={`${styles.connectButton} ${confirmingProfile.isProduction ? styles.productionButton : ''}`}
                onClick={handleConfirm}
                disabled={isConnecting}
              >
                {isConnecting
                  ? '接続中...'
                  : confirmingProfile.isProduction
                    ? '本番に接続'
                    : '接続'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
