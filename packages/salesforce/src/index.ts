// @northbeam/salesforce — thin transport client for the Salesforce REST + Tooling
// APIs, plus OAuth helpers. Pure: it takes { instanceUrl, accessToken } and knows
// nothing about how those were obtained (web-server OAuth or a dev CLI token).
// The migration engine (apps/api) builds on top of this.

export const SF_API_VERSION = 'v62.0';
export const SF_DEFAULT_LOGIN_URL = 'https://login.salesforce.com';

export type SalesforceAuth = { instanceUrl: string; accessToken: string };

/* ── describe() result shapes (the subset the importer reads) ───────────────── */

export interface DescribePicklistValue {
  value: string;
  label: string;
  active: boolean;
  defaultValue: boolean;
}

export interface DescribeField {
  name: string;
  label: string;
  type: string; // SF soap type: string|double|picklist|reference|…
  custom: boolean;
  calculated: boolean;
  calculatedFormula: string | null;
  referenceTo: string[];
  relationshipName: string | null;
  picklistValues: DescribePicklistValue[];
  length: number;
  precision: number;
  scale: number;
  nillable: boolean;
  unique: boolean;
  createable: boolean;
  updateable: boolean;
  encrypted?: boolean;
  compoundFieldName: string | null;
  controllerName?: string | null;
  defaultValueFormula?: string | null;
  restrictedPicklist?: boolean;
  nameField?: boolean;
}

export interface DescribeRecordTypeInfo {
  name: string;
  developerName: string;
  recordTypeId: string;
  master: boolean;
  available: boolean;
  defaultRecordTypeMapping: boolean;
}

export interface DescribeChildRelationship {
  childSObject: string;
  field: string;
  relationshipName: string | null;
}

export interface SObjectDescribe {
  name: string;
  label: string;
  labelPlural: string;
  custom: boolean;
  keyPrefix: string | null;
  fields: DescribeField[];
  recordTypeInfos: DescribeRecordTypeInfo[];
  childRelationships: DescribeChildRelationship[];
}

export interface GlobalDescribeSObject {
  name: string;
  label: string;
  labelPlural: string;
  custom: boolean;
  queryable: boolean;
  createable: boolean;
  keyPrefix: string | null;
}

export interface GlobalDescribe {
  sobjects: GlobalDescribeSObject[];
}

export interface QueryResult<T = Record<string, unknown>> {
  totalSize: number;
  done: boolean;
  nextRecordsUrl?: string;
  records: T[];
}

export class SalesforceError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`Salesforce API ${status}: ${body}`);
    this.name = 'SalesforceError';
  }
}

export class SalesforceClient {
  constructor(
    private readonly auth: SalesforceAuth,
    private readonly apiVersion: string = SF_API_VERSION,
  ) {}

  private base(): string {
    return `${this.auth.instanceUrl}/services/data/${this.apiVersion}`;
  }

  /** Low-level request against an absolute or instance-relative path. */
  private async request(path: string, init?: RequestInit): Promise<Response> {
    const url = path.startsWith('http') ? path : `${this.auth.instanceUrl}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.auth.accessToken}`,
        Accept: 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) throw new SalesforceError(res.status, await res.text());
    return res;
  }

  async globalDescribe(): Promise<GlobalDescribe> {
    return (
      await this.request(`/services/data/${this.apiVersion}/sobjects/`)
    ).json() as Promise<GlobalDescribe>;
  }

  async describe(sobject: string): Promise<SObjectDescribe> {
    return (
      await this.request(`/services/data/${this.apiVersion}/sobjects/${sobject}/describe`)
    ).json() as Promise<SObjectDescribe>;
  }

  async query<T = Record<string, unknown>>(soql: string): Promise<QueryResult<T>> {
    return (
      await this.request(`${this.base()}/query?q=${encodeURIComponent(soql)}`)
    ).json() as Promise<QueryResult<T>>;
  }

  async queryMore<T = Record<string, unknown>>(nextRecordsUrl: string): Promise<QueryResult<T>> {
    return (await this.request(nextRecordsUrl)).json() as Promise<QueryResult<T>>;
  }

  /** Tooling API query (RecordType / ValidationRule / Flow metadata). */
  async toolingQuery<T = Record<string, unknown>>(soql: string): Promise<QueryResult<T>> {
    return (
      await this.request(`${this.base()}/tooling/query?q=${encodeURIComponent(soql)}`)
    ).json() as Promise<QueryResult<T>>;
  }

  /** Stream every record of a SOQL query, following pagination. */
  async *queryAll<T = Record<string, unknown>>(soql: string): AsyncGenerator<T> {
    let page = await this.query<T>(soql);
    for (const r of page.records) yield r;
    while (!page.done && page.nextRecordsUrl) {
      page = await this.queryMore<T>(page.nextRecordsUrl);
      for (const r of page.records) yield r;
    }
  }

  /** Count of records (cheap COUNT() SOQL) — used for populated-field heuristics. */
  async count(sobject: string, where?: string): Promise<number> {
    const soql = `SELECT COUNT() FROM ${sobject}${where ? ` WHERE ${where}` : ''}`;
    return (await this.query(soql)).totalSize;
  }

  /** Download a binary (e.g. ContentVersion VersionData) at an instance path. */
  async downloadBlob(path: string): Promise<Buffer> {
    const res = await this.request(path);
    return Buffer.from(await res.arrayBuffer());
  }
}

/* ── OAuth 2.0 web-server flow helpers ──────────────────────────────────────── */

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  instance_url: string;
  id: string;
  token_type: string;
  issued_at: string;
  signature: string;
}

export function authorizeUrl(opts: {
  loginUrl: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string;
}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    state: opts.state,
    scope: opts.scope ?? 'api refresh_token offline_access',
  });
  return `${opts.loginUrl}/services/oauth2/authorize?${params.toString()}`;
}

async function tokenRequest(loginUrl: string, body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new SalesforceError(res.status, await res.text());
  return res.json() as Promise<TokenResponse>;
}

export function exchangeCode(opts: {
  loginUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<TokenResponse> {
  return tokenRequest(
    opts.loginUrl,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code: opts.code,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uri: opts.redirectUri,
    }),
  );
}

export function refreshAccessToken(opts: {
  loginUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<TokenResponse> {
  return tokenRequest(
    opts.loginUrl,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: opts.refreshToken,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
    }),
  );
}
