#!/usr/bin/env bash
# scripts/setup-hydradb-wsl.sh
# Complete WSL2 setup for blast-radius HydraDB environment.
# Run ONCE on a fresh Ubuntu WSL2 instance.
#
# After this succeeds, use scripts/start-hydradb.sh to start the server.
set -euo pipefail
export PATH="/usr/local/bin:/usr/bin:/usr/sbin:/bin:/sbin:$HOME/.cargo/bin:$PATH"

PROJ="/mnt/d/Downloads/HydraDB"
HYDRA_DIR="$PROJ/hydradb-core"
DATA_DIR="$PROJ/.hydradb"

echo "================================================"
echo " blast-radius — HydraDB WSL2 Setup"
echo "================================================"
echo ""

# ── Step 1: System dependencies ──────────────────────────────────────────────
echo "==> [1/6] Installing system packages..."
sudo apt-get update -qq
sudo apt-get install -y \
  build-essential clang libclang-dev cmake pkg-config \
  libcypher-parser-dev \
  curl git 2>&1 | tail -5

# Remove Ubuntu's outdated GraphBLAS (6.x) — HydraDB needs 9.x+
sudo apt-get remove -y libgraphblas-dev libgraphblas6 2>/dev/null || true
echo "System packages: OK"

# ── Step 2: Rust ─────────────────────────────────────────────────────────────
echo ""
echo "==> [2/6] Installing Rust..."
if ! command -v rustup &>/dev/null; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path
fi
source ~/.cargo/env
rustup toolchain install stable
echo "Rust: $(rustc --version)"

# ── Step 3: just ─────────────────────────────────────────────────────────────
echo ""
echo "==> [3/6] Installing just..."
if ! command -v just &>/dev/null; then
  cargo install just --locked
fi
echo "just: $(just --version)"

# ── Step 4: SuiteSparse GraphBLAS 9.x from source ────────────────────────────
echo ""
echo "==> [4/6] Building SuiteSparse:GraphBLAS from source..."
echo "    (Ubuntu apt has v6.1.4 — HydraDB requires v9+)"
GRAPHBLAS_BUILT=false
if pkg-config --modversion GraphBLAS 2>/dev/null | grep -qE '^(9|10)\.'; then
  echo "    GraphBLAS 9.x/10.x already installed"
  GRAPHBLAS_BUILT=true
fi

if [ "$GRAPHBLAS_BUILT" = "false" ]; then
  BUILD_DIR="/tmp/suitesparse-build"
  mkdir -p "$BUILD_DIR"
  cd "$BUILD_DIR"
  if [ ! -d "SuiteSparse" ]; then
    git clone --depth=1 --branch "v7.10.0" https://github.com/DrTimothyAldenDavis/SuiteSparse.git
  fi
  cd "$BUILD_DIR/SuiteSparse/GraphBLAS"
  cmake -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/usr/local \
    -DSUITESPARSE_USE_OPENMP=OFF 2>&1 | tail -3
  cmake --build build --parallel "$(nproc)" 2>&1 | tail -3
  sudo cmake --install build 2>&1 | tail -3
  echo "/usr/local/lib" | sudo tee /etc/ld.so.conf.d/graphblas-local.conf
  sudo ldconfig
fi

# Remove old apt library (may still interfere with linker even after removal)
sudo apt-get remove -y libgraphblas-dev libgraphblas6 2>/dev/null || true
sudo ldconfig

echo "GraphBLAS: $(pkg-config --modversion GraphBLAS)"
echo "GraphBLAS: OK"

# ── Step 5: Clone HydraDB + smoke ────────────────────────────────────────────
echo ""
echo "==> [5/6] Cloning HydraDB and running smoke test..."
cd "$PROJ"
if [ ! -d "$HYDRA_DIR" ]; then
  git clone https://github.com/hydra-db/hydradb.git "$HYDRA_DIR"
fi
cd "$HYDRA_DIR"

export LIBRARY_PATH="/usr/local/lib:${LIBRARY_PATH:-}"
export PKG_CONFIG_PATH="/usr/local/lib/pkgconfig:${PKG_CONFIG_PATH:-}"

just native-check
echo "native-check: PASSED"

just smoke
echo "smoke: PASSED"

# ── Step 6: Data directories ──────────────────────────────────────────────────
echo ""
echo "==> [6/6] Creating data directories..."
mkdir -p "$DATA_DIR/store" "$DATA_DIR/cache"
printf '%s\n' 'local-development-token-32-bytes' > "$DATA_DIR/auth-token"

echo ""
echo "================================================"
echo " Setup complete!"
echo ""
echo " Next steps:"
echo "   Terminal 1 (WSL2):"
echo "     bash $PROJ/scripts/start-hydradb.sh"
echo ""
echo "   Terminal 2 (WSL2):"
echo "     bash $PROJ/scripts/verify-hydradb.sh"
echo ""
echo "   Terminal 3 (Windows/WSL2):"
echo "     cd $PROJ/ingest && node ingest.js"
echo "     cd $PROJ && bash start.sh"
echo "================================================"
