#!/usr/bin/env bash
# scripts/setup-hydradb-wsl.sh
# Run this inside WSL2 Ubuntu to install HydraDB build deps and start the server.
# Usage: bash scripts/setup-hydradb-wsl.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HYDRA_DIR="$REPO_DIR/hydradb-core"
DATA_DIR="$REPO_DIR/.hydradb"

echo "==> [1/6] Installing system dependencies..."
sudo apt-get update -qq
sudo apt-get install -y \
  build-essential clang libclang-dev cmake pkg-config \
  libcypher-parser-dev libgraphblas-dev \
  curl git python3 python3-venv just

echo "==> [2/6] Installing Rust via rustup (if not present)..."
if ! command -v rustup &>/dev/null; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path
fi
source "$HOME/.cargo/env"
rustup toolchain install stable
echo "Rust: $(rustc --version)"

echo "==> [3/6] Cloning HydraDB (if not already present)..."
if [ ! -d "$HYDRA_DIR" ]; then
  git clone https://github.com/hydra-db/hydradb.git "$HYDRA_DIR"
fi

cd "$HYDRA_DIR"

echo "==> [4/6] Running native-check..."
just native-check

echo "==> [5/6] Running smoke test..."
just smoke
echo "smoke: PASSED"

echo "==> [6/6] Creating data dirs and auth token..."
mkdir -p "$DATA_DIR/store" "$DATA_DIR/cache"
if [ ! -f "$DATA_DIR/auth-token" ]; then
  printf '%s\n' 'local-development-token-32-bytes' > "$DATA_DIR/auth-token"
fi

echo ""
echo "============================================================"
echo "  HydraDB smoke passed. Run 'bash scripts/start-hydradb.sh'"
echo "  in a SEPARATE terminal to start the server."
echo "============================================================"
