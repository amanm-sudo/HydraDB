#!/usr/bin/env bash
# scripts/verify-hydradb.sh
# Verifies HydraDB is alive by writing and reading a test edge.
# Must print: verify-ok
set -euo pipefail

TOKEN='local-development-token-32-bytes'
BASE='http://127.0.0.1:8443/v1/graphs/default/query'
HDR_AUTH="Authorization: Bearer $TOKEN"
HDR_NS='X-Graph-Namespace: default'
HDR_CT='Content-Type: application/json'

echo "Writing test edge..."
curl -sS "$BASE" \
  -H "$HDR_AUTH" -H "$HDR_NS" -H "$HDR_CT" \
  --data '{"cell_id":"cell-0","query":"CREATE (a {id: 99901})-[:TEST_EDGE]->(b {id: 99902})"}' \
  | cat

echo ""
echo "Reading back..."
RESULT=$(curl -sS "$BASE" \
  -H "$HDR_AUTH" -H "$HDR_NS" -H "$HDR_CT" \
  --data '{"cell_id":"cell-0","query":"MATCH (a {id: 99901})-[:TEST_EDGE]->(b) RETURN b.id AS id"}')

echo "Result: $RESULT"

if echo "$RESULT" | grep -q '"value":99902'; then
  echo ""
  echo "verify-ok"
else
  echo ""
  echo "ERROR: unexpected result. Expected value:99902, got: $RESULT"
  exit 1
fi
