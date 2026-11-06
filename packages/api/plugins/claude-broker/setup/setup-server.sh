#!/usr/bin/env bash
# claude-broker plugin — one-time server setup.
#
# Run on the CMS server AS THE USER THE CMS RUNS AS (the plugin signs in and
# starts sessions as that user):
#
#     bash packages/api/plugins/claude-broker/setup/setup-server.sh
#
# Idempotent — safe to re-run. It installs what is missing:
#   1. tmux                 (sessions run in tmux; uses sudo dnf/apt)
#   2. Claude Code          (official installer → ~/.local/bin/claude)
#   3. claude-broker        (its installer → ~/.local/bin/claude-broker)
#   4. the broker daemon    (systemd USER service + linger, so it survives logout/reboot)
# and prints the broker token to paste into the plugin's config page.
# Signing in to Claude and starting sessions are then done from the admin
# (Plugins → Claude Broker → Setup); the broker daemon runs them.
set -euo pipefail

BIN="$HOME/.local/bin"
CONF_DIR="$HOME/.config/claude-broker"
ENV_FILE="$CONF_DIR/claude-broker.env"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT="$UNIT_DIR/claude-broker.service"
export PATH="$BIN:$PATH"

say() { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }
ok() { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }

say "tmux"
if command -v tmux >/dev/null 2>&1; then ok "tmux $(tmux -V)"
elif command -v dnf >/dev/null 2>&1; then sudo dnf install -y tmux
elif command -v apt-get >/dev/null 2>&1; then sudo apt-get update -y && sudo apt-get install -y tmux
else echo "Install tmux with your package manager, then re-run." >&2; exit 1; fi

say "Claude Code"
if [ -x "$BIN/claude" ] || command -v claude >/dev/null 2>&1; then ok "$(claude --version)"
else curl -fsSL https://claude.ai/install.sh | bash; ok "$("$BIN/claude" --version)"; fi

say "claude-broker (>= 0.6: manages sign-in + sessions)"
if [ -x "$BIN/claude-broker" ] || command -v claude-broker >/dev/null 2>&1; then
    CB_VERSION="$(claude-broker --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
    if [ -z "$CB_VERSION" ] || [ "$(printf '%s\n0.6.0\n' "$CB_VERSION" | sort -V | head -1)" != "0.6.0" ]; then
        say "updating claude-broker ${CB_VERSION:-?} → latest"
        claude-broker update || curl -fsSL https://raw.githubusercontent.com/rw3iss/claude-broker/main/install.sh | bash -s -- --update
    fi
    ok "claude-broker $(claude-broker --version 2>/dev/null | head -1)"
else curl -fsSL https://raw.githubusercontent.com/rw3iss/claude-broker/main/install.sh | bash; ok "claude-broker installed"; fi

say "Broker token"
mkdir -p "$CONF_DIR"
chmod 700 "$CONF_DIR"
if [ ! -f "$ENV_FILE" ] || ! grep -q '^CLAUDE_BROKER_TOKEN=' "$ENV_FILE"; then
    umask 077
    printf 'CLAUDE_BROKER_TOKEN=%s\nCLAUDE_BROKER_LOG_SESSIONS=1\n' "$(openssl rand -hex 16)" > "$ENV_FILE"
    ok "created $ENV_FILE"
else ok "kept $ENV_FILE"; fi
TOKEN="$(grep -oP '^CLAUDE_BROKER_TOKEN=\K.*' "$ENV_FILE")"

say "Broker daemon (systemd user service)"
mkdir -p "$UNIT_DIR"
cat > "$UNIT" <<UNIT
[Unit]
Description=claude-broker daemon (for the CMS claude-broker plugin)
After=network.target

[Service]
Type=simple
EnvironmentFile=$ENV_FILE
Environment=PATH=$BIN:/usr/local/bin:/usr/bin:/bin
ExecStartPre=/bin/rm -f /tmp/claude-broker.sock
ExecStart=$BIN/claude-broker daemon start
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
UNIT
# Linger keeps user services running without a login session (and starts them at boot).
if ! loginctl show-user "$USER" -p Linger 2>/dev/null | grep -q 'yes'; then sudo loginctl enable-linger "$USER"; fi
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
systemctl --user daemon-reload
systemctl --user enable --now claude-broker.service
systemctl --user restart claude-broker.service
for _ in $(seq 1 20); do
    if curl -fsS -m 2 http://127.0.0.1:4180/healthz >/dev/null 2>&1; then break; fi
    sleep 0.5
done
curl -fsS -m 2 http://127.0.0.1:4180/healthz >/dev/null && ok "daemon up on http://127.0.0.1:4180" \
    || { echo "The daemon did not answer — check: journalctl --user -u claude-broker -n 50" >&2; exit 1; }

cat <<DONE

$(ok "Server ready.")
Next, in the CMS admin → Plugins → Claude Broker:
  1. Broker connection → Token:  $TOKEN
     (URL http://127.0.0.1:4180) → Save
  2. Setup → Sign in to Claude (open the link, paste the code back) — the broker
     saves ONE long-lived token (claude setup-token) that every session uses
  3. Add pools → Save → Setup → Start sessions (the broker starts, watches and
     restarts them; spec in ~/.config/claude-broker/fleet.json)
  4. Test prompt at the bottom of the page

Logs:     journalctl --user -u claude-broker -f
Sessions: claude-broker fleet status   (watch one: tmux -L claude-broker attach)
DONE
