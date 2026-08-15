# Testing Guide

Two ways to verify this: the automated suite, and a manual walkthrough that puts each behaviour on screen. The manual walkthrough is the one to use if you're evaluating the build — it takes about 8 minutes.

---

## 1. Automated suite

```bash
npm ci
```

```bash
npm test
```

Expected:

```
# tests 218
# suites 55
# pass 218
# fail 0
```

Run one file at a time when you want to read the output:

```bash
cd server && node --test --test-concurrency=1 test/fallback.test.js
```

Files worth reading, in order of how much they tell you:

| File | What it proves |
|---|---|
| `test/fallback.test.js` | The curveball: re-routing, both loop guards, cost of both attempts, the 60-task no-loop stress test |
| `test/dispatcher.test.js` | Priority ordering, capacity caps, head-of-line blocking, a 100-task burst |
| `test/execution.test.js` | Slot accounting, crash safety, state guards, 20 concurrent tasks on a 5-slot agent |
| `test/metrics.test.js` | Zero-state safety (no NaN), health thresholds, p95 against a known ramp |
| `test/sse.test.js` | Live push, listener cleanup across reconnects, shutdown safety |
| `test/jsonc.test.js` | That the supplied seed files are genuinely invalid JSON, and load anyway |

Also check the supply chain:

```bash
npm audit
```

Expected: `found 0 vulnerabilities`.

---

## 2. Manual walkthrough

### Step 1 — Start in deterministic happy-path mode

```bash
FAILURE_RATE=0 npm run dev
```

Open **http://localhost:5173**.

**Expect:** four agent cards, all `IDLE`. Metric cards read zero — specifically `0`, `0.0%`, `0 ms`, `$0.0000` and **`HEALTHY`**, *not* `NaN` and not `CRITICAL`. An empty system is not a degraded one.

### Step 2 — Load the supplied sample tasks

Click **Load Sample Tasks** (or `curl -X POST localhost:4000/api/tasks/seed/sample`).

**Expect:** the three provided tasks appear and route correctly — Tax → Tax Compliance Agent, Security → Security & PII Scanner, Audit → Audit Risk Scraper. Each transitions `PENDING → PROCESSING → COMPLETED` live, with no page refresh. Agent cards flip to `PROCESSING` and back to `IDLE`; metrics update in step.

This also silently proves the seed-file fix: `sample_tasks.json` is not valid JSON as delivered, and it loaded anyway.

### Step 3 — Submit your own task

Fill the form and submit. Then submit a deliberately broken one — clear the title, set priority to something invalid.

**Expect:** a `400` surfacing *per-field* errors, all at once rather than one at a time. Now try `type: "CRYPTO_FORENSICS"` with a valid title and payload.

**Expect:** it is **accepted**, routed to the General Fallback Agent, and annotated `Unknown task type "CRYPTO_FORENSICS"; routed to GENERAL.` An ingestion endpoint should absorb an unfamiliar document category, not reject it — but a bad *priority* is still a hard 400, because that silently changes queue behaviour.

### Step 4 — The fallback (the main event)

Stop the server and restart forcing every failure:

```bash
FAILURE_RATE=1 MIN_DELAY_MS=300 MAX_DELAY_MS=600 npm run dev
```

Submit a `TAX` task.

**Expect:** it fails on the Tax Compliance Agent, then visibly re-routes to the General Fallback Agent. The row is unmistakable — a coloured left rule, a diagonal hatch, an `↩ FALLBACK` chip, and the routing shown as `TAX ⟶ GENERAL` with the original agent struck through.

Click the row to expand it.

**Expect:** two attempts, in order, each with its own agent, outcome, latency and cost. Both attempts are billed — a re-routed task genuinely cost the business twice, and the total reflects that.

Because both agents fail at `FAILURE_RATE=1`, the task ends `FAILED` after **exactly two attempts**. Watch that it does not loop. Confirm via the API:

