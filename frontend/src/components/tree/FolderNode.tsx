import { memo, type ReactNode } from 'react';
import styles from './ObjectTree.module.css';

interface FolderNodeProps {
  folderPath: string;
  expanded: boolean;
  profileCount: number;
  onToggle: (folderPath: string) => void;
  children: ReactNode;
}

function FolderNodeComponent({
  folderPath,
  expanded,
  profileCount,
  onToggle,
  children,
}: FolderNodeProps) {
  const toggle = () => onToggle(folderPath);

  return (
    <div data-testid="folder-node" data-folder-path={folderPath}>
      <button
        type="button"
        className={styles.folderHeader}
        onClick={toggle}
        aria-expanded={expanded}
        title={folderPath}
      >
        <span className={`${styles.folderChevron} ${expanded ? styles.folderChevronExpanded : ''}`}>
          ▶
        </span>
        <span className={styles.folderIcon}>📁</span>
        <span className={styles.folderName}>{folderPath}</span>
        <span className={styles.folderCount}>({profileCount})</span>
      </button>
      {expanded && <div className={styles.folderBody}>{children}</div>}
    </div>
  );
}

export const FolderNode = memo(FolderNodeComponent);
