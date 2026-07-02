#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Northbeam SF fixture — one-command runbook.
#
# Idempotence: NOT fully idempotent end-to-end. `sf org create scratch` makes a
# NEW org each run (delete the old one with `sf org delete scratch -o nb-fixture`),
# and re-running `sf data import tree` against an already-seeded org duplicates
# Accounts/Contacts. The Apex seed (scripts/apex/seed.apex) IS idempotent — it
# wipes Property__c/Lease__c before reseeding — so to refresh record data on an
# existing org just re-run steps 6–7 by hand.
#
# Prerequisite (manual, once): an authorized Dev Hub. Either sign up for a free
# Developer Edition at https://developer.salesforce.com/signup and enable
# Setup → Dev Hub, or use an existing production org. Then:
#   sf org login web --set-default-dev-hub --alias devhub
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"

ORG_ALIAS="nb-fixture"

step() { printf '\n\033[1;36m── %s\033[0m\n' "$*"; }

step "0/8 Checking prerequisites"
if ! command -v sf >/dev/null 2>&1; then
  echo "ERROR: the Salesforce CLI ('sf') is not installed or not on PATH." >&2
  echo "Install: npm install --global @salesforce/cli" >&2
  exit 1
fi

if ! sf config get target-dev-hub --json | grep -q '"value"[[:space:]]*:[[:space:]]*"..*"'; then
  echo "ERROR: no default Dev Hub is set." >&2
  echo "Authorize one first (free Developer Edition works — enable Setup → Dev Hub):" >&2
  echo "" >&2
  echo "    sf org login web --set-default-dev-hub --alias devhub" >&2
  echo "" >&2
  exit 1
fi

step "1/8 Creating scratch org '${ORG_ALIAS}' (30 days)"
sf org create scratch -f config/project-scratch-def.json -a "${ORG_ALIAS}" --set-default -y 30 -w 15

step "2/8 Deploying metadata (objects, fields, record types, apex, flow, permset)"
sf project deploy start -o "${ORG_ALIAS}" -w 15

step "3/8 Assigning permission set to the admin user"
sf org assign permset -n Northbeam_Fixture -o "${ORG_ALIAS}"

step "4/8 Creating fixture users (alpha, beta) — permset assigned via the def files"
sf org create user -f config/user-alpha.json -o "${ORG_ALIAS}" --set-alias nb-user-alpha
sf org create user -f config/user-beta.json -o "${ORG_ALIAS}" --set-alias nb-user-beta

step "5/8 Importing Accounts + Contacts (data tree)"
sf data import tree -p data/accounts-contacts-plan.json -o "${ORG_ALIAS}"

step "6/8 Seeding ~150 Properties + ~400 Leases (anonymous Apex)"
sf apex run -f scripts/apex/seed.apex -o "${ORG_ALIAS}"

step "7/8 Running the Apex tests (sanity)"
sf apex run test -o "${ORG_ALIAS}" --tests LeaseTriggerHandlerTest --synchronous --result-format human || {
  echo "WARN: apex tests failed — the org is still usable for migration testing." >&2
}

step "8/8 Org ready — hand it to Northbeam"
INSTANCE_URL="$(sf org display -o "${ORG_ALIAS}" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).result.instanceUrl))')"
echo ""
echo "Scratch org alias:  ${ORG_ALIAS}"
echo "Instance URL:       ${INSTANCE_URL}"
echo ""
echo "To seed a Northbeam Salesforce connection from this org's CLI token"
echo "(requires SF_TOKEN_KEY in apps/api env; token is short-lived — re-run on expiry):"
echo ""
echo "    pnpm --filter @northbeam/api sf:dev-connect <northbeamOrgId> ${ORG_ALIAS}"
echo ""
echo "Then run the migration from the Northbeam UI (describe → auto-map → import)."
