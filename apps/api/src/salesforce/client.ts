// Resolve an org's stored (encrypted) Salesforce connection into a live client,
// with automatic token refresh on 401 (access token expiry).

import {
  type DbExecutor,
  type SalesforceConnectionRow,
  getConnection,
  rotateTokens,
  setConnectionStatus,
} from '@northbeam/db';
import {
  type QueryResult,
  SalesforceClient,
  SalesforceError,
  refreshAccessToken,
} from '@northbeam/salesforce';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';
import { env } from '../lib/env.js';

export class NoConnectionError extends Error {
  constructor() {
    super('no Salesforce connection for this workspace');
    this.name = 'NoConnectionError';
  }
}

// Module-level: per-org in-flight refresh promise that resolves to the new plain
// access token. A Map is enough at v1 scale (single API server process). Without
// this, two concurrent tRPC callers that both hit 401 at the same moment would
// each fire a separate refresh request to Salesforce, burning the refresh token
// on the first one and leaving the second with an invalid_grant error.
const refreshInFlight = new Map<string, Promise<string>>();

/**
 * Attempt to exchange the stored refresh token for a new access token. The
 * result is persisted, and the new plain access token is returned so callers
 * can build an updated SalesforceClient.
 *
 * Concurrent calls for the same org share a single in-flight promise; the
 * second caller piggybacks on the first rather than racing to the token endpoint.
 */
async function attemptTokenRefresh(
  db: DbExecutor,
  orgId: string,
  conn: SalesforceConnectionRow,
): Promise<string> {
  const existing = refreshInFlight.get(orgId);
  if (existing) return existing;

  const promise = (async (): Promise<string> => {
    if (!conn.refreshTokenEnc) {
      // No refresh token — nothing to attempt. The caller will re-throw the
      // original 401 and flagIfAuthError will mark the connection as error.
      throw new SalesforceError(401, 'no refresh token stored for this connection');
    }

    const { SF_CLIENT_ID, SF_CLIENT_SECRET, SF_LOGIN_URL } = env();
    if (!SF_CLIENT_ID || !SF_CLIENT_SECRET) {
      // OAuth app not configured in this environment (e.g. dev with CLI token).
      // Propagate as-is; flagIfAuthError will handle it.
      throw new SalesforceError(401, 'SF OAuth client credentials not configured');
    }

    let newAccessToken: string;
    let newRefreshToken: string | undefined;
    try {
      const tok = await refreshAccessToken({
        loginUrl: SF_LOGIN_URL,
        clientId: SF_CLIENT_ID,
        clientSecret: SF_CLIENT_SECRET,
        refreshToken: decryptSecret(conn.refreshTokenEnc),
      });
      newAccessToken = tok.access_token;
      newRefreshToken = tok.refresh_token; // undefined when SF doesn't rotate it
    } catch (err) {
      // Token endpoint rejected the refresh token — connection is now broken.
      // Set status to 'error' here; the error propagates so callers know.
      await setConnectionStatus(db, orgId, 'error');
      throw err;
    }

    // Persist the new tokens. Only update refreshTokenEnc when SF returned a
    // rotated refresh token; otherwise keep the existing one.
    await rotateTokens(db, orgId, {
      accessTokenEnc: encryptSecret(newAccessToken),
      ...(newRefreshToken ? { refreshTokenEnc: encryptSecret(newRefreshToken) } : {}),
    });

    return newAccessToken;
  })();

  refreshInFlight.set(orgId, promise);
  // Clean up regardless of outcome so a future call after a transient failure
  // can retry rather than re-awaiting a stale rejected promise.
  promise.finally(() => refreshInFlight.delete(orgId));

  return promise;
}

/**
 * Wraps SalesforceClient so that a 401 triggers one token-refresh attempt.
 * All public methods are overridden to delegate to `this.inner`, which is
 * swapped out for a new client carrying the refreshed access token when a
 * refresh succeeds.
 *
 * Extends SalesforceClient so it is structurally compatible with the type
 * expected by executeRun and every tRPC caller (they typed the parameter as
 * SalesforceClient). The super() instance is a dead stub — all real requests
 * go through `this.inner`.
 */
class RefreshingSalesforceClient extends SalesforceClient {
  private inner: SalesforceClient;

  constructor(
    private readonly db: DbExecutor,
    private readonly orgId: string,
    private readonly conn: SalesforceConnectionRow,
    accessToken: string,
  ) {
    // super() is required by the class hierarchy; it creates a stub that is
    // never used — every method below delegates to this.inner instead.
    super({ instanceUrl: conn.instanceUrl, accessToken });
    this.inner = new SalesforceClient({ instanceUrl: conn.instanceUrl, accessToken });
  }