```bash
curl -s localhost:4000/api/tasks | grep -o '"attempt_count":[0-9]*' | sort | uniq -c
```

Every task should show `"attempt_count":2` — never 3.

### Step 5 — The fallback agent has nowhere to fall back to

Still at `FAILURE_RATE=1`, submit a task with type `GENERAL`.

**Expect:** it fails after **one** attempt with `fallback_applied: false`. The General agent is the fallback; routing it to itself would loop forever. This is the second, independent loop guard.

### Step 6 — Capacity limits

Restart in happy-path mode with a long delay so you can watch:

```bash
FAILURE_RATE=0 MIN_DELAY_MS=4000 MAX_DELAY_MS=5000 npm run dev
```

Submit **five** `AUDIT` tasks quickly (the Audit agent allows 2 concurrent).

**Expect:** the Audit card shows `2/2` and `AT CAPACITY`; exactly two tasks are `PROCESSING` and three wait as `PENDING`. Never three at once.

### Step 7 — Priority, and no head-of-line blocking

With those Audit tasks still queued, submit a `LOW` priority `SECURITY` task.

**Expect:** it starts **immediately**, despite being lower priority and submitted last — because the Security agent is idle and a saturated Audit agent must not block work bound for a free agent. Then submit a `HIGH` priority `AUDIT` task: it jumps ahead of the queued `MEDIUM` audit tasks, but still waits for a slot.

This is the deliberate trade-off: priority is honoured *per agent*, not globally.

### Step 8 — Live stream resilience

With tasks in flight, kill the API (`Ctrl+C`) and restart it.

**Expect:** the dashboard's connection indicator shows reconnecting, then reconnects on its own and re-hydrates from the snapshot frame — no manual refresh. Also confirm the server actually shuts down rather than hanging on the open stream; `Ctrl+C` should return your prompt promptly.

### Step 9 — Metrics under mixed load

```bash
FAILURE_RATE=0.3 npm run dev
```

Submit 10–15 tasks of mixed types and let them drain.

**Expect:** success rate near 70%, `system_health` reading `DEGRADED` (below the 90% target, above the 70% critical line), a non-zero fallback ratio shown as `N of M · X%`, and per-agent-type average latencies. Check that the per-agent costs sum to the reported total, and that the Audit agent ($0.020/1k) costs more than the Security agent ($0.008/1k) for comparable work.

---

## 3. Fast API-only smoke test

No browser needed:

```bash
curl -s -X POST localhost:4000/api/tasks -H 'content-type: application/json' -d '{"title":"Smoke","type":"TAX","payload":"check","priority":"HIGH"}'
```

```bash
curl -s -X POST localhost:4000/api/tasks/task-0001/execute
```

```bash
curl -s localhost:4000/api/metrics
```

Watch the live event stream in a terminal:

```bash
curl -N localhost:4000/api/events
```

You'll see the `snapshot` frame immediately, then `task.created`, `task.started`, `task.completed` / `task.failed`, `task.fallback`, `agent.status` and `metrics.updated` as they happen, with a `: keepalive` comment every 15 seconds.

---

## What to watch for (the failure modes this was built to avoid)

| Symptom | What it would mean |
|---|---|
| `NaN%` or `NaN ms` on first load | Metrics divide-by-zero on an empty system |
| An agent stuck in `PROCESSING` forever | Status stored rather than derived |
| More than `max_concurrent` tasks running on one agent | Capacity check racing the slot claim |
| `attempt_count` of 3 or more | A fallback loop guard failed |
| A task `PENDING` forever after its agent disappears | Orphaned task not terminated |
| `Ctrl+C` hanging the server | Open SSE streams blocking shutdown |
| A low-priority task on an idle agent waiting behind a saturated one | Head-of-line blocking |

Each of these has a corresponding automated test; the manual walkthrough is there to let you see them rather than take the suite's word for it.
