#!/usr/bin/env bash
# deploy.sh — Pull latest code, build, migrate, and restart the Surge backend.
# Usage: cd /path/to/surge && bash scripts/deploy.sh

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "=== Surge Deploy ==="
echo "Directory: $PROJECT_ROOT"
echo "Date: $(date)"

# ── 1. Pull latest code ──
echo ""
echo "--- git pull ---"
git pull --ff-only || git pull

# ── 2. Install dependencies ──
echo ""
echo "--- npm install ---"
npm ci --omit=dev 2>/dev/null || npm install --omit=dev

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

# Check if pm2 process exists
if pm2 describe surge-backend > /dev/null 2>&1; then
  pm2 restart surge-backend
  echo "PM2 process 'surge-backend' restarted."
else
  # Start new pm2 process
  cd "$PROJECT_ROOT/backend"
  NODE_ENV=production pm2 start dist/index.js \
    --name surge-backend \
    --cwd "$PROJECT_ROOT/backend" \
    --env production \
    --max-memory-restart 512M \
    --time
  cd "$PROJECT_ROOT"
  echo "PM2 process 'surge-backend' started."
fi

pm2 save 2>/dev/null || true

# ── 6. Verify ──
echo ""
sleep 3
if pm2 describe surge-backend 2>/dev/null | grep -q "online"; then
  echo "=== Deploy complete — backend is online ==="
else
  echo "WARNING: Backend may not be running. Check: pm2 logs surge-backend"
  pm2 logs surge-backend --lines 15 --nostream 2>/dev/null || true
  exit 1
fi