  /** Run fn(inner), refresh once on 401, then retry. */
  private async withRefresh<T>(fn: (c: SalesforceClient) => Promise<T>): Promise<T> {
    try {
      return await fn(this.inner);
    } catch (err) {
      if (!(err instanceof SalesforceError) || err.status !== 401) throw err;
      // No refresh token → re-throw the original 401 so flagIfAuthError can
      // mark the connection as broken (same behaviour as before this change).
      if (!this.conn.refreshTokenEnc) throw err;
      const newToken = await attemptTokenRefresh(this.db, this.orgId, this.conn);
      this.inner = new SalesforceClient({
        instanceUrl: this.conn.instanceUrl,
        accessToken: newToken,
      });
      // Retry once with the refreshed credentials.
      return fn(this.inner);
    }
  }

  override globalDescribe() {
    return this.withRefresh((c) => c.globalDescribe());
  }

  override describe(sobject: string) {
    return this.withRefresh((c) => c.describe(sobject));
  }

  override query<T = Record<string, unknown>>(soql: string): Promise<QueryResult<T>> {
    return this.withRefresh<QueryResult<T>>((c) => c.query<T>(soql));
  }

  override queryMore<T = Record<string, unknown>>(nextRecordsUrl: string): Promise<QueryResult<T>> {
    return this.withRefresh<QueryResult<T>>((c) => c.queryMore<T>(nextRecordsUrl));
  }

  override toolingQuery<T = Record<string, unknown>>(soql: string): Promise<QueryResult<T>> {
    return this.withRefresh<QueryResult<T>>((c) => c.toolingQuery<T>(soql));
  }

  /** Async generator: restart from the beginning on 401 (after one refresh). */
  override async *queryAll<T = Record<string, unknown>>(soql: string): AsyncGenerator<T> {
    try {
      yield* this.inner.queryAll<T>(soql);
    } catch (err) {
      if (!(err instanceof SalesforceError) || err.status !== 401) throw err;
      if (!this.conn.refreshTokenEnc) throw err;
      const newToken = await attemptTokenRefresh(this.db, this.orgId, this.conn);
      this.inner = new SalesforceClient({
        instanceUrl: this.conn.instanceUrl,
        accessToken: newToken,
      });
      yield* this.inner.queryAll<T>(soql);
    }
  }

  override count(sobject: string, where?: string) {
    return this.withRefresh((c) => c.count(sobject, where));
  }

  override downloadBlob(path: string) {
    return this.withRefresh((c) => c.downloadBlob(path));
  }

  override listReports(limit?: number) {
    return this.withRefresh((c) => c.listReports(limit));
  }

  override listDashboards(limit?: number) {
    return this.withRefresh((c) => c.listDashboards(limit));
  }

  override getReportDescribe(id: string) {
    return this.withRefresh((c) => c.getReportDescribe(id));
  }

  override getDashboardDescribe(id: string) {
    return this.withRefresh((c) => c.getDashboardDescribe(id));
  }

  override listFlowDefinitions(limit?: number) {
    return this.withRefresh((c) => c.listFlowDefinitions(limit));
  }

  override getFlowVersion(id: string) {
    return this.withRefresh((c) => c.getFlowVersion(id));
  }

  override listWorkflowRules(limit?: number) {
    return this.withRefresh((c) => c.listWorkflowRules(limit));
  }

  override getWorkflowRuleMetadata(id: string) {
    return this.withRefresh((c) => c.getWorkflowRuleMetadata(id));
  }

  override getWorkflowFieldUpdate(id: string) {
    return this.withRefresh((c) => c.getWorkflowFieldUpdate(id));
  }

  override getWorkflowAlert(id: string) {
    return this.withRefresh((c) => c.getWorkflowAlert(id));
  }

  override getWorkflowTask(id: string) {
    return this.withRefresh((c) => c.getWorkflowTask(id));
  }

  override listApexTriggers(limit?: number) {
    return this.withRefresh((c) => c.listApexTriggers(limit));
  }
}

export async function clientForOrg(db: DbExecutor, orgId: string): Promise<SalesforceClient> {
  const conn = await getConnection(db, orgId);
  if (!conn || conn.status !== 'connected' || !conn.accessTokenEnc) throw new NoConnectionError();
  return new RefreshingSalesforceClient(db, orgId, conn, decryptSecret(conn.accessTokenEnc));
}

/**
 * Called by tRPC routes and the import engine after a Salesforce call throws.
 * By the time this runs, RefreshingSalesforceClient has already attempted
 * (and exhausted) the one-retry path, so a 401 here means either:
 *   • the connection had no refresh token, or
 *   • the retry after refresh also failed.
 * In both cases, marking the connection as 'error' is the right outcome.
 */
export async function flagIfAuthError(db: DbExecutor, orgId: string, err: unknown): Promise<void> {
  if (err instanceof SalesforceError && err.status === 401) {
    await setConnectionStatus(db, orgId, 'error');
  }
}
