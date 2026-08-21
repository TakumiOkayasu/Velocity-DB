import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { pollConnection } from '../../store/connection/helpers/connectionPolling';
import type {
  ConnectionPollable,
  ConnectResultResponse,
} from '../../store/connection/interfaces/ConnectionPollable';

function createMockBridge(
  responses: ConnectResultResponse | ConnectResultResponse[]
): ConnectionPollable {
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  if (queue.length === 0) {
    throw new Error('createMockBridge: responses が空');
  }
  let last: ConnectResultResponse = queue[0];
  return {
    getConnectResult: vi.fn(async () => {
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next !== undefined) last = next;
      return last;
    }),
  };
}

describe('pollConnection', () => {
  describe('resolve paths', () => {
    it('should_resolve_when_status_connected', async () => {
      // Arrange
      const bridge = createMockBridge({ status: 'connected', connectionId: 'conn-123' });

      // Act
      const result = await pollConnection(bridge, 'req-1', () => false, 0);

      // Assert
      expect(result).toEqual({ connectionId: 'conn-123' });
      expect(bridge.getConnectResult).toHaveBeenCalledWith('req-1');
    });

    it('should_poll_until_status_changes_from_pending_to_connected', async () => {
      // Arrange
      const bridge = createMockBridge([
        { status: 'pending' },
        { status: 'pending' },
        { status: 'connected', connectionId: 'conn-xyz' },
      ]);

      // Act
      const result = await pollConnection(bridge, 'req-2', () => false, 0);

      // Assert
      expect(result).toEqual({ connectionId: 'conn-xyz' });
      expect(bridge.getConnectResult).toHaveBeenCalledTimes(3);
    });
  });

  describe('reject paths', () => {
    it('should_reject_when_status_failed_with_error', async () => {
      // Arrange
      const bridge = createMockBridge({ status: 'failed', error: 'bad credentials' });

      // Act & Assert
      await expect(pollConnection(bridge, 'req-3', () => false, 0)).rejects.toThrow(
        'bad credentials'
      );
    });

    it('should_reject_with_default_message_when_status_failed_without_error', async () => {
      // Arrange
      const bridge = createMockBridge({ status: 'failed' });

      // Act & Assert
      await expect(pollConnection(bridge, 'req-4', () => false, 0)).rejects.toThrow(
        'Connection failed'
      );
    });

    it('should_reject_when_status_cancelled', async () => {
      // Arrange
      const bridge = createMockBridge({ status: 'cancelled' });

      // Act & Assert
      await expect(pollConnection(bridge, 'req-5', () => false, 0)).rejects.toThrow(
        'Connection cancelled'
      );
    });

    it('should_reject_when_isCancelled_returns_true_on_first_check', async () => {
      // Arrange
      const bridge = createMockBridge({ status: 'connected', connectionId: 'conn-never' });

      // Act & Assert
      await expect(pollConnection(bridge, 'req-6', () => true, 0)).rejects.toThrow(
        'Connection cancelled'
      );
      expect(bridge.getConnectResult).not.toHaveBeenCalled();
    });

    it('should_reject_when_isCancelled_becomes_true_between_polls', async () => {
      // Arrange
      const bridge = createMockBridge([{ status: 'pending' }, { status: 'pending' }]);
      let callCount = 0;
      const isCancelled = () => {
        callCount += 1;
        return callCount > 2;
      };

      // Act & Assert
      await expect(pollConnection(bridge, 'req-7', isCancelled, 0)).rejects.toThrow(
        'Connection cancelled'
      );
      expect(bridge.getConnectResult).toHaveBeenCalledTimes(2);
    });

    it('should_propagate_error_when_bridge_throws', async () => {
      // Arrange
      const bridge: ConnectionPollable = {
        getConnectResult: vi.fn().mockRejectedValue(new Error('IPC error')),
      };

      // Act & Assert
      await expect(pollConnection(bridge, 'req-8', () => false, 0)).rejects.toThrow('IPC error');
    });
  });

  describe('guard conditions', () => {
    it('should_continue_polling_when_status_connected_without_connectionId', async () => {
      // connectionId 未設定の connected は pending 扱いで次ポーリングに進むこと
      // Arrange
      const bridge = createMockBridge([
        { status: 'connected' }, // connectionId 欠損: resolve 条件不成立
        { status: 'connected', connectionId: 'conn-retry' },
      ]);

      // Act
      const result = await pollConnection(bridge, 'req-9', () => false, 0);

      // Assert
      expect(result).toEqual({ connectionId: 'conn-retry' });
      expect(bridge.getConnectResult).toHaveBeenCalledTimes(2);
    });
  });

  describe('timing', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('should_wait_pollIntervalMs_between_polls', async () => {
      // Arrange
      const bridge = createMockBridge([
        { status: 'pending' },
        { status: 'connected', connectionId: 'conn-ok' },
      ]);

      // Act
      const promise = pollConnection(bridge, 'req-10', () => false, 123);
      await vi.advanceTimersByTimeAsync(0);
      expect(bridge.getConnectResult).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(122);
      expect(bridge.getConnectResult).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);

      // Assert
      await expect(promise).resolves.toEqual({ connectionId: 'conn-ok' });
      expect(bridge.getConnectResult).toHaveBeenCalledTimes(2);
    });
  });
});
