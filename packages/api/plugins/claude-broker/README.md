# claude-broker plugin

Connects the CMS AI module (`services/ai/`, `/api/v1/ai`, SDK `cms.ai`) to a
[claude-broker](https://github.com/rw3iss/claude-broker) daemon, so AI prompts
run on Claude Code sessions you already host — no per-token API cost.

## Setup

1. Run the broker daemon on the CMS server (`claude-broker daemon start`, or the
   systemd unit from its README) and attach sessions in tmux, each with a label
   (`CLAUDE_BROKER_SESSION_LABEL=summary-1` …).
2. Admin → Plugins → **Claude Broker (AI)** → Install → Enable → Configure:
   - **Broker URL** — default `http://127.0.0.1:4180`.
   - **Token** — the daemon's `CLAUDE_BROKER_TOKEN`.
   - **Pools** — one row per pool: name, expected session count, description.
     The Live status list offers "+ label (n)" for attached sessions that are in
     no pool yet.
   - **Default pool**, job TTL, wait timeout, prompt framing, session gap.
3. Settings → AI → Default provider = Claude broker.

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

A `job` is `{ id, status, sessionId, sessionLabel, pool, text, result, error,
progress[], meta, createdAt, dispatchedAt, completedAt, expiresAt, timedOut }`.

Pure helpers (pool membership, session picking, framing, normalisation) live in
`lib.js` and are tested by `src/plugins/claudeBroker.test.ts`.
