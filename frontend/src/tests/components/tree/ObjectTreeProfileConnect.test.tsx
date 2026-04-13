import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const addConnectionMock = vi.fn().mockResolvedValue({});
const cancelConnectionMock = vi.fn();

vi.mock('../../../store/connectionStore', () => {
  const useConnectionStore = (
    selector?: (s: { connections: unknown[]; profileVersion: number }) => unknown
  ) => (selector ? selector({ connections: [], profileVersion: 0 }) : null);
  (useConnectionStore as unknown as { getState: () => unknown }).getState = () => ({
    connections: [],
    activeConnectionId: null,
  });
  return {
    useConnectionStore,
    useConnectionActions: () => ({
      addConnection: addConnectionMock,
      cancelConnection: cancelConnectionMock,
    }),
  };
});

vi.mock('../../../store/connectionMigration', () => ({
  applyConnectionMigration: vi.fn(),
}));

vi.mock('../../../api/bridge', () => ({
  bridge: {
    getConnectionProfiles: vi.fn().mockResolvedValue({
      profiles: [
        {
          id: 'p_stg',
          name: 'Staging.MMS',
          server: '172.31.17.239',
          port: 1433,
          database: 'MMS',
          username: 'sa',
          useWindowsAuth: false,
          savePassword: false,
          isProduction: false,
          isReadOnly: false,
          environment: 'staging',
          dbType: 'sqlserver',
        },
      ],
    }),
    getProfilePassword: vi.fn().mockResolvedValue({ password: '' }),
    getSshPassword: vi.fn().mockResolvedValue({ password: '' }),
    getSshKeyPassphrase: vi.fn().mockResolvedValue({ passphrase: '' }),
  },
}));

import { ObjectTree } from '../../../components/tree/ObjectTree';

describe('ObjectTree profile connect', () => {
  beforeEach(() => {
    addConnectionMock.mockClear();
    cancelConnectionMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('staging プロファイル接続時に environment=staging が addConnection に渡される', async () => {
    render(<ObjectTree filter="" />);

    const profileItem = await screen.findByText('Staging.MMS');
    fireEvent.click(profileItem);

    const connectButton = await screen.findByText('接続');
    fireEvent.click(connectButton);

    await waitFor(() => {
      expect(addConnectionMock).toHaveBeenCalledWith(
        expect.objectContaining({ environment: 'staging' })
      );
    });
  });
});
