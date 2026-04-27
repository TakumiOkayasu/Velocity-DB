import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
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
import { groupProfilesByFolder, type ProfileGroup } from '../../utils/groupProfilesByFolder';
import { pruneCollapsedFolders } from '../../utils/pruneCollapsedFolders';
import type { ExpandableType } from '../../utils/treeNode';
import { FolderNode } from './FolderNode';
import styles from './ObjectTree.module.css';
import { ProfileNode } from './ProfileNode';

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
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());

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

  // Lookup map: profile.id → active Connection. Profile-derived connections carry profileId
  // (set in handleConfirm below); ad-hoc connections lack it and are not shown on profile rows.
  // Required to avoid same-name collision across folders (#414).
  const connectionByProfileId = useMemo(() => {
    const map = new Map<string, (typeof connections)[number]>();
    for (const c of connections) {
      if (c.isActive && c.profileId) map.set(c.profileId, c);
    }
    return map;
  }, [connections]);

  const profileGroups = useMemo(() => groupProfilesByFolder(profiles), [profiles]);

  // Drop collapsed state for folders that no longer exist, so a recreated
  // folder of the same name doesn't inherit a stale "closed" flag.
  useEffect(() => {
    const existing = new Set(profileGroups.map((g) => g.folderPath));
    setCollapsedFolders((prev) => pruneCollapsedFolders(prev, existing) ?? prev);
  }, [profileGroups]);

  const toggleFolder = useCallback((folderPath: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  }, []);

  const handleProfileClick = useCallback((profile: SavedConnectionProfile) => {
    setConfirmingProfile(profile);
  }, []);

  const renderGroup = useCallback(
    (group: ProfileGroup) => {
      const profileNodes = group.profiles.map((profile) => (
        <ProfileNode
          key={profile.id}
          profile={profile}
          connection={connectionByProfileId.get(profile.id)}
          filter={filter}
          onTableOpen={onTableOpen}
          onProfileClick={handleProfileClick}
        />
      ));

      if (group.folderPath === '') {
        return <Fragment key="root">{profileNodes}</Fragment>;
      }

      return (
        <FolderNode
          key={group.folderPath}
          folderPath={group.folderPath}
          expanded={!collapsedFolders.has(group.folderPath)}
          profileCount={group.profiles.length}
          onToggle={toggleFolder}
        >
          {profileNodes}
        </FolderNode>
      );
    },
    [connectionByProfileId, filter, onTableOpen, handleProfileClick, collapsedFolders, toggleFolder]
  );

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
        profileId: confirmingProfile.id,
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
      {profileGroups.map(renderGroup)}

      {profiles.length === 0 && <div className={styles.noConnection}>接続なし</div>}

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
