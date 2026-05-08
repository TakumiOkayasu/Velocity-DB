import { memo } from 'react';
import type { Connection, SavedConnectionProfile } from '../../types';
import type { ExpandableType } from '../../utils/treeNode';
import { ConnectionTreeSection } from './ConnectionTreeSection';
import styles from './ObjectTree.module.css';

interface ProfileNodeProps {
  profile: SavedConnectionProfile;
  connection: Connection | undefined;
  filter: string;
  onTableOpen?: (tableName: string, tableType: ExpandableType, connectionId?: string) => void;
  onProfileClick: (profile: SavedConnectionProfile) => void;
}

function ProfileNodeComponent({
  profile,
  connection,
  filter,
  onTableOpen,
  onProfileClick,
}: ProfileNodeProps) {
  const identityProps = {
    'data-testid': 'profile-node',
    'data-profile-name': profile.name,
    'data-profile-id': profile.id,
  };

  if (connection) {
    return (
      <div {...identityProps}>
        <ConnectionTreeSection connection={connection} filter={filter} onTableOpen={onTableOpen} />
      </div>
    );
  }

  return (
    <button
      type="button"
      {...identityProps}
      className={`${styles.profileItem} ${profile.isProduction ? styles.production : ''}`}
      onClick={() => onProfileClick(profile)}
      title={`Click to connect to ${profile.name}`}
    >
      <span className={styles.profileIcon}>🗄</span>
      <span className={styles.profileName}>{profile.name}</span>
      <span className={styles.profileStatus}>未接続</span>
    </button>
  );
}

export const ProfileNode = memo(ProfileNodeComponent);
