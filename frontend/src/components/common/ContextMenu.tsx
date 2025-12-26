import { useEffect, useRef } from 'react';
import styles from './ContextMenu.module.css';

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  action: () => void;
  disabled?: boolean;
  separator?: boolean;
  id?: string;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // Add listener after a brief delay to avoid immediate closing
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 10);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Adjust position if menu would go off screen
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let adjustedX = x;
      let adjustedY = y;

      if (rect.right > viewportWidth) {
        adjustedX = viewportWidth - rect.width - 10;
      }

      if (rect.bottom > viewportHeight) {
        adjustedY = viewportHeight - rect.height - 10;
      }

      menuRef.current.style.left = `${adjustedX}px`;
      menuRef.current.style.top = `${adjustedY}px`;
    }
  }, [x, y]);

  const handleItemClick = (item: ContextMenuItem) => {
    if (!item.disabled) {
      item.action();
      onClose();
    }
  };

  // Generate unique keys for items
  const getItemKey = (item: ContextMenuItem, index: number): string => {
    if (item.id) return item.id;
    if (item.separator) {
      // For separators, use adjacent items to create a unique key
      const prevItem = index > 0 ? items[index - 1] : null;
      const nextItem = index < items.length - 1 ? items[index + 1] : null;
      const prevLabel = prevItem && !prevItem.separator ? prevItem.label : 'start';
      const nextLabel = nextItem && !nextItem.separator ? nextItem.label : 'end';
      return `separator-${prevLabel}-${nextLabel}`;
    }
    return item.label;
  };

  return (
    <div ref={menuRef} className={styles.container} style={{ left: x, top: y }}>
      {items.map((item, index) =>
        item.separator ? (
          <div key={getItemKey(item, index)} className={styles.separator} />
        ) : (
          <button
            key={getItemKey(item, index)}
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
