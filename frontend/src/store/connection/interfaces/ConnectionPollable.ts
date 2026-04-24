import type { ConnectResultResponse } from '../../../api/schemas';

export type { ConnectResultResponse };

export interface ConnectionPollable {
  getConnectResult(requestId: string): Promise<ConnectResultResponse>;
}
