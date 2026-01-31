import { useCallback, useEffect, useRef } from 'react';
import styles from './ContextMenu.module.css';

export interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  action: () => void;
  disabled?: boolean;
  divider?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Adjust position if menu would overflow viewport
  const adjustPosition = useCallback(() => {
    if (!menuRef.current) return { x, y };

    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let adjustedX = x;
    let adjustedY = y;

    if (x + rect.width > viewportWidth) {
      adjustedX = viewportWidth - rect.width - 8;
    }
    if (y + rect.height > viewportHeight) {
      adjustedY = viewportHeight - rect.height - 8;
    }

    return { x: adjustedX, y: adjustedY };
  }, [x, y]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Adjust position after render
  useEffect(() => {
    if (menuRef.current) {
      const { x: adjustedX, y: adjustedY } = adjustPosition();
      menuRef.current.style.left = `${adjustedX}px`;
      menuRef.current.style.top = `${adjustedY}px`;
    }
  }, [adjustPosition]);

  const handleItemClick = (item: MenuItem) => {
    if (!item.disabled) {
      item.action();
      onClose();
    }
  };

  return (
    <div ref={menuRef} className={styles.menu} style={{ left: x, top: y }}>
      {items.map((item, index) =>
        item.divider ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: dividers have no unique ID
          <div key={`divider-${index}`} className={styles.divider} />
        ) : (
          <button
            key={item.label}
            className={`${styles.item} ${item.disabled ? styles.disabled : ''}`}
            onClick={() => handleItemClick(item)}
            disabled={item.disabled}
          >
            {item.icon && <span className={styles.icon}>{item.icon}</span>}
            <span className={styles.label}>{item.label}</span>
          </button>
        )
      )}
    </div>
  );
}
