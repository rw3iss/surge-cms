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

## Pools

A broker **pool** is a session label: members are attached sessions labelled
`<pool>` or `<pool>-<n>`. The plugin config lists the pools (name, expected
count, description) and the default pool. A pool request goes to the member
with the fewest active jobs. A request may also name one `session` (id or label).

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
capped by HTTP timeouts.

**HTTP / SDK** (staff + permission `ai:use`; settings need `ai:manage`):

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
pending job at once.

## Files

- `packages/api/src/services/ai/` — `index.ts` (query/ask/askJson/jobs/status),
  `result.ts` (AiResult, JSON parsing, loop detection), `settings.ts`
  (`ai_settings` row), `providers/broker.ts`, `providers/anthropic.ts`.
- `packages/api/src/routes/ai.ts`; DTOs `packages/shared/src/api/routes/ai.ts`;
  SDK `packages/cms-client/src/modules/ai.ts`.
- Plugin `packages/api/plugins/claude-broker/` (`server.js` actions, `lib.js`
  helpers, `client.js` config page).
- Admin `packages/cms/src/components/admin/ai/AiSettingsPanel.tsx` (Settings → AI).
