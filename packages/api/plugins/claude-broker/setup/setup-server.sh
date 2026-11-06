#!/usr/bin/env bash
# claude-broker plugin — one-time server setup.
#
# Run on the CMS server AS THE USER THE CMS RUNS AS (the plugin signs in and
# starts sessions as that user):
#
#     bash packages/api/plugins/claude-broker/setup/setup-server.sh
#
# Idempotent — safe to re-run. It installs what is missing:
#   1. git, curl, openssl, tmux, build tools (sudo dnf/apt) + checks Node >= 20
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

# The sessions run as this user and Claude Code refuses to skip permission
# prompts as root — run it as the (non-root) user the CMS runs as.
if [ "$(id -u)" -eq 0 ] && [ "${ALLOW_ROOT:-}" != "1" ]; then
    echo "Run this as the user the CMS runs as, not root (it uses sudo only for system packages and linger)." >&2
    echo "Set ALLOW_ROOT=1 to override." >&2
    exit 1
fi

# Install system packages with whichever package manager the box has.
pkg_install() {
    if command -v dnf >/dev/null 2>&1; then sudo dnf install -y "$@"
    elif command -v apt-get >/dev/null 2>&1; then sudo apt-get update -y && sudo apt-get install -y "$@"
    else echo "Install these with your package manager, then re-run: $*" >&2; exit 1; fi
}

say "Prerequisites (git, curl, openssl, tmux, build tools for claude-broker's sqlite module)"
MISSING=()
for cmd in git curl openssl tmux make g++ python3; do
    command -v "$cmd" >/dev/null 2>&1 || MISSING+=("$cmd")
done
if [ "${#MISSING[@]}" -gt 0 ]; then
    PKGS=()
    for cmd in "${MISSING[@]}"; do
        case "$cmd" in
            g++) if command -v dnf >/dev/null 2>&1; then PKGS+=(gcc-c++); else PKGS+=(g++); fi ;;
            *) PKGS+=("$cmd") ;;
        esac
    done
    say "installing: ${PKGS[*]}"
    pkg_install "${PKGS[@]}"
fi
ok "git $(git --version | awk '{print $3}'), $(tmux -V)"

say "Node.js (>= 20)"
if ! command -v node >/dev/null 2>&1; then
    echo "Node.js is not installed — install Node 20+ (the CMS needs it too), then re-run." >&2; exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then echo "Node $(node -v) is too old — claude-broker needs Node 20+." >&2; exit 1; fi
command -v npm >/dev/null 2>&1 || pkg_install npm
ok "node $(node -v)"

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
else
    # A half-finished earlier install (folder but no binary) blocks the installer — move it aside.
    if [ -d "$HOME/.local/share/claude-broker" ]; then
        mv "$HOME/.local/share/claude-broker" "$HOME/.local/share/claude-broker.failed-$(date +%Y%m%d%H%M%S)"
    fi
    curl -fsSL https://raw.githubusercontent.com/rw3iss/claude-broker/main/install.sh | bash
    ok "claude-broker installed"
fi

say "Broker token"
mkdir -p "$CONF_DIR"
chmod 700 "$CONF_DIR"
if [ ! -f "$ENV_FILE" ]; then
    (umask 077; printf 'CLAUDE_BROKER_TOKEN=%s\nCLAUDE_BROKER_LOG_SESSIONS=1\n' "$(openssl rand -hex 16)" > "$ENV_FILE")
    ok "created $ENV_FILE"
elif ! grep -q '^CLAUDE_BROKER_TOKEN=' "$ENV_FILE"; then
    # Keep the file's other settings — only add the missing token (on its own line).
    if [ -s "$ENV_FILE" ] && [ -n "$(tail -c1 "$ENV_FILE")" ]; then echo >> "$ENV_FILE"; fi
    printf 'CLAUDE_BROKER_TOKEN=%s\n' "$(openssl rand -hex 16)" >> "$ENV_FILE"
    ok "added a token to $ENV_FILE"
else ok "kept $ENV_FILE"; fi
chmod 600 "$ENV_FILE"
TOKEN="$(sed -n 's/^CLAUDE_BROKER_TOKEN=//p' "$ENV_FILE" | head -1)"

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
# '-': a stale socket owned by another user cannot be removed (sticky /tmp) — don't fail the start on it.
ExecStartPre=-/bin/rm -f /tmp/claude-broker.sock
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
  1. Broker connection: URL http://127.0.0.1:4180. The token is read from
     $ENV_FILE automatically
     (same server) — or paste it:  $TOKEN
  2. Setup → Sign in to Claude (open the link, paste the code back) — the broker
     saves ONE long-lived token (claude setup-token) that every session uses
  3. Add pools → Save → Setup → Start sessions (the broker starts, watches and
     restarts them; spec in ~/.config/claude-broker/fleet.json)
  4. Test prompt at the bottom of the page

Logs:     journalctl --user -u claude-broker -f
Sessions: claude-broker fleet status   (watch one: tmux -L claude-broker attach)
DONE
