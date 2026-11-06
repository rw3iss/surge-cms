# AI module

One entry point for AI requests in the CMS, whichever service answers them, and
one answer shape.

| Provider | What answers | Cost | Setup |
|---|---|---|---|
| `broker` (default) | A Claude Code session attached to a [claude-broker](https://github.com/rw3iss/claude-broker) daemon, through the **claude-broker plugin** | Your Claude plan — no API billing | Install + configure the plugin (`packages/api/plugins/claude-broker/README.md`) |
| `anthropic` | The Anthropic Messages API | Per token | Settings → AI → API key (or `ANTHROPIC_API_KEY`) |

Settings → **AI** picks the default provider, holds the Anthropic key (masked;
an echoed mask keeps it) + model (default `claude-sonnet-5-5`), shows each
provider's readiness and every broker pool, and has a test prompt.

## Server setup (broker)

1. Once, on the server, as the CMS's OS user: `bash packages/api/plugins/claude-broker/setup/setup-server.sh`
   (tmux, Claude Code, claude-broker ≥ 0.6, the daemon as a systemd user service; prints the token).
2. Plugins → Claude Broker → paste the token → **Setup → Sign in to Claude** (open the link, sign in,
   paste the code back — the broker runs `claude setup-token` and saves one long-lived token for every
   session) → add pools → **Start sessions** (the broker starts, supervises and restarts the sessions).

Full walkthrough: in-admin `/admin/help/claude-broker`; details in the plugin README.

## Pools

A broker **pool** is a session label: members are attached sessions labelled
`<pool>` or `<pool>-<n>`. The plugin config lists the pools (name, expected
count 1–16, description) and the default pool. A pool request goes to the member
with the fewest active jobs among those that can WORK — a session the broker
reports as usage-limited, signed out, stuck, refusing the channel or exited is
skipped; when none is left the error names their states. A request may also name
one `session` (id or label); it is refused (503) while that session cannot work.

Pool status (`AiPool`): `attached`, **`ready`** (attached and able to work),
`busy`, `idle` (ready with no job), `healthy` = `ready >= expected`; each session
carries `healthy` + the broker `state`. Settings → AI shows Ready/expected.

## The answer: `AiResult`

```ts
{
  id: string;              // broker job id, or `anthropic:<message id>`
  provider: 'broker' | 'anthropic';
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'expired';
  text: string;            // '' until completed
  data: unknown;           // parsed JSON for format:'json' (or an object result)
  error: string | null;
  pool, sessionId, model;  // model = session label (broker) or model id
  timedOut: boolean;       // a waiting request gave up first — poll the job
  progress: { note, at }[];
  meta: Record<string, string>;
  createdAt, completedAt;
  usage?: { inputTokens, outputTokens };   // anthropic
}
```

Rules: a looping/repeating answer is `failed` (retried once by the plugin); with
`format: 'json'` an answer that is not JSON is `failed` ("not valid JSON"); a
broker `dispatched` job reads `pending`, `orphaned` reads `failed`.

## Using it

**Server code** (any service):

```ts
import * as ai from '../services/ai';

const r = await ai.ask('Summarize this week in 3 bullets: …', { pool: 'summary', kind: 'SUMMARY' });
if (r.status === 'completed') use(r.text);

const tags = await ai.askJson<string[]>('Return 5 tags as a JSON array for: …'); // null on failure
```

`ask` never throws for a provider failure — check `status`/`error`. It is not
capped by HTTP timeouts, but a broker request waits at most the plugin's **Wait
timeout** (default 120 s; pass `timeoutSec` for longer) — a job still running
then comes back `timedOut: true` (and `askJson` returns null).

**HTTP / SDK** (staff + permission `ai:use`; settings need `ai:manage`; an
`ssk_` API key passes on its scope — reads need `read`, writes `write`):

| Route | SDK |
|---|---|
| `GET /api/v1/ai/status` | `cms.ai.status()` |
| `GET /api/v1/ai/pools` | `cms.ai.pools()` |
| `GET /api/v1/ai/sessions?pool=&all=` | `cms.ai.sessions({ pool })` |
| `POST /api/v1/ai/query` | `cms.ai.query({ prompt, pool?, session?, provider?, format?, wait?, … })`, `cms.ai.ask(prompt, opts)` |
| `GET /api/v1/ai/jobs` | `cms.ai.jobs({ status?, pool?, limit? })` |
| `GET /api/v1/ai/jobs/:id?wait=N` | `cms.ai.job(id, { wait })` |
| `DELETE /api/v1/ai/jobs/:id` | `cms.ai.cancel(id)` |
| `POST /api/v1/ai/jobs/:id/comment` | `cms.ai.comment(id, note)` |
| `GET/PUT /api/v1/ai/settings` | `cms.ai.settings()`, `cms.ai.updateSettings(body)` |

An HTTP request waits at most **55 s** (proxies close idle upstreams at 60 s). A
broker job still running then returns `timedOut: true`; poll
`GET /ai/jobs/:id?wait=50` until `status` is final. `wait: false` returns the
pending job at once. A polled job keeps its session label (`model`) and JSON
parsing: the plugin records `session` and `format` in the job meta. The
Anthropic provider has no job to poll — over HTTP it is cut at the same 55 s.

## Secrets

The Anthropic key is masked in `GET /ai/settings` (an echoed mask keeps it). The
broker token is a `type: 'secret'` plugin field, so plugin admin reads mask it
too (see PLUGINS.md → Secrets), and the plugin never returns the Claude sign-in
token: `setupStatus` / `loginSubmit` carry only whether it is set and its dates.

## Admin test prompts

Settings → AI and the plugin's config page both poll a running broker job
(≤ 50 s per request, so a proxy never times out) and offer **Cancel** while it
runs. Settings → AI shows the provider form only with `ai:manage`; without it the
page keeps the status and the test prompt.

## Files

- `packages/api/src/services/ai/` — `index.ts` (query/ask/askJson/jobs/status),
  `result.ts` (AiResult, JSON parsing, loop detection), `settings.ts`
  (`ai_settings` row), `providers/broker.ts`, `providers/anthropic.ts`.
- `packages/api/src/routes/ai.ts`; DTOs `packages/shared/src/api/routes/ai.ts`;
  SDK `packages/cms-client/src/modules/ai.ts`.
- Plugin `packages/api/plugins/claude-broker/` (`server.js` actions, `lib.js`
  helpers, `client.js` config page).
- Admin `packages/cms/src/components/admin/ai/AiSettingsPanel.tsx` (Settings → AI).
