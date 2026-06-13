// Resolve an org's stored (encrypted) Salesforce connection into a live client.

import { type Database, getConnection, setConnectionStatus } from '@northbeam/db';
import { SalesforceClient, SalesforceError } from '@northbeam/salesforce';
import { decryptSecret } from '../lib/crypto.js';

export class NoConnectionError extends Error {
  constructor() {
    super('no Salesforce connection for this workspace');
    this.name = 'NoConnectionError';
  }
}

export async function clientForOrg(db: Database, orgId: string): Promise<SalesforceClient> {
  const conn = await getConnection(db, orgId);
  if (!conn || conn.status !== 'connected' || !conn.accessTokenEnc) throw new NoConnectionError();
  return new SalesforceClient({
    instanceUrl: conn.instanceUrl,
    accessToken: decryptSecret(conn.accessTokenEnc),
  });
}

/** Mark the connection errored when SF rejects the token (expired CLI token etc.). */
export async function flagIfAuthError(db: Database, orgId: string, err: unknown): Promise<void> {
  if (err instanceof SalesforceError && err.status === 401) {
    await setConnectionStatus(db, orgId, 'error');
  }
}
