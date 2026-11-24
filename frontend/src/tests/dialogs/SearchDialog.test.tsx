import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vite-plus/test';
import { schemaProvider } from '../../api/providers';
import type { GetTablesResult } from '../../api/providers/schema';
import { SearchDialog } from '../../components/dialogs/SearchDialog';
import { useConnectionStore } from '../../store/connectionStore';

vi.mock('../../api/providers', () => ({
  schemaProvider: { getTables: vi.fn() },
}));

it('検索欄を空にすると検索中の表示が消え、遅れて届いた結果は選択できない', async () => {
  let resolveTables: (result: GetTablesResult) => void;
  const tables = new Promise<GetTablesResult>((resolve) => {
    resolveTables = resolve;
  });
  vi.mocked(schemaProvider.getTables).mockReturnValue(tables);
  const previous = useConnectionStore.getState().activeConnectionId;
  useConnectionStore.setState({ activeConnectionId: 'db' });
  const onResultSelect = vi.fn();

  try {
    render(<SearchDialog isOpen onClose={vi.fn()} onResultSelect={onResultSelect} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'orders' } });
    expect(schemaProvider.getTables).toHaveBeenCalledWith('db', '');
    expect(screen.getByText('⏳')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '' } });
    await act(async () => {
      resolveTables({
        tables: [{ name: 'orders', type: 'TABLE', schema: 'public' }],
        loadTimeMs: 0,
      });
    });

    expect(screen.queryByText('⏳')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /orders/ })).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onResultSelect).not.toHaveBeenCalled();
  } finally {
    cleanup();
    useConnectionStore.setState({ activeConnectionId: previous });
  }
});
