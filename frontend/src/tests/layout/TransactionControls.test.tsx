import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { TransactionControls } from '../../components/layout/TransactionControls';

const mocks = vi.hoisted(() => ({
  state: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('../../api/providers', () => ({
  transactionProvider: {
    getTransactionState: mocks.state,
    commit: mocks.commit,
    rollback: mocks.rollback,
  },
}));
vi.mock('../../store/toastStore', () => ({
  useToastStore: { getState: () => ({ addToast: mocks.toast }) },
}));
vi.mock('../../utils/settingsUtils', () => ({
  getSettings: () => ({ query: { autoCommit: false } }),
  SETTINGS_CHANGED_EVENT: 'settings-changed',
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.mockResolvedValue({ active: true, busy: false });
  mocks.commit.mockResolvedValue(undefined);
  mocks.rollback.mockResolvedValue(undefined);
});

describe('manual transaction controls', () => {
  it('commits the selected connection and refreshes its transaction state', async () => {
    render(<TransactionControls connectionId="c1" />);
    await waitFor(() => expect(screen.getByText('Commit')).toBeEnabled());
    fireEvent.click(screen.getByText('Commit'));
    await waitFor(() => expect(mocks.commit).toHaveBeenCalledExactlyOnceWith('c1'));
    await waitFor(() => expect(mocks.state).toHaveBeenCalledTimes(2));
  });
  it('disables both actions while a query is still running', async () => {
    mocks.state.mockResolvedValue({ active: true, busy: true });
    render(<TransactionControls connectionId="c1" />);
    await screen.findByText('未コミット');
    expect(screen.getByText('Commit')).toBeDisabled();
    expect(screen.getByText('Rollback')).toBeDisabled();
  });
  it('does not apply the previous connection state to a newly selected connection', async () => {
    const { rerender } = render(<TransactionControls connectionId="c1" />);
    await waitFor(() => expect(screen.getByText('Commit')).toBeEnabled());
    mocks.state.mockImplementation(() => new Promise(() => {}));
    rerender(<TransactionControls connectionId="c2" />);
    expect(screen.getByText('Commit')).toBeDisabled();
    fireEvent.click(screen.getByText('Commit'));
    expect(mocks.commit).not.toHaveBeenCalled();
  });
  it('keeps a failed transaction available for rollback', async () => {
    mocks.commit.mockRejectedValue(new Error('commit failed'));
    render(<TransactionControls connectionId="c1" />);
    await waitFor(() => expect(screen.getByText('Commit')).toBeEnabled());
    await act(async () => fireEvent.click(screen.getByText('Commit')));
    expect(mocks.toast).toHaveBeenCalledWith('commit failed', 'error');
    await waitFor(() => expect(screen.getByText('Rollback')).toBeEnabled());
    fireEvent.click(screen.getByText('Rollback'));
    await waitFor(() => expect(mocks.rollback).toHaveBeenCalledExactlyOnceWith('c1'));
  });
});
