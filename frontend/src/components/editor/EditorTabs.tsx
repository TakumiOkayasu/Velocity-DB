import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConnectionStore } from '../../store/connectionStore';
import { useQueries, useQueryActions, useQueryStore } from '../../store/queryStore';
import type { Query } from '../../types';
import { connectionColor } from '../../utils/colorContrast';
import { stripBrackets } from '../../utils/stringUtils';
import { TabIcons } from '../icons/SvgIcons';
import { resolveNewQueryConnectionId } from '../layout/newQueryConnection';
import styles from './EditorTabs.module.css';

const TabFileIcon = ({ isERDiagram }: { isERDiagram: boolean }) =>
  isERDiagram ? (
    <TabIcons.ERDiagram className={styles.tabIcon} />
  ) : (
    <TabIcons.Sql className={styles.tabIcon} />
  );

type ConnectionColorMap = Record<string, { color: string; label: string }>;

function buildTooltip(query: Query, envMap: ConnectionColorMap): string {
  const parts = [stripBrackets(query.name)];
  if (query.logicalName) {
    parts.push(query.logicalName);
  } else if (query.isDataView && query.sourceTable && query.sourceTable !== query.name) {
    parts.push(stripBrackets(query.sourceTable));
  }
  if (query.connectionId) {
    const entry = envMap[query.connectionId];
    if (entry) {
      parts.push(`接続先: ${entry.label}`);
    }
  }
  return parts.join('\n');
}

export function EditorTabs() {
  const queries = useQueries();
  const activeQueryId = useQueryStore((state) => state.activeQueryId);
  const connections = useConnectionStore((s) => s.connections);
  const connectionColorMap: ConnectionColorMap = useMemo(
    () =>
      Object.fromEntries(
        connections.map((c) => [
          c.id,
          {
            color: connectionColor(c.server, c.database),
            label: `${c.server}/${c.database}`,
          },
        ])
      ),
    [connections]
  );
  const { addQuery, removeQuery, setActive, reorderQuery, openERDiagram } = useQueryActions();

  const activeQuery = queries.find((q) => q.id === activeQueryId);
  const activeQueryConnectionId = activeQuery?.connectionId ?? null;

  const tabsRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);

  // DnD state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const checkOverflow = useCallback(() => {
    const el = tabsRef.current;
    if (el) {
      setIsOverflowing(el.scrollWidth > el.clientWidth);
    }
  }, []);

  // ResizeObserver + scroll で溢れ検知
  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;

    checkOverflow();

    const observer = new ResizeObserver(checkOverflow);
    observer.observe(el);
    el.addEventListener('scroll', checkOverflow);

    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', checkOverflow);
    };
  }, [checkOverflow]);

  // タブ数変更時に溢れ再チェック
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- queries.length is intentional to recheck overflow on tab count change
  useEffect(() => {
    checkOverflow();
  }, [queries.length, checkOverflow]);

  // メニュー外クリックで閉じる（各メニュー独立）
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && e.target instanceof Node && !menuRef.current.contains(e.target))
        setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  useEffect(() => {
    if (!addMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (addMenuRef.current && e.target instanceof Node && !addMenuRef.current.contains(e.target))
        setAddMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [addMenuOpen]);

  // --- DnD handlers ---
  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    if (e.currentTarget instanceof HTMLElement) {
      e.dataTransfer.setDragImage(e.currentTarget, e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    }
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragIndex !== null && dragIndex !== index) {
        setDropTarget(index);
      }
    },
    [dragIndex]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, toIndex: number) => {
      e.preventDefault();
      if (dragIndex !== null && dragIndex !== toIndex) {
        reorderQuery(dragIndex, toIndex);
      }
      setDragIndex(null);
      setDropTarget(null);
    },
    [dragIndex, reorderQuery]
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    setDropTarget(null);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDropTarget(null);
  }, []);

  const createERDiagram = useCallback(() => {
    const existingNames = new Set(queries.filter((q) => q.isERDiagram).map((q) => q.name));
    let idx = 1;
    let name = 'ER図';
    while (existingNames.has(name)) {
      idx++;
      name = `ER図 ${idx}`;
    }
    openERDiagram(name);
    setAddMenuOpen(false);
  }, [queries, openERDiagram]);

  return (
    <div role="toolbar" className={styles.container}>
      <div className={styles.tabs} ref={tabsRef} role="tablist">
        {queries.map((query, index) => {
          const connColor = query.connectionId
            ? connectionColorMap[query.connectionId]?.color
            : undefined;
          const isDragging = dragIndex === index;
          const isDropTarget = dropTarget === index;

          const className = [
            styles.tab,
            query.id === activeQueryId && styles.active,
            isDragging && styles.dragging,
            isDropTarget && styles.dropTarget,
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <div
              key={query.id}
              className={className}
              style={connColor ? { '--connection-color': connColor } : undefined}
              role="tab"
              tabIndex={0}
              onClick={() => setActive(query.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setActive(query.id);
                }
              }}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  removeQuery(query.id);
                }
              }}
              title={buildTooltip(query, connectionColorMap)}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
            >
              <TabFileIcon isERDiagram={query.isERDiagram ?? false} />
              <span className={styles.tabName}>
                {query.isDirty && <span className={styles.dirty}>●</span>}
                {stripBrackets(query.name)}
              </span>
              <button
                type="button"
                className={styles.closeButton}
                onClick={(e) => {
                  e.stopPropagation();
                  removeQuery(query.id);
                }}
                title="タブを閉じる"
              >
                <TabIcons.Close />
              </button>
            </div>
          );
        })}
      </div>
      {isOverflowing && (
        <div className={styles.overflowMenuWrapper} ref={menuRef}>
          <button
            type="button"
            className={styles.overflowButton}
            onClick={() => setMenuOpen((prev) => !prev)}
            title="全タブ一覧"
          >
            ▾
          </button>
          {menuOpen && (
            <div className={styles.overflowMenu}>
              {queries.map((query) => (
                <button
                  type="button"
                  key={query.id}
                  className={`${styles.overflowMenuItem} ${query.id === activeQueryId ? styles.activeItem : ''}`}
                  onClick={() => {
                    setActive(query.id);
                    setMenuOpen(false);
                  }}
                >
                  <TabFileIcon isERDiagram={query.isERDiagram ?? false} />
                  <span className={styles.overflowMenuItemName}>{stripBrackets(query.name)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className={styles.addMenuWrapper} ref={addMenuRef}>
        <button
          type="button"
          className={styles.addButton}
          onClick={() => setAddMenuOpen((prev) => !prev)}
          title="新規タブ (Ctrl+N)"
        >
          <TabIcons.Plus />
        </button>
        {addMenuOpen && (
          <div className={styles.overflowMenu}>
            <button
              type="button"
              className={styles.overflowMenuItem}
              onClick={() => {
                const activeConnectionId = useConnectionStore.getState().activeConnectionId;
                addQuery(resolveNewQueryConnectionId(activeQueryConnectionId, activeConnectionId));
                setAddMenuOpen(false);
              }}
            >
              <TabIcons.Sql className={styles.tabIcon} />
              <span>新規クエリ</span>
            </button>
            <button type="button" className={styles.overflowMenuItem} onClick={createERDiagram}>
              <TabIcons.ERDiagram className={styles.tabIcon} />
              <span>新規ER図</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
