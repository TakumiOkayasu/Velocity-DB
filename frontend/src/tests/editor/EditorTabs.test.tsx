import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorTabs } from '../../components/editor/EditorTabs';
import type { Query } from '../../types';

// --- Mocks ---
const mockAddQuery = vi.fn();
const mockRemoveQuery = vi.fn();
const mockSetActive = vi.fn();
const mockReorderQuery = vi.fn();
const mockOpenERDiagram = vi.fn().mockReturnValue('new-er-id');
let mockQueries: Query[] = [];
let mockActiveQueryId: string | null = null;

vi.mock('../../store/queryStore', () => ({
  useQueries: () => mockQueries,
  useQueryStore: (selector: (s: { activeQueryId: string | null }) => string | null) =>
    selector({ activeQueryId: mockActiveQueryId }),
  useQueryActions: () => ({
    addQuery: mockAddQuery,
    removeQuery: mockRemoveQuery,
    setActive: mockSetActive,
    reorderQuery: mockReorderQuery,
    openERDiagram: mockOpenERDiagram,
  }),
}));

vi.mock('../../store/connectionStore', () => {
  const useConnectionStore = (selector?: (s: { connections: unknown[] }) => unknown) =>
    selector ? selector({ connections: [] }) : [];
  (useConnectionStore as unknown as { getState: () => unknown }).getState = () => ({
    activeConnectionId: null,
  });
  return { useConnectionStore };
});

vi.mock('../../utils/colorContrast', () => ({
  connectionColor: () => '#000',
}));

describe('EditorTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueries = [];
    mockActiveQueryId = null;
  });

  describe('新規タブメニュー', () => {
    it('+ボタンクリックでドロップダウンが表示される', () => {
      render(<EditorTabs />);
      const addButton = screen.getByTitle('新規タブ (Ctrl+N)');

      fireEvent.click(addButton);

      expect(screen.getByText('新規クエリ')).toBeInTheDocument();
      expect(screen.getByText('新規ER図')).toBeInTheDocument();
    });

    it('+ボタン再クリックでドロップダウンが閉じる', () => {
      render(<EditorTabs />);
      const addButton = screen.getByTitle('新規タブ (Ctrl+N)');

      fireEvent.click(addButton);
      expect(screen.getByText('新規クエリ')).toBeInTheDocument();

      fireEvent.click(addButton);
      expect(screen.queryByText('新規クエリ')).not.toBeInTheDocument();
    });

    it('「新規クエリ」クリックで addQuery が呼ばれメニューが閉じる', () => {
      render(<EditorTabs />);
      fireEvent.click(screen.getByTitle('新規タブ (Ctrl+N)'));
      fireEvent.click(screen.getByText('新規クエリ'));

      expect(mockAddQuery).toHaveBeenCalledWith(null);
      expect(screen.queryByText('新規クエリ')).not.toBeInTheDocument();
    });

    it('ER図が存在しない場合「ER図」で作成される', () => {
      render(<EditorTabs />);
      fireEvent.click(screen.getByTitle('新規タブ (Ctrl+N)'));
      fireEvent.click(screen.getByText('新規ER図'));

      expect(mockOpenERDiagram).toHaveBeenCalledWith('ER図');
      expect(screen.queryByText('新規ER図')).not.toBeInTheDocument();
    });

    it('既存ER図がある場合はユニーク名で作成される', () => {
      mockQueries = [
        {
          id: '1',
          name: 'ER図',
          content: '',
          connectionId: null,
          isDirty: false,
          isERDiagram: true,
        },
      ];

      render(<EditorTabs />);
      fireEvent.click(screen.getByTitle('新規タブ (Ctrl+N)'));
      fireEvent.click(screen.getByText('新規ER図'));

      expect(mockOpenERDiagram).toHaveBeenCalledWith('ER図 2');
    });
  });

  describe('キーボードショートカット', () => {
    // Ctrl+W のショートカットは MainLayout 側で一元管理する。
    // EditorTabs が独自に window.keydown を購読すると二重発火で複数タブが閉じる (#391)。
    it('Ctrl+W を EditorTabs 単体では購読せず removeQuery を呼ばない', () => {
      mockActiveQueryId = 'q1';
      mockQueries = [
        {
          id: 'q1',
          name: 'Test',
          content: '',
          connectionId: null,
          isDirty: false,
          isERDiagram: false,
        },
      ];

      render(<EditorTabs />);

      window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: 'w' }));

      expect(mockRemoveQuery).not.toHaveBeenCalled();
    });
  });
});
