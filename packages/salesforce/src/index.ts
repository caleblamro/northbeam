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

/* ── Analytics REST API shapes (the subset the report importer reads) ────────
   Listing goes through SOQL on the Report / Dashboard sobjects because the
   Analytics list endpoints only return ~200 recently-viewed items. Describe
   shapes follow the v62 Analytics REST API; fields we don't read are omitted
   and everything defensive-optional — real orgs drift. */

export interface ReportListItem {
  Id: string;
  Name: string;
  DeveloperName: string;
  FolderName: string | null;
  Format: string | null; // 'Tabular' | 'Summary' | 'Matrix' | 'MultiBlock'
}

export interface DashboardListItem {
  Id: string;
  Title: string;
  DeveloperName: string;
  FolderName: string | null;
}

export interface ReportGrouping {
  name: string;
  dateGranularity?: string | null; // 'None' | 'Day' | 'Week' | 'Month' | 'Quarter' | 'Year' | 'FiscalQuarter' | …
  sortOrder?: string;
  sortAggregate?: string | null;
}

export interface ReportFilterItem {
  column: string;
  operator: string; // equals | notEqual | contains | startsWith | greaterThan | …
  value: string;
  filterType?: string;
}

export interface ReportChartMetadata {
  chartType?: string; // Bar | BarStacked | Column | ColumnStacked | Line | Pie | Donut | Funnel | Scatter | …
  groupings?: string[];
  summaries?: string[];
  title?: string | null;
}

export interface ReportMetadata {
  id: string;
  name: string;
  developerName: string;
  reportFormat: string; // 'TABULAR' | 'SUMMARY' | 'MATRIX' | 'MULTI_BLOCK'
  reportType: { type: string; label: string };
  detailColumns?: string[];
  groupingsDown?: ReportGrouping[];
  groupingsAcross?: ReportGrouping[];
  aggregates?: string[]; // 'RowCount' | 's!AMOUNT' | 'a!AMOUNT' | 'm!AMOUNT' | 'mx!AMOUNT' | 'FORMULA1' …
  reportFilters?: ReportFilterItem[];
  reportBooleanFilter?: string | null;
  standardDateFilter?: {
    column: string;
    durationValue?: string;
    startDate?: string | null;
    endDate?: string | null;
  } | null;
  chart?: ReportChartMetadata | null;
}

export interface ReportDescribeResult {
  reportMetadata: ReportMetadata;
  reportExtendedMetadata?: {
    detailColumnInfo?: Record<string, { label?: string; dataType?: string }>;
  };
}

