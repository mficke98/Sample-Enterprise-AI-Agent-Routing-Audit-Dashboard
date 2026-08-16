# Enterprise AI Agent Routing & Audit Dashboard

A local prototype of an AI Agent Execution & Audit Pipeline. It routes incoming enterprise tasks to specialised AI agents (Tax, Audit, Security, General), simulates their execution, tracks live status and metrics, and presents an interactive audit dashboard.

**Stack:** Node 20 + Express (API) · Vite + React (dashboard) · Server-Sent Events (live updates) · `node:test` (zero test dependencies)

---

## Quick start

```bash
npm ci
```

```bash
npm run dev
```

- Dashboard → **http://localhost:5173**
- API → **http://localhost:4000**

Use `npm ci` rather than `npm install`. It installs strictly from `package-lock.json`, fails if the lockfile and `package.json` disagree, and **verifies the SRI integrity hash of every package** — `npm install` will silently rewrite the lockfile instead.

Run the tests — **505 across both suites** (218 backend, 287 frontend):

```bash
npm test
```

Either half on its own, or a frontend coverage report:

```bash
npm run test:server
```

```bash
npm run test:web
```

```bash
npm run test:coverage
```

---

## Demonstrating the interesting behaviour

The simulation is env-tunable precisely so the interesting paths can be shown on demand rather than waiting for a 10% dice roll to land in front of you.

**Force every fallback** (the headline feature):

```bash
FAILURE_RATE=1 MIN_DELAY_MS=300 MAX_DELAY_MS=600 npm run dev
```

Every task now fails on its specialist and visibly re-routes to the General Fallback Agent, flagged `fallback_applied: true`.

**Force the happy path** (clean demo, no failures):

```bash
FAILURE_RATE=0 npm run dev
```

**Reproducible runs** — identical latency, token and failure draws every time:

```bash
SEED=42 npm run dev
```

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | API port |
| `FAILURE_RATE` | `0.1` | Probability an attempt fails (spec: ~10%) |
| `TIMEOUT_SHARE` | `0.5` | Of failures, the share that are `TIMEOUT` vs `ERROR` |
| `MIN_DELAY_MS` / `MAX_DELAY_MS` | `1000` / `3000` | Artificial execution delay (spec: 1–3s) |
| `SEED` | *(none)* | Fixed RNG seed for reproducible runs |
| `ERROR_STICKY_MS` | `5000` | How long an agent visibly stays in `ERROR` |
| `AUTO_DISPATCH` | `1` | Set `0` to disable background dispatch (manual `/execute` only) |

---

## API

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/tasks` | Ingest a task, assign an agent, set status `PENDING`. `400` with per-field details on invalid input. |
| `GET` | `/api/tasks` | List tasks. Filters: `?status=`, `?type=`, `?limit=` |
| `GET` | `/api/tasks/:id` | One task, including its full attempt history. |
| `POST` | `/api/tasks/:id/execute` | Execute now and await the result (including any fallback). `404` unknown, `409` not `PENDING`. |
| `POST` | `/api/tasks/seed/sample` | Bulk-ingest the provided `sample_tasks.json`. |
| `GET` | `/api/agents` | Live status board: status, workload, capacity, cost rate. |
| `GET` | `/api/metrics` | Audit aggregates (below). |
| `GET` | `/api/events` | SSE stream — `snapshot` on connect, then live events. |
| `GET` | `/api/health` | Liveness plus the active simulation mode. |

### Task record

```jsonc
{
  "id": "task-0001",
  "title": "Q3 Corporate Tax Exemption Verification",
  "type": "TAX",
  "priority": "HIGH",
  "status": "COMPLETED",              // PENDING | PROCESSING | COMPLETED | FAILED
  "assigned_agent_id": "agent-gen-00",
  "fallback_applied": true,           // re-routed after a failure
  "routing_note": "Re-routed from Tax Compliance Agent after failure.",
  "attempts": [                        // append-only audit trail
    { "agent_name": "Tax Compliance Agent",   "outcome": "ERROR",   "latency_ms": 108, "cost_usd": 0.002325 },
    { "agent_name": "General Fallback Agent", "outcome": "SUCCESS", "latency_ms": 112, "cost_usd": 0.000785, "confidence": 0.71 }
  ],
  "result": { "summary": "...", "findings": ["..."], "confidence": 0.71 },
  "latency_ms": 220,                  // wall clock across ALL attempts
  "total_cost_usd": 0.00311           // a re-routed task genuinely cost twice
}
```

### Metrics

`GET /api/metrics` returns totals by status, `success_rate`, per-agent-type average latency and cost, `p95` latency, the fallback ratio, total simulated token cost, queue depth, and a `system_health` verdict (`HEALTHY` ≥ 90% success · `DEGRADED` ≥ 70% · `CRITICAL` below, with an active agent `ERROR` degrading an otherwise-healthy system).

---

## How it works

```
POST /api/tasks
      │
      ▼
  validate ──► route (pure: type → agent)  ──► store as PENDING
                                                    │
                                                    ▼
                                    priority dispatcher (capacity-aware)
                                    HIGH > MEDIUM > LOW, FIFO within tier
                                    skips saturated agents, never blocks
                                                    │
                                                    ▼
                                          executor (simulated)
                                          1–3s delay, ~10% failure
                                            │              │
                                     SUCCESS│              │ERROR / TIMEOUT
                                            ▼              ▼
                                       COMPLETED    fallback → General agent
                                                    fallback_applied: true
                                                            │
                                                    (one retry only)
                                                            ▼
                                                  COMPLETED or FAILED
                                            │
                                            ▼
                                  metrics ──► SSE ──► React dashboard
```

Three properties do most of the work:

- **`attempts[]` is append-only.** A task can hold more than one execution, which is what made the mid-build fallback requirement a 62-line change in one file rather than a rewrite — and it produces the audit trail for free.
- **Routing is pure; capacity belongs to the dispatcher.** `selectAgent()` answers "who owns this work?", never "is there a slot free?". Fallback is the same function called with the failed agent excluded.
- **Agent status is derived, never stored.** `IDLE | PROCESSING | ERROR` is computed from `(active_count, last_error_at)` on every read, so an agent can't get stuck in `PROCESSING` after a crash.

Full reasoning, including what each choice cost: **[DESIGN_DECISIONS.md](DESIGN_DECISIONS.md)**.

---

## Notes on the supplied files

Both `agents_config.json` and `sample_tasks.json` open with a `// filename` comment line, so **neither is valid JSON** — `JSON.parse` throws on them as delivered. They are loaded through a comment-stripping parser and left byte-for-byte unchanged. The stripper is a string-aware scanner rather than a regex, because a naive `//` strip would corrupt any URL inside a task payload (`"https://x.com"` → `"https:"`). There's a test asserting the raw files really do fail `JSON.parse`, so the premise can't rot.

---

## Testing

```bash
npm test
```

**505 tests.** The backend runs 218 across 55 suites on Node's built-in runner with no test-framework dependency at all; the frontend runs 287 on Vitest + Testing Library at **98.8% statement / 94.3% branch coverage**. See **[TESTING.md](TESTING.md)** for a manual walkthrough that exercises fallback, priority ordering, capacity limits and the live stream by hand.

## Project layout

```
server/src/
  domain/      registry · router · executor · execution · dispatcher · metrics
  routes/      tasks · agents · metrics · events (SSE)
  lib/         jsonc (comment-tolerant loader) · rng (seedable) · bus
server/test/   218 tests
web/src/       React dashboard (components · hooks · lib)
web/test/      287 tests
```
