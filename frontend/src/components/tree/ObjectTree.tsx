import { useCallback, useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { bridge } from '../../api/bridge';
import { applyConnectionMigration } from '../../store/connectionMigration';
import { useConnectionActions, useConnectionStore } from '../../store/connectionStore';
import {
  isDatabaseType,
  isEnvironmentType,
  isSshAuthType,
  type SavedConnectionProfile,
} from '../../types';
import type { ExpandableType } from '../../utils/treeNode';
import { ConnectionTreeSection } from './ConnectionTreeSection';
import styles from './ObjectTree.module.css';

type RawProfile = Awaited<ReturnType<typeof bridge.getConnectionProfiles>>['profiles'][number];

function normalizeProfile(p: RawProfile): SavedConnectionProfile {
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

interface ObjectTreeProps {
  filter: string;
  onTableOpen?: (tableName: string, tableType: ExpandableType, connectionId?: string) => void;
}

export function ObjectTree({ filter, onTableOpen }: ObjectTreeProps) {
  const { connections, profileVersion } = useConnectionStore(
    useShallow((state) => ({
      connections: state.connections,
      profileVersion: state.profileVersion,
    }))
  );
  const { addConnection, cancelConnection } = useConnectionActions();
  const [profiles, setProfiles] = useState<SavedConnectionProfile[]>([]);
  const [confirmingProfile, setConfirmingProfile] = useState<SavedConnectionProfile | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: profileVersion is an intentional re-fetch trigger
  useEffect(() => {
    const fetchProfiles = async () => {
      try {
        const result = await bridge.getConnectionProfiles();
        setProfiles(result.profiles.map(normalizeProfile));
      } catch (error) {
        console.error('Failed to fetch profiles:', error);
      }
    };
    fetchProfiles();
  }, [profileVersion]);

  // Get active connections
  const activeConnections = connections.filter((c) => c.isActive);

  // Get disconnected profiles (not currently connected)
  const disconnectedProfiles = profiles.filter(
    (profile) => !connections.some((c) => c.name === profile.name)
  );

  const handleProfileClick = useCallback((profile: SavedConnectionProfile) => {
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

      const result = await addConnection({
        name: confirmingProfile.name,
        server: confirmingProfile.server,
        port: confirmingProfile.port,
        database: confirmingProfile.database,
        username: confirmingProfile.username,
        password,
        useWindowsAuth: confirmingProfile.useWindowsAuth,
        dbType: confirmingProfile.dbType ?? 'sqlserver',
        isProduction: confirmingProfile.isProduction,
        isReadOnly: confirmingProfile.isReadOnly,
        environment:
          confirmingProfile.environment ??
          (confirmingProfile.isProduction ? 'production' : 'development'),
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
      applyConnectionMigration(result.replaced);
      setConfirmingProfile(null);
    } catch (error) {
      console.error('Failed to connect:', error);
    } finally {
      setIsConnecting(false);
    }
  }, [confirmingProfile, addConnection]);

  const handleCancel = useCallback(() => {
    if (isConnecting) {
      cancelConnection();
      setIsConnecting(false);
    }
    setConfirmingProfile(null);
  }, [isConnecting, cancelConnection]);

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
              <button className={styles.cancelButton} onClick={handleCancel}>
                {isConnecting ? '接続中止' : 'キャンセル'}
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
