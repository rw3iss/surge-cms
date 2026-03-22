#!/usr/bin/env bash
# pre-push-check.sh — Lint and build before pushing.
# Install as git hook: ln -sf ../../scripts/pre-push-check.sh .git/hooks/pre-push

set -e

# Resolve symlink to find actual script location
SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
if [ -L "$SCRIPT_PATH" ]; then
  SCRIPT_PATH="$(readlink -f "$SCRIPT_PATH" 2>/dev/null || readlink "$SCRIPT_PATH")"
fi
PROJECT_ROOT="$(cd "$(dirname "$SCRIPT_PATH")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "=== Pre-push: lint & build check ==="

# Lint with oxlint (fast, Rust-based)
echo "--- oxlint ---"
if command -v npx &> /dev/null; then
  npx oxlint@latest --quiet 2>/dev/null || {
    echo "oxlint found issues (non-blocking)"
  }
fi

# Type-check and build
echo "--- build shared ---"
npm run build -w shared

echo "--- build backend ---"
npm run build -w backend

echo "--- build frontend ---"
npm run build -w frontend

echo "=== Pre-push checks passed ==="
