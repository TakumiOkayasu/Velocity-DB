import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useERDiagramStore } from '../../store/erDiagramStore';

vi.mock('../../api/providers', () => ({
  schemaProvider: {},
}));

describe('erDiagramStore - viewport & focus', () => {
  beforeEach(() => {
    useERDiagramStore.setState({
      viewports: {},
      focusedNodeId: null,
      selectedPage: 'MAIN',
    });
  });

  afterEach(() => {
    useERDiagramStore.setState({
      viewports: {},
      focusedNodeId: null,
    });
  });

  describe('saveViewport', () => {
    it('should save viewport for a page', () => {
      useERDiagramStore.getState().saveViewport('MAIN', { x: 10, y: 20, zoom: 1.5 });
      expect(useERDiagramStore.getState().viewports.MAIN).toEqual({
        x: 10,
        y: 20,
        zoom: 1.5,
      });
    });

    it('should update existing viewport', () => {
      const { saveViewport } = useERDiagramStore.getState();
      saveViewport('MAIN', { x: 10, y: 20, zoom: 1.5 });
      saveViewport('MAIN', { x: 30, y: 40, zoom: 0.5 });
      expect(useERDiagramStore.getState().viewports.MAIN).toEqual({
        x: 30,
        y: 40,
        zoom: 0.5,
      });
    });

    it('should store viewports for multiple pages independently', () => {
      const { saveViewport } = useERDiagramStore.getState();
      saveViewport('MAIN', { x: 0, y: 0, zoom: 1 });
      saveViewport('SUB', { x: 100, y: 200, zoom: 0.8 });
      const { viewports } = useERDiagramStore.getState();
      expect(viewports.MAIN).toEqual({ x: 0, y: 0, zoom: 1 });
      expect(viewports.SUB).toEqual({ x: 100, y: 200, zoom: 0.8 });
    });
  });

  describe('setFocusedNodeId', () => {
    it('should set focused node id', () => {
      useERDiagramStore.getState().setFocusedNodeId('users');
      expect(useERDiagramStore.getState().focusedNodeId).toBe('users');
    });

    it('should clear focused node id with null', () => {
      useERDiagramStore.getState().setFocusedNodeId('users');
      useERDiagramStore.getState().setFocusedNodeId(null);
      expect(useERDiagramStore.getState().focusedNodeId).toBeNull();
    });
  });

  describe('clearDiagram', () => {
    it('should reset viewports and focusedNodeId', () => {
      const state = useERDiagramStore.getState();
      state.saveViewport('MAIN', { x: 10, y: 20, zoom: 1 });
      state.setFocusedNodeId('users');
      state.clearDiagram();
      expect(useERDiagramStore.getState().viewports).toEqual({});
      expect(useERDiagramStore.getState().focusedNodeId).toBeNull();
    });
  });
});

describe('erDiagramStore - loadFromDatabase (#512 一括列取得)', () => {
  const pk = { name: 'id', type: 'int', size: 4, nullable: false, isPrimaryKey: true };

  beforeEach(() => {
    useERDiagramStore.setState({ tables: [], relations: [], isLoading: false, error: null });
  });

  it('getAllColumns を 1 回だけ呼び、テーブル毎の getColumns を呼ばない', async () => {
    const { schemaProvider } = await import('../../api/providers');
    const getTables = vi.fn().mockResolvedValue({
      tables: [
        { schema: 'dbo', name: 'Users', type: 'TABLE' },
        { schema: 'dbo', name: 'Orders', type: 'TABLE' },
      ],
      loadTimeMs: 1,
    });
    const getAllColumns = vi.fn().mockResolvedValue([
      { schema: 'dbo', table: 'Users', columns: [pk] },
      { schema: 'dbo', table: 'Orders', columns: [pk] },
    ]);
    const getColumns = vi.fn();
    Object.assign(schemaProvider, { getTables, getAllColumns, getColumns });

    await useERDiagramStore.getState().loadFromDatabase('conn-1', 'db1');

    expect(getAllColumns).toHaveBeenCalledTimes(1);
    expect(getColumns).not.toHaveBeenCalled();
    expect(useERDiagramStore.getState().tables).toHaveLength(2);
  });

  it('getAllColumns 失敗時はテーブル毎の getColumns にフォールバックする', async () => {
    const { schemaProvider } = await import('../../api/providers');
    const getTables = vi.fn().mockResolvedValue({
      tables: [
        { schema: 'dbo', name: 'Users', type: 'TABLE' },
        { schema: 'dbo', name: 'Orders', type: 'TABLE' },
      ],
      loadTimeMs: 1,
    });
    const getAllColumns = vi.fn().mockRejectedValue(new Error('not supported'));
    const getColumns = vi.fn().mockResolvedValue([pk]);
    Object.assign(schemaProvider, { getTables, getAllColumns, getColumns });

    await useERDiagramStore.getState().loadFromDatabase('conn-1', 'db1');

    expect(getColumns).toHaveBeenCalledTimes(2);
    expect(useERDiagramStore.getState().tables).toHaveLength(2);
  });
});
