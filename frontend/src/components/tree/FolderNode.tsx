import { memo, type ReactNode } from 'react';
import styles from './ObjectTree.module.css';

/** Horizontal indent per nesting level (px). */
export const FOLDER_INDENT_PX = 16;
/** Base left padding of the folder header (matches .folderHeader padding). */
const HEADER_BASE_PADDING_PX = 10;

interface FolderNodeProps {
  name: string;
  fullPath: string;
  level: number;
  expanded: boolean;
  profileCount: number;
  onToggle: (fullPath: string) => void;
  children: ReactNode;
}

function FolderNodeComponent({
  name,
  fullPath,
  level,
  expanded,
  profileCount,
  onToggle,
  children,
}: FolderNodeProps) {
  const toggle = () => onToggle(fullPath);

  return (
    <div data-testid="folder-node" data-folder-path={fullPath}>
      <button
        type="button"
        className={styles.folderHeader}
        style={{ paddingLeft: HEADER_BASE_PADDING_PX + level * FOLDER_INDENT_PX }}
        onClick={toggle}
        aria-expanded={expanded}
        title={fullPath}
      >
        <span className={`${styles.folderChevron} ${expanded ? styles.folderChevronExpanded : ''}`}>
          ▶
        </span>
        <span className={styles.folderIcon}>📁</span>
        <span className={styles.folderName}>{name}</span>
        <span className={styles.folderCount}>({profileCount})</span>
      </button>
      {expanded && <div>{children}</div>}
    </div>
  );
}

export const FolderNode = memo(FolderNodeComponent);
