# sf-fixture — Salesforce scratch org for migration testing

A realistic Salesforce org (SFDX project) used to validate Northbeam's one-click
migration pipeline: **describe → auto-map (`apps/api/src/salesforce/mapper.ts`) →
import (`apps/api/src/salesforce/import.ts`)**. Everything here is deployable
metadata + seed data; nothing touches the Northbeam app code.

## Prerequisite (manual, once): a Dev Hub

Scratch orgs are minted from a Dev Hub. Either:

1. Sign up for a **free Developer Edition** at <https://developer.salesforce.com/signup>,
   then in that org: **Setup → Dev Hub → Enable Dev Hub**; or
2. use an existing production org with Dev Hub enabled.

Then authorize it locally:

```sh
sf org login web --set-default-dev-hub --alias devhub
```

## One command

```sh
./setup.sh
```

Creates scratch org `nb-fixture` (30 days), deploys all metadata, assigns the
`Northbeam_Fixture` permission set, creates two Standard User fixture users,
tree-imports 10 Accounts / 20 Contacts, and seeds ~150 `Property__c` +
~400 `Lease__c` via anonymous Apex. Finally it prints the instance URL and the
exact command to hand the org's CLI token to Northbeam:

```sh
pnpm --filter @northbeam/api sf:dev-connect <northbeamOrgId> nb-fixture
```

(That script — `apps/api/scripts/sf-dev-connect.ts` — reads the access token
from `sf org display` and upserts a `salesforceConnection` row. It needs
`SF_TOKEN_KEY` in the API env, and CLI tokens are short-lived — re-run on expiry.)

## What's in the org

