# Northbeam Roadmap

Living document. Items are roughly ordered within each section. "Chunk N" tags refer to the phased
delivery plan in `docs/architecture-plan.md`.

## Compute layer

- **[in progress] Formula + rollup engine to Salesforce parity** — full function set, cross-object
  dot-walk, dependency ordering (topological), synchronous same-record compute in the write transaction
  + a durable worker for fan-out. The runtime engine stays Northbeam-native; all Salesforce syntax lives
  in an import-time transpiler. *(Chunk 1)*
- **Validation rules** — reuse the formula engine for the condition + error-field, enforced in the
  dynamic create/update path. Schema table planned in `docs/architecture-plan.md` §A11.
- **AI field-type compute** — the `ai` field type is declared but inert; needs an LLM worker
  (`packages/llm`, `packages/agents` are stubs today).
- **Autonumber sequences** — `autonumber` is declared but inert; needs a Postgres sequence per field
  materialized by the DDL engine.

## Real-time / live dashboards *(raised by the user)*

Dashboards must reflect updates as soon as possible rather than polling.

- **Change-event model** — a transactional outbox on record / rollup / aggregate writes that fans out to
  subscribers. The same bus carries compute-worker results so a downstream rollup change propagates.
- **Push transport** — WebSocket/SSE via `packages/realtime` (stub today); dashboards subscribe to the
  objects + rollup fields they render so KPIs update without a refetch.
- **Inbound webhook events** — Salesforce Platform Events / Change Data Capture and generic third-party
  webhooks feed the same event bus, so an external change can trigger recompute + push.

## Migration engine

- **Bulk API 2.0 (PK chunking)** — the importer uses REST `queryAll` today, which is slow and burns daily
  API limits on large objects (e.g. a 291-field Account with millions of rows).
- **Incremental / delta sync** — today is a one-shot migration, not an ongoing integration. CDC / Platform
  Events would enable keeping Northbeam in sync after the initial cutover.
- **Salesforce rollup-summary detection** — `describe` reports SF roll-up summary fields as plain numbers;
  detecting and re-creating them as native rollups needs the Tooling API.
- **Formula transpiler coverage report** — surface in the mapping review UI which formulas transpiled
  cleanly vs. landed in "needs review", with the reason.

## Security / platform breadth

- **Field-Level Security enforcement** — `FieldConfig.confidential` is declared but **not enforced** on
  read/write today. This is a table-stakes Salesforce concept and a real gap.
- **Role hierarchy** — `crm_role` (parent-child) for hierarchical record visibility (planned §A10).
- **Chatter feed, object/field history, file blobs, automation/flows, approvals** — schema is reserved for
  several of these in `docs/architecture-plan.md`; engines are future chunks.
- **Object / field / layout editor UI** — the metadata core already supports custom objects/fields, but
  admins can only create them via migration today; the in-app editors are stubs.

## Data-model hardening

- **State the tenancy ceiling as an explicit non-goal** — schema-per-org (a Postgres schema + tables per
  tenant) is excellent for mid-market B2B but is the wrong model at 100k+ self-serve tenants (catalog /
  relcache bloat). Worth writing down so it's a conscious boundary, not a surprise at scale.
- **`CREATE INDEX CONCURRENTLY` for live field-adds** — the dynamic DDL currently creates indexes
  non-concurrently, which takes a write lock on populated tables. Fine during import; risky for an admin
  adding an indexed field to a large live table.
- **Dropped-column ceiling** — Postgres counts dropped columns against the 1600-column table limit until a
  rewrite. Heavy custom-field churn can creep toward the ceiling invisibly; handle with column reuse or a
  periodic table rewrite.
- **References are app-enforced soft UUIDs**, not DB foreign keys (a deliberate import-resilience trade).
  Revisit if/when referential integrity guarantees are needed.
