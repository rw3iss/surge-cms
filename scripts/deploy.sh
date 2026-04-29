#!/usr/bin/env bash
# deploy.sh — Pull latest code, build, migrate, and restart the RW backend.
# Usage: cd /path/to/rw && bash scripts/deploy.sh

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
cd "$PROJECT_ROOT"

# ── 0. Source nvm if available (needed for correct Node version) ──
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

echo "=== RW Deploy ==="
echo "Directory: $PROJECT_ROOT"
echo "Node: $(node --version) | npm: $(npm --version)"
echo "Date: $(date)"

# ── 1. Pull latest code ──
echo ""
echo "--- git pull ---"
git pull --ff-only || git pull

# ── 2. Install dependencies (including dev for build tools like tsc) ──
echo ""
echo "--- npm install ---"
# Clean install if tsc is missing (e.g. after --omit=dev)
if [ ! -f node_modules/.bin/tsc ]; then
  echo "tsc not found, doing clean install..."
  rm -rf node_modules
fi
npm install

# ── 3. Build all workspaces ──
echo ""
echo "--- build shared ---"
npm run build -w shared

echo "--- build backend ---"
npm run build -w backend

echo "--- build frontend ---"
npm run build -w frontend

# ── 4. Run database migrations ──
echo ""
echo "--- database migrations ---"
npm run db:migrate -w backend 2>&1 || {
  echo "WARNING: Migration may have encountered issues. Check output above."
}

# ── 5. Restart backend via pm2 ──
echo ""
echo "--- restarting backend ---"

# Ensure pm2 is available
if ! command -v pm2 &> /dev/null; then
  echo "Installing pm2..."
  npm install -g pm2
fi

# Check if pm2 process exists
if pm2 describe rw-backend > /dev/null 2>&1; then
  pm2 restart rw-backend
  echo "PM2 process 'rw-backend' restarted."
else
  # Start new pm2 process
  cd "$PROJECT_ROOT/backend"
  NODE_ENV=production pm2 start dist/index.js \
    --name rw-backend \
    --cwd "$PROJECT_ROOT/backend" \
    --env production \
    --max-memory-restart 512M \
    --time
  cd "$PROJECT_ROOT"
  echo "PM2 process 'rw-backend' started."
fi

pm2 save 2>/dev/null || true

# ── 6. Verify ──
echo ""
sleep 3
if pm2 describe rw-backend 2>/dev/null | grep -q "online"; then
  echo "=== Deploy complete — backend is online ==="
else
  echo "WARNING: Backend may not be running. Check: pm2 logs rw-backend"
  pm2 logs rw-backend --lines 15 --nostream 2>/dev/null || true
  exit 1
fi
