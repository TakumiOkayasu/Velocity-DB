export type ConnectionResult =
  | { status: 'connected'; replaced?: { oldId: string; newId: string } }
  | { status: 'failed'; error: string }
  | { status: 'cancelled' };

export interface PreparedConnection {
  connect(): Promise<ConnectionResult>;
}

export interface ConnectionPreparation {
  prepare(): Promise<PreparedConnection>;
}