| Feature | Where | Why it's here |
| --- | --- | --- |
| Custom object `Property__c` | `force-app/.../objects/Property__c` | 21 fields covering nearly every SF type in `SF_TYPE_MAP` |
| Custom object `Lease__c` | `force-app/.../objects/Lease__c` | Master-detail child + Contact lookup + AutoNumber Name |
| Text / LongTextArea / Email / Phone / Url | `Insurance_Policy_Number__c`, `Description__c`, `Manager_Email__c`, `Office_Phone__c`, `Listing_URL__c` | 1:1 type mappings |
| Number / Currency / Percent / Date / DateTime / Checkbox | `Square_Feet__c`, `Purchase_Price__c`, `Occupancy_Rate__c`, `Listed_Date__c`, `Last_Inspection__c`, `Is_Furnished__c` | scale/precision carried into `config` |
| Restricted picklist | `Property__c.Status__c` | `restrictToOptions: true` path |
| Global value set | `globalValueSets/Regions` → `Property__c.Region__c` | describe still inlines the values; mapper sees a normal picklist |
| Multi-select picklist | `Property__c.Amenities__c` | `multipicklist` mapping |
| Transpilable formula | `Valuation__c` = `Purchase_Price__c * 1.25 + Square_Feet__c * 15` | exercises the SF→NB formula transpiler happy path |
| Unsupported-function formula | `Listing_Link__c` = `HYPERLINK(...)` | HYPERLINK is outside the engine's function set → review |
| Cross-object formula | `Lease__c.Effective_Annual_Rent__c` references `Property__r.Occupancy_Rate__c` | cross-object dot-paths are v1-unsupported → review |
| AutoNumber | `Property__c.Property_Code__c` (PROP-{00000}), `Lease__c` Name (LEASE-{00000}) | describe reports them as `string` + `autoNumber: true` |
| Rollup summaries | `Total_Monthly_Rent__c` (SUM), `Lease_Count__c` (COUNT) | describe reports `calculated: true` with no formula |
| Record types | `Residential` / `Commercial` with Status + Region value assignments | `recordTypeInfos` → `ProposedRecordType[]` |
| Validation rule (active) | `Lease__c.End_After_Start` | org-behavior realism (seed data respects it) |
| Apex trigger + handler + test | `LeaseTrigger`, `LeaseTriggerHandler(Test)` | defaults `Status__c`, stamps `Last_Handler_Run__c` |
| Record-triggered flow (active, before-save) | `flows/Property_Flow_Stamp` | stamps `Flow_Stamp__c` on create |
| Custom field on a standard object | `Account.Property_Portfolio_Size__c` | standard-object custom-field path (Account maps to NB's `account`) |
| Permission set | `Northbeam_Fixture` | full CRUD + FLS on both custom objects |
| Users | `config/user-alpha.json` / `user-beta.json` | multi-user org for owner-mapping tests |
| Customized org settings | `config/project-scratch-def.json` | LEX enabled, 12-hour session timeout, flows deploy as active |
| Sparse fields | `Insurance_Policy_Number__c`, `Solar_Score__c` — **never populated** | populated-% skip heuristic |

Seed-data population is deliberately uneven (80/70/60/50/40/30% bands — see the
header of `scripts/apex/seed.apex`) so the mapper's sampled `populatedPct` is
meaningful. Note the importer samples/imports at most 100 records per object
(`MAX_RECORDS_PER_OBJECT`), so seeding 150/400 also exercises the cap.

## Expected Northbeam auto-map outcome

Based on `mapper.ts` + `transpile.ts` (default 1% populated threshold, import
set = {Property__c, Lease__c, Account, Contact}):

**Mapped (imports cleanly)**

- `Property__c` → new object `property`: Name, Description, Square_Feet,
  Purchase_Price, Occupancy_Rate, Listed_Date, Last_Inspection, Is_Furnished,
  Manager_Email, Office_Phone, Listing_URL, Status (restricted picklist),
  Region (picklist — GVS values inlined by describe), Amenities (multipicklist),
  Property_Code (autonumber → `text`), Flow_Stamp, and **Valuation__c** (formula
  transpiles: same-object refs + arithmetic only).
- `Lease__c` → new object `lease`: Name (autonumber → `text`), Property
  (reference — target in import set), Tenant (reference → standard `contact`),
  Monthly_Rent, Deposit, Start_Date, End_Date, Status, Last_Handler_Run.
- `Account` → mapped onto NB's standard `account`, including
  `Property_Portfolio_Size__c` (populated on 6/10 accounts → well above threshold).
- Record types Residential/Commercial → `record_type` rows.

**Review (flagged, needs a human)**

- `Property__c.Listing_Link__c` — `HYPERLINK()` is not in the NB formula engine →
  "formula needs review: function HYPERLINK()".
- `Lease__c.Effective_Annual_Rent__c` — cross-object path
  `Property__r.Occupancy_Rate__c` can't resolve in v1 → review.
- `Property__c.Total_Monthly_Rent__c` / `Lease_Count__c` — rollup summaries
  describe as `calculated: true` with **no** `calculatedFormula` → transpile
  fails ("empty formula") → review. (NB has a native `rollup` type; re-creating
  them post-import is the manual step.)

**Skip (correctly dropped)**

- `Insurance_Policy_Number__c`, `Solar_Score__c` — 0% populated custom fields
  (below the populated threshold).
- System fields on every object (Id, OwnerId, CreatedDate, …) — mapped to
  system columns instead.
- `OwnerId`-style User lookups — owner mapping is handled separately by email
  (the two fixture users exercise this).
- Validation rule, trigger, flow, permission set — **behavioral metadata is not
  part of the describe→map pipeline at all**; it exists here so the fixture is a
  realistic org, and so future "we noticed automation on this object" surfaces
  have something to detect.

## Deploy-confidence notes

Everything was authored against Metadata API v62.0 conventions but has **not**
been deploy-verified (no Dev Hub was available when this fixture was written).
The pieces most worth watching on first deploy, in order of risk:

1. **`flows/Property_Flow_Stamp.flow-meta.xml`** — Flow XML is the fussiest
   metadata type. It's a minimal before-save record-triggered flow; if it's
   rejected, the fastest fix is rebuilding it once in Flow Builder and pulling
   the source back. `flowSettings.enableFlowDeployAsActiveEnabled` in the
   scratch def is required for the `<status>Active</status>` deploy.
2. **Rollup summary fields** — authored without `precision`/`scale` (Summary
   fields derive them); if the deploy complains, add `<precision>18</precision>`
   / `<scale>2</scale>` to `Total_Monthly_Rent__c`.
3. **Record-type picklist assignments for the GVS-backed `Region__c`** — record
   types can subset global-value-set picklists, but if the deploy rejects it,
   drop the `Region__c` block from the two record types (Status coverage is
   enough for the mapper test).
4. **`securitySettings.sessionSettings.sessionTimeout`** — documented scratch
   def setting; if the org create rejects it, delete that block and re-run.

Re-running: `sf org delete scratch -o nb-fixture -p` then `./setup.sh` for a
clean slate; or re-run only `sf apex run -f scripts/apex/seed.apex -o nb-fixture`
to refresh records (the seed wipes Property/Lease first).