export interface DashboardComponent {
  id?: string;
  header?: string | null;
  title?: string | null;
  footer?: string | null;
  reportId?: string | null;
  type?: string; // observed: 'Report'
  /** Index into the dashboard's componentData array (may be empty when the
   *  caller can't see the underlying reports). */
  componentData?: number;
  /** Null on flex dashboards — fall back to the source report's chart. */
  properties?: {
    visualizationType?: string; // Bar | Column | Line | Pie | Donut | Funnel | Metric | Gauge | Table | FlatTable | Scatter | …
    useReportChart?: boolean;
    maxValuesDisplayed?: number;
    groupings?: string[];
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

/** layout.components aligns BY INDEX with the top-level components array;
 *  colspan is out of the same 12-column grid Northbeam artifacts use. */
export interface DashboardLayoutComponent {
  colspan?: number;
  column?: number;
  row?: number;
  rowspan?: number;
  [key: string]: unknown;
}

export interface DashboardDescribeResult {
  id?: string;
  name?: string;
  developerName?: string;
  folderName?: string | null;
  components?: DashboardComponent[];
  layout?: {
    components?: DashboardLayoutComponent[];
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

/* ── Tooling API automation shapes (Flow / WorkflowRule / ApexTrigger) ───────
   Verified against a real org (fixture, Tooling REST v67 via the sf CLI,
   2026-07): the Tooling REST JSON serializer returns EVERY documented key with
   explicit nulls (unlike Metadata API XML, which omits absent elements), and
   element arrays (assignments, decisions, …) are present as [] even when
   empty. Everything stays defensive-optional anyway — shapes drift across API
   versions and flow kinds. Queries that select the Metadata or FullName
   columns MUST resolve to a single row (server enforces MALFORMED_QUERY
   "no more than one row for retrieval" otherwise), hence the Id filters. */

export interface FlowDefinitionListItem {
  Id: string;
  DeveloperName: string;
  /** Null when no version is active (verified on a Draft-only flow). */
  ActiveVersionId: string | null;
  LatestVersionId: string | null;
}

export interface FlowConnector {
  targetReference?: string | null;
  isGoTo?: boolean | null;
  [key: string]: unknown;
}

/** Flow "value union": at most one member is non-null (all keys are
 *  present-with-null in Tooling REST JSON). */
export interface FlowElementValue {
  stringValue?: string | null;
  booleanValue?: boolean | null;
  numberValue?: number | null;
  dateValue?: string | null;
  dateTimeValue?: string | null;
  elementReference?: string | null;
  formulaExpression?: string | null;
  formulaDataType?: string | null;
  apexValue?: unknown;
  sobjectValue?: unknown;
  [key: string]: unknown;
}

export interface FlowRuleCondition {
  leftValueReference?: string | null;
  /** Observed: 'EqualTo' | 'GreaterThan'; docs add NotEqualTo, LessThan, …  */
  operator?: string | null;
  rightValue?: FlowElementValue | null;
  [key: string]: unknown;
}

export interface FlowDecisionRule {
  name?: string | null;
  label?: string | null;
  /** Observed: advanced logic string '(1 OR 2) AND 3'; also 'and' | 'or'. */
  conditionLogic?: string | null;
  conditions?: FlowRuleCondition[] | null;
  connector?: FlowConnector | null;
  doesRequireRecordChangedToMeetCriteria?: boolean | null;
  [key: string]: unknown;
}

export interface FlowDecisionElement {
  name?: string | null;
  label?: string | null;
  rules?: FlowDecisionRule[] | null;
  defaultConnector?: FlowConnector | null;
  defaultConnectorLabel?: string | null;
  [key: string]: unknown;
}

export interface FlowAssignmentItem {
  /** Observed both '$Record.Field__c' and a bare variable name. */
  assignToReference?: string | null;
  /** Observed: 'Assign'; docs add Add, Subtract, AddItem, RemoveFirst, …  */
  operator?: string | null;
  value?: FlowElementValue | null;
  [key: string]: unknown;
}

export interface FlowAssignmentElement {
  name?: string | null;
  label?: string | null;
  assignmentItems?: FlowAssignmentItem[] | null;
  /** Null on terminal elements (verified). */
  connector?: FlowConnector | null;
  [key: string]: unknown;
}

export interface FlowRecordFilterItem {
  field?: string | null;
  operator?: string | null;
  value?: FlowElementValue | null;
  [key: string]: unknown;
}

export interface FlowInputFieldAssignment {
  field?: string | null;
  value?: FlowElementValue | null;
  [key: string]: unknown;
}

export interface FlowRecordLookupElement {
  name?: string | null;
  label?: string | null;
  object?: string | null;
  filters?: FlowRecordFilterItem[] | null;
  filterLogic?: string | null;
  sortField?: string | null;
  sortOrder?: string | null;
  getFirstRecordOnly?: boolean | null;
  storeOutputAutomatically?: boolean | null;
  outputReference?: string | null;
  queriedFields?: string[] | null;
  connector?: FlowConnector | null;
  faultConnector?: FlowConnector | null;
  [key: string]: unknown;
}

export interface FlowRecordUpdateElement {
  name?: string | null;
  label?: string | null;
  object?: string | null;
  inputReference?: string | null;
  filters?: FlowRecordFilterItem[] | null;
  filterLogic?: string | null;
  inputAssignments?: FlowInputFieldAssignment[] | null;
  connector?: FlowConnector | null;
  faultConnector?: FlowConnector | null;
  [key: string]: unknown;
}

export interface FlowRecordCreateElement {
  name?: string | null;
  label?: string | null;
  object?: string | null;
  inputAssignments?: FlowInputFieldAssignment[] | null;
  inputReference?: string | null;
  assignRecordIdToReference?: string | null;
  storeOutputAutomatically?: boolean | null;
  connector?: FlowConnector | null;
  faultConnector?: FlowConnector | null;
  [key: string]: unknown;
}

export interface FlowRecordDeleteElement {
  name?: string | null;
  label?: string | null;
  object?: string | null;
  inputReference?: string | null;
  filters?: FlowRecordFilterItem[] | null;
  filterLogic?: string | null;
  connector?: FlowConnector | null;
  faultConnector?: FlowConnector | null;
  [key: string]: unknown;
}

export interface FlowLoopElement {
  name?: string | null;
  label?: string | null;
  collectionReference?: string | null;
  iterationOrder?: string | null;
  nextValueConnector?: FlowConnector | null;
  noMoreValuesConnector?: FlowConnector | null;
  [key: string]: unknown;
}

export interface FlowScheduledPath {
  name?: string | null;
  label?: string | null;
  offsetNumber?: number | string | null;
  offsetUnit?: string | null;
  recordField?: string | null;
  timeSource?: string | null;
  connector?: FlowConnector | null;
  [key: string]: unknown;
}

export interface FlowWaitElement {
  name?: string | null;
  label?: string | null;
  waitEvents?: unknown[] | null;
  defaultConnector?: FlowConnector | null;
  faultConnector?: FlowConnector | null;
  [key: string]: unknown;
}

export interface FlowStartElement {
  object?: string | null;
  /** Verified: 'RecordBeforeSave'; docs add RecordAfterSave, Scheduled,
   *  PlatformEvent, RecordBeforeDelete, DataCloudDataChange, Segment, …  */
  triggerType?: string | null;
  /** Verified: 'Create'; docs add Update, CreateAndUpdate, Delete. */
  recordTriggerType?: string | null;
  connector?: FlowConnector | null;
  scheduledPaths?: FlowScheduledPath[] | null;
  schedule?: {
    startDate?: string | null;
    startTime?: string | null;
    frequency?: string | null;
    [key: string]: unknown;
  } | null;
  filters?: FlowRecordFilterItem[] | null;
  filterLogic?: string | null;
  filterFormula?: string | null;
  doesRequireRecordChangedToMeetCriteria?: boolean | null;
  [key: string]: unknown;
}

export interface FlowActionCallElement {
  name?: string | null;
  label?: string | null;
  actionName?: string | null;
  /** e.g. emailSimple | emailAlert | chatterPost | customNotificationAction |
   *  apex — UNVERIFIED (fixture org has no actionCalls). */
  actionType?: string | null;
  inputParameters?: Array<{
    name?: string | null;
    value?: FlowElementValue | null;
    [key: string]: unknown;
  }> | null;
  connector?: FlowConnector | null;
  faultConnector?: FlowConnector | null;
  [key: string]: unknown;
}

export interface FlowVariableElement {
  name?: string | null;
  dataType?: string | null; // 'Boolean' | 'SObject' | 'String' | 'Number' | …
  objectType?: string | null;
  isCollection?: boolean | null;
  isInput?: boolean | null;
  isOutput?: boolean | null;
  value?: FlowElementValue | null;
  [key: string]: unknown;
}

export interface FlowFormulaElement {
  name?: string | null;
  dataType?: string | null;
  expression?: string | null;
  scale?: number | null;
  [key: string]: unknown;
}

export interface FlowTextTemplateElement {
  name?: string | null;
  text?: string | null;
  isViewedAsPlainText?: boolean | null;
  [key: string]: unknown;
}

export interface FlowConstantElement {
  name?: string | null;
  dataType?: string | null;
  value?: FlowElementValue | null;
  [key: string]: unknown;
}

export interface FlowMetadata {
  label?: string | null;
  description?: string | null;
  /** Verified: 'AutoLaunchedFlow' | 'TransactionSecurityFlow'; docs add Flow
   *  (screen flow), Workflow/CustomEvent/InvocableProcess (Process Builder),
   *  Orchestrator, …  */
  processType?: string | null;
  status?: string | null; // Verified 'Active' | 'Draft'; docs add Obsolete | InvalidDraft
  apiVersion?: number | null; // null on legacy flows (verified)
  /** Null on pre-v49 flows, which use startElementReference instead (verified). */
  start?: FlowStartElement | null;
  startElementReference?: string | null;
  actionCalls?: FlowActionCallElement[] | null;
  assignments?: FlowAssignmentElement[] | null;
  decisions?: FlowDecisionElement[] | null;
  loops?: FlowLoopElement[] | null;
  recordCreates?: FlowRecordCreateElement[] | null;
  recordDeletes?: FlowRecordDeleteElement[] | null;
  recordLookups?: FlowRecordLookupElement[] | null;
  recordUpdates?: FlowRecordUpdateElement[] | null;
  waits?: FlowWaitElement[] | null;
  screens?: unknown[] | null;
  subflows?: unknown[] | null;
  apexPluginCalls?: unknown[] | null;
  transforms?: unknown[] | null;
  orchestratedStages?: unknown[] | null;
  collectionProcessors?: unknown[] | null;
  customErrors?: unknown[] | null;
  steps?: unknown[] | null;
  variables?: FlowVariableElement[] | null;
  formulas?: FlowFormulaElement[] | null;
  constants?: FlowConstantElement[] | null;
  textTemplates?: FlowTextTemplateElement[] | null;
  triggerOrder?: number | null;
  runInMode?: string | null;
  [key: string]: unknown;
}

export interface FlowVersionRecord {
  Id: string;
  FullName: string;
  Metadata: FlowMetadata;
}

/** Generic single-row Tooling metadata fetch result (WorkflowRule & friends).
 *  FullName is object-qualified, e.g. 'Case.ChangePriorityToHigh' (verified). */
export interface ToolingMetadataRecord<M> {
  Id: string;
  FullName: string;
  Metadata: M;
}

export interface WorkflowRuleListItem {
  Id: string;
  Name: string;
  TableEnumOrId: string;
}

/** UNVERIFIED against a live org (fixture has zero WorkflowRules) — shape from
 *  the Metadata API WorkflowRule docs; treat every field as possibly absent. */
export interface WorkflowRuleMetadata {
  fullName?: string | null;
  active?: boolean | null;
  /** onCreateOnly | onAllChanges | onCreateOrTriggeringUpdate */
  triggerType?: string | null;
  booleanFilter?: string | null;
  criteriaItems?: Array<{
    field?: string | null;
    operation?: string | null;
    value?: string | null;
    [key: string]: unknown;
  }> | null;
  formula?: string | null;
  description?: string | null;
  /** action type: FieldUpdate | Alert | Task | OutboundMessage; name is the
   *  action DeveloperName — resolve to an Id via a list query before fetching
   *  its Metadata (single-row restriction). */
  actions?: Array<{ name?: string | null; type?: string | null; [key: string]: unknown }> | null;
  workflowTimeTriggers?: Array<{
    offsetFromField?: string | null;
    timeLength?: string | null;
    workflowTimeTriggerUnit?: string | null;
    actions?: Array<{ name?: string | null; type?: string | null; [key: string]: unknown }> | null;
    [key: string]: unknown;
  }> | null;
  [key: string]: unknown;
}

/** Verified on a real record (Case.ChangePriorityToHigh, operation 'Literal'). */
export interface WorkflowFieldUpdateMetadata {
  name?: string | null;
  field?: string | null;
  /** Verified: 'Literal'; docs add Formula | LookupValue | NextValue |
   *  PreviousValue | Null. */
  operation?: string | null;
  literalValue?: string | null;
  formula?: string | null;
  lookupValue?: string | null;
  lookupValueType?: string | null;
  targetObject?: string | null;
  notifyAssignee?: boolean | null;
  reevaluateOnChange?: boolean | null;
  protected?: boolean | null;
  description?: string | null;
  [key: string]: unknown;
}

/** UNVERIFIED against a live org (fixture has zero WorkflowAlerts). */
export interface WorkflowAlertMetadata {
  description?: string | null;
  senderType?: string | null;
  senderAddress?: string | null;
  template?: string | null;
  ccEmails?: string[] | null;
  recipients?: Array<{
    type?: string | null;
    recipient?: string | null;
    field?: string | null;
    [key: string]: unknown;
  }> | null;
  protected?: boolean | null;
  [key: string]: unknown;
}

/** UNVERIFIED against a live org (fixture has zero WorkflowTasks). */
export interface WorkflowTaskMetadata {
  subject?: string | null;
  status?: string | null;
  priority?: string | null;
  assignedTo?: string | null;
  assignedToType?: string | null;
  dueDateOffset?: number | null;
  offsetFromField?: string | null;
  notifyAssignee?: boolean | null;
  description?: string | null;
  protected?: boolean | null;
  [key: string]: unknown;
}

export interface ApexTriggerListItem {
  Id: string;
  Name: string;
  TableEnumOrId: string;
  Status: string; // Verified 'Active'; docs add 'Inactive' | 'Deleted'
}

/** Ids get interpolated into SOQL string literals; reject anything that is
 *  not a bare 15/18-char Salesforce id so a bad input can't widen the
 *  single-row Metadata query. */
function sanitizeSfId(id: string): string {
  if (!/^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/.test(id)) {
    throw new SalesforceError(400, `not a Salesforce id: ${id}`);
  }
  return id;
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

  /* ── Writes (the write-back sync path — everything else here is read-only;
        callers gate these behind the per-org writebackEnabled toggle) ────── */

  /** Create one record. Returns the new Salesforce id. */
  async createRecord(sobject: string, fields: Record<string, unknown>): Promise<string> {
    const res = await this.request(`/services/data/${this.apiVersion}/sobjects/${sobject}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    const body = (await res.json()) as { id?: string; success?: boolean };
    if (!body.id) throw new SalesforceError(500, `create ${sobject}: no id in response`);
    return body.id;
  }

  /** Patch specific fields on one record (204 on success). */
  async updateRecord(sobject: string, id: string, fields: Record<string, unknown>): Promise<void> {
    await this.request(`/services/data/${this.apiVersion}/sobjects/${sobject}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
  }

  /* ── Analytics (reports + dashboards) ─────────────────────────────────── */

  /** All reports the connected user can see, most recently modified first.
   *  SOQL on the Report sobject — the Analytics list endpoint only surfaces
   *  ~200 recently-viewed reports. */
  async listReports(limit = 200): Promise<ReportListItem[]> {
    const soql = `SELECT Id, Name, DeveloperName, FolderName, Format FROM Report ORDER BY LastModifiedDate DESC LIMIT ${Math.floor(limit)}`;
    return (await this.query<ReportListItem>(soql)).records;
  }

  /** All dashboards the connected user can see, most recently modified first. */
  async listDashboards(limit = 200): Promise<DashboardListItem[]> {
    const soql = `SELECT Id, Title, DeveloperName, FolderName FROM Dashboard ORDER BY LastModifiedDate DESC LIMIT ${Math.floor(limit)}`;
    return (await this.query<DashboardListItem>(soql)).records;
  }

  /** Report metadata (groupings, aggregates, filters, chart) without rows. */
  async getReportDescribe(id: string): Promise<ReportDescribeResult> {
    return (
      await this.request(`${this.base()}/analytics/reports/${id}/describe`)
    ).json() as Promise<ReportDescribeResult>;
  }

  /** Dashboard metadata (components + layout). */
  async getDashboardDescribe(id: string): Promise<DashboardDescribeResult> {
    return (
      await this.request(`${this.base()}/analytics/dashboards/${id}/describe`)
    ).json() as Promise<DashboardDescribeResult>;
  }

  /* ── Automation metadata (Tooling API) ────────────────────────────────── */

  /** Flow inventory. Fetch version bodies one at a time via getFlowVersion —
   *  the Metadata column is restricted to single-row queries. */
  async listFlowDefinitions(limit = 200): Promise<FlowDefinitionListItem[]> {
    const soql = `SELECT Id, DeveloperName, ActiveVersionId, LatestVersionId FROM FlowDefinition ORDER BY DeveloperName LIMIT ${Math.floor(limit)}`;
    return (await this.toolingQuery<FlowDefinitionListItem>(soql)).records;
  }

  /** One Flow version (301…) with its full Metadata body. Payloads can be
   *  large — callers cap how many versions they pull. */
  async getFlowVersion(id: string): Promise<FlowVersionRecord | null> {
    const soql = `SELECT Id, FullName, Metadata FROM Flow WHERE Id = '${sanitizeSfId(id)}'`;
    return (await this.toolingQuery<FlowVersionRecord>(soql)).records[0] ?? null;
  }

  async listWorkflowRules(limit = 200): Promise<WorkflowRuleListItem[]> {
    const soql = `SELECT Id, Name, TableEnumOrId FROM WorkflowRule ORDER BY Name LIMIT ${Math.floor(limit)}`;
    return (await this.toolingQuery<WorkflowRuleListItem>(soql)).records;
  }

  async getWorkflowRuleMetadata(
    id: string,
  ): Promise<ToolingMetadataRecord<WorkflowRuleMetadata> | null> {
    const soql = `SELECT Id, FullName, Metadata FROM WorkflowRule WHERE Id = '${sanitizeSfId(id)}'`;
    return (
      (await this.toolingQuery<ToolingMetadataRecord<WorkflowRuleMetadata>>(soql)).records[0] ??
      null
    );
  }

  async getWorkflowFieldUpdate(
    id: string,
  ): Promise<ToolingMetadataRecord<WorkflowFieldUpdateMetadata> | null> {
    const soql = `SELECT Id, FullName, Metadata FROM WorkflowFieldUpdate WHERE Id = '${sanitizeSfId(id)}'`;
    return (
      (await this.toolingQuery<ToolingMetadataRecord<WorkflowFieldUpdateMetadata>>(soql))
        .records[0] ?? null
    );
  }

  async getWorkflowAlert(id: string): Promise<ToolingMetadataRecord<WorkflowAlertMetadata> | null> {
    const soql = `SELECT Id, FullName, Metadata FROM WorkflowAlert WHERE Id = '${sanitizeSfId(id)}'`;
    return (
      (await this.toolingQuery<ToolingMetadataRecord<WorkflowAlertMetadata>>(soql)).records[0] ??
      null
    );
  }

  async getWorkflowTask(id: string): Promise<ToolingMetadataRecord<WorkflowTaskMetadata> | null> {
    const soql = `SELECT Id, FullName, Metadata FROM WorkflowTask WHERE Id = '${sanitizeSfId(id)}'`;
    return (
      (await this.toolingQuery<ToolingMetadataRecord<WorkflowTaskMetadata>>(soql)).records[0] ??
      null
    );
  }

  async listApexTriggers(limit = 200): Promise<ApexTriggerListItem[]> {
    const soql = `SELECT Id, Name, TableEnumOrId, Status FROM ApexTrigger ORDER BY Name LIMIT ${Math.floor(limit)}`;
    return (await this.toolingQuery<ApexTriggerListItem>(soql)).records;
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
