#!/usr/bin/env bash
# scripts/start-hydradb.sh
# Start HydraDB graph-node server.
# Run in its own dedicated terminal — it holds the foreground.
# Prerequisite: run setup-hydradb-wsl.sh first (just smoke must pass).
set -euo pipefail

export PATH="/usr/bin:/usr/sbin:/bin:/sbin:$HOME/.cargo/bin:$PATH"
source ~/.cargo/env

PROJ="/mnt/d/Downloads/HydraDB"
HYDRA_DIR="$PROJ/hydradb-core"
DATA_DIR="$PROJ/.hydradb"

# Create data dirs and auth token if missing
mkdir -p "$DATA_DIR/store" "$DATA_DIR/cache"
if [ ! -f "$DATA_DIR/auth-token" ]; then
  printf '%s\n' 'local-development-token-32-bytes' > "$DATA_DIR/auth-token"
fi

cd "$HYDRA_DIR"

export CLOUD_PROVIDER=local
export LOCAL_PATH="$DATA_DIR/store"
export GRAPH_NAMESPACE=default
export GRAPH_ID=default
export GRAPH_CELL_ID=cell-0
export GRAPH_CELLS=cell-0
export GRAPH_NODE_ID=node-0
export GRAPH_BOLT_NODE_ADDRESSES="node-0=127.0.0.1:7687"
export GRAPH_ADVERTISED_BOLT_ADDR="127.0.0.1:7687"
export GRAPH_DATA_CACHE_DIR="$DATA_DIR/cache"
export GRAPH_AUTH_TOKEN_FILE="$DATA_DIR/auth-token"
export GRAPH_ALLOW_PLAINTEXT=true
export RUST_MIN_STACK=33554432

echo "=========================================="
echo " blast-radius — HydraDB graph-node"
echo "=========================================="
echo " Bolt:  bolt://127.0.0.1:7687"
echo " HTTP:  http://127.0.0.1:8443"
echo " Admin: http://127.0.0.1:9090"
echo ""
echo " Verify alive (other terminal):"
echo "   bash scripts/verify-hydradb.sh"
echo "=========================================="
echo ""

cargo run --locked --features server-runtime --bin graph-node
