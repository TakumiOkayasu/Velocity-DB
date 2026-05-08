import type { IPCRequest, IPCResponse } from '../../types';

export type { IPCRequest, IPCResponse };

export function isIPCResponse(obj: unknown): obj is IPCResponse {
  return typeof obj === 'object' && obj !== null && 'success' in obj;
}
