import { type KeyboardEvent, memo, type ReactNode } from 'react';
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
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggle();
    }
  };

  return (
    <div data-testid="folder-node" data-folder-path={folderPath}>
      <div
        className={styles.folderHeader}
        onClick={toggle}
        onKeyDown={onKeyDown}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        title={folderPath}
      >
        <span className={`${styles.folderChevron} ${expanded ? styles.folderChevronExpanded : ''}`}>
          ▶
        </span>
        <span className={styles.folderIcon}>📁</span>
        <span className={styles.folderName}>{folderPath}</span>
        <span className={styles.folderCount}>({profileCount})</span>
      </div>
      {expanded && <div className={styles.folderBody}>{children}</div>}
    </div>
  );
}

export const FolderNode = memo(FolderNodeComponent);
