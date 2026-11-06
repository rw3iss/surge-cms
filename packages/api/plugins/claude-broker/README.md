# claude-broker plugin

Connects the CMS AI module (`services/ai/`, `/api/v1/ai`, SDK `cms.ai`) to a
[claude-broker](https://github.com/rw3iss/claude-broker) daemon, so AI prompts
run on Claude Code sessions you already host — no per-token API cost.

## Setup

In-admin guide: **/admin/help/claude-broker**.

1. **Server, once** (SSH, as the user the CMS runs as):
   `bash packages/api/plugins/claude-broker/setup/setup-server.sh` — installs
   tmux, Claude Code and claude-broker **≥ 0.6** (updates an older one), runs
   the daemon as a systemd **user** service (with linger) and prints the broker
   token. Idempotent.
2. Admin → Plugins → **Claude Broker (AI)** → Install → Enable → Configure:
   - **Broker connection** — URL (default `http://127.0.0.1:4180`) + the token.
   - **Setup → Sign in to Claude** — the BROKER runs `claude setup-token` in its
     private tmux server; open the link, sign in, paste the code back. It saves
     ONE long-lived token (`~/.config/claude-broker/oauth.env`, 0600) that every
     session loads — sessions sharing one interactive login refresh and blank
     each other's token ("Login expired"; CivicGate outage 2026-10-22).
   - **Pools** — name + session count; **Session model / effort** optional.
   - **Setup → Start sessions** — writes the pools to the broker's fleet spec
     (`PUT /fleet`) and applies it (`POST /fleet/apply`). The broker starts one
     tmux window per session (`<pool>` or `<pool>-<n>`) with the battle-tested
     CivicGate launch (strict per-session MCP config, worker settings,
     `ENABLE_TOOL_SEARCH=false`, pre-trusted neutral folder, dev-channel prompt
     answered), then supervises them: restarts exited/stuck ones, nudges an idle
     session when a job waits, and reports each session's state (ready, usage
     limit, signed out, channel refused …) — shown per session in the checklist
     with a Restart button.
3. Settings → AI → Default provider = Claude broker.

**Routing:** the plugin still picks the least-busy session of a pool itself
(so the 6 s per-session gap holds), but skips sessions the broker reports as
unable to work (`usage_limited`, `login_required`, `context_wedged`,
`channels_unavailable`, `exited`). With an older broker (< 0.6) the setup
checklist shows reachability + attached sessions only.

## Pools

The broker itself has no pools. A **pool is a session label**: its members are
the attached sessions labelled `<pool>` or `<pool>-<n>` (`summary`,
`summary-1`, `summary-2` …). A request to a pool goes to the member with the
fewest active jobs (ties: the one whose last job settled longest ago), sent by
session id. `count` is how many sessions you expect; the status shows
`attached/expected` and flags a short pool.

## Prompt framing and results (CivicGate conventions)

- Each prompt gets a header (`▶ KIND` + a one-line subject) and a footer telling
  the session to answer through `complete_job` — without it a session may answer
  in chat and the job expires at its TTL. Turn off with **Frame prompts**.
- `format: 'json'` adds "Return ONLY valid JSON"; the AI module parses the
  answer loosely (code fences, surrounding prose).
- A repeating, looping answer is treated as failed and retried once (when the
  caller waits).
- Jobs to one session are spaced by **Gap between jobs** (default 6 s): a job
  sent while the session's previous turn is still open arrives inside a tool
  result and is refused.

## Actions

`POST /api/v1/plugins/claude-broker/action/<name>` (admin) — the AI module calls
the same actions internally. Each returns `{ ok: true, … }` or
`{ ok: false, status, error }`.

| Action | Payload | Returns |
|---|---|---|
| `testConnection` | – | `version`, `sessionCount` |
| `status` | – | `broker`, `pools[]` (attached/expected/busy/idle/sessions), `unpooled[]`, `defaultPool` |
| `pools` | – | configured `pools[]`, `defaultPool` |
| `sessions` | `pool?`, `all?` | `sessions[]` |
| `submit` | `prompt`, `system?`, `pool?` \| `session?` (id or label), `format?`, `kind?`, `subject?`, `wait?`, `timeoutSec?`, `ttlSec?`, `priority?`, `meta?`, `clientRef?`, `frame?` | `job` |
| `job` / `wait` | `id` (+ `timeoutSec`) | `job` |
| `cancel` | `id` | `job` |
| `comment` | `id`, `note` | `job` |
| `jobs` | `status?`, `pool?`, `sessionId?`, `limit?`, `all?` | `jobs[]` (CMS jobs unless `all`) |
| `setupStatus` | – | `broker` (reachable/version/capabilities), `managed`, `attached[]`, `auth` (broker `GET /auth`), `fleet` (pools → sessions with state/stateText/healthy/restarts, tmux) |
| `loginStart` | – | `url` (the Claude sign-in page; broker `POST /auth/login`) |
| `loginSubmit` | `code` | `token` — or `retry: true` on a wrong code |
| `loginCancel` / `logout` | – | – |
| `startSessions` | – | `started[]`, `stopped[]`, `kept[]` (fleet spec synced + applied) |
| `stopSessions` | – | `stopped[]` |
| `restartSession` | `label` | – |

A `job` is `{ id, status, sessionId, sessionLabel, pool, text, result, error,
progress[], meta, createdAt, dispatchedAt, completedAt, expiresAt, timedOut }`.

Pure helpers (pool membership, session picking, framing, normalisation) live in
`lib.js` and are tested by `src/plugins/claudeBroker.test.ts`. Sign-in and the sessions themselves are the broker's job (claude-broker ≥ 0.6:
`/auth`, `/fleet`).
