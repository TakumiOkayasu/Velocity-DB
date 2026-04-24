import type { ConnectionPollable } from '../interfaces/ConnectionPollable';

export const CONNECTION_POLL_INTERVAL_MS = 500;

export async function pollConnection(
  bridge: ConnectionPollable,
  requestId: string,
  isCancelled: () => boolean,
  pollIntervalMs: number = CONNECTION_POLL_INTERVAL_MS
): Promise<{ connectionId: string }> {
  while (true) {
    if (isCancelled()) {
      throw new Error('Connection cancelled');
    }

    const status = await bridge.getConnectResult(requestId);

    if (status.status === 'connected' && status.connectionId) {
      return { connectionId: status.connectionId };
    }
    if (status.status === 'failed') {
      throw new Error(status.error ?? 'Connection failed');
    }
    if (status.status === 'cancelled') {
      throw new Error('Connection cancelled');
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}
