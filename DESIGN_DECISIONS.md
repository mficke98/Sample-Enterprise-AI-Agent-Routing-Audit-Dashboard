# Design Decisions, Benefits & Trade-offs

A record of every non-obvious choice made building this prototype, what it bought, and what it cost. Ordered roughly by how much it shaped the rest of the system.

---

## 1. The `attempts[]` array is the load-bearing decision

**Decision.** A task record holds an append-only `attempts: []` array rather than a single mutable `result` field. Each entry records the agent, outcome, latency, tokens, cost, confidence and error for one execution.

**Why.** The brief warned that a requirement would change mid-build. The requirement that arrived — re-route failures to a General agent — is cheap or catastrophic depending entirely on whether a task can hold more than one execution.

**Benefit.** The fallback feature landed as **+62/−7 lines in one file** ([`execution.js`](server/src/domain/execution.js)), with no new module, no signature change, and no migration of existing records. It also produces the audit trail for free: you can see that a task was tried on Tax, timed out at 108ms costing $0.0023, then succeeded on General — which is the actual product here.

**Trade-off.** Every task carries an array even though ~90% hold exactly one entry, and consumers must know that `result` reflects the *last* attempt while `total_cost_usd` sums *all* of them. Slightly more to explain; a great deal less to rewrite.

---

## 2. Routing and capacity are separate concerns

**Decision.** [`selectAgent(type, {registry, exclude})`](server/src/domain/router.js) is pure and answers only "*which agent owns this work?*". It never checks whether a slot is free. Capacity lives entirely in the [dispatcher](server/src/domain/dispatcher.js).

**Why.** These are different questions with different answers over time. Ownership is stable; availability changes second to second.

**Benefit.** Fallback is just the same function called with the failed agent excluded — no parallel routing path. The router is trivially unit-testable with no timing or concurrency setup, and a saturated Tax agent still *owns* Tax work rather than being bypassed.

**Trade-off.** Two places must be consulted to predict where a task actually runs next, and the dispatcher has to re-check capacity at launch, so a task can be selected and then deferred. We treat `AGENT_AT_CAPACITY` from a racing launch as benign and self-correcting.

**Rejected alternative.** Routing to whichever agent is free right now. This would silently degrade output quality — a busy Tax agent would spill TAX work onto the generalist, whose confidence is measurably lower (0.62–0.85 vs 0.82–0.99), without anything in the record explaining why.

---

## 3. The dispatcher skips saturated agents instead of blocking

**Decision.** The queue walks `PENDING` tasks in priority order and launches every task whose agent has a slot, **skipping** rather than stopping at a saturated one.

**Why.** A strict priority queue head-of-line blocks. One HIGH TAX task waiting on a full Tax agent would stall every MEDIUM SECURITY task behind it — while the Security agent sits completely idle.

**Benefit.** Throughput stays high under mixed load, and `max_concurrent` becomes a per-agent bound instead of a global bottleneck. Directly asserted by test: with the Audit agent saturated, a lower-priority Security task still starts.

**Trade-off.** Priority becomes "best-effort within an agent" rather than a global guarantee — a LOW task on an idle agent genuinely can start before a HIGH task on a busy one. For a routing system with per-agent capacity this is the correct reading of priority, but it *is* a weaker guarantee and worth stating. Starvation is still bounded: within-tier ordering is FIFO by monotonic id, so a skipped task goes first the instant its agent frees.

---

## 4. Agent status is derived, never stored

**Decision.** `statusOf(agent)` computes `IDLE | PROCESSING | ERROR` from `(active_count, last_error_at)` on every read. The `status` field in `agents_config.json` is deliberately ignored.

**Why.** A stored status is a cache, and caches desync. The classic failure is an agent stuck in `PROCESSING` forever after a crash mid-execution.

**Benefit.** Status cannot lie. The `ERROR` window expires by comparison against `errorStickyMs` with no timer to fire, miss, or leak — a test asserts status reverts correctly by passing a future timestamp. There's an explicit test that scribbling a bogus `status` onto an agent changes nothing.

**Trade-off.** Recomputed per read rather than cached. At four agents this is free; at ten thousand it would need memoisation.

---

## 5. Cost accumulates in integer micro-dollars

**Decision.** Internally cost is an integer count of micro-dollars. Division to USD happens once, at the API boundary.

**Why.** This is billing data on an audit dashboard, and repeated float addition at the $0.008 scale drifts measurably.

**Benefit.** Exact arithmetic; per-agent costs sum to the total with no epsilon fudging. A test demonstrates the failure it prevents: 1000 float additions of `$0.002` do **not** equal `$2`, while the integer path does exactly.

**Trade-off.** An internal `_cost_micros` field must be stripped by the serializer, and readers must remember the units. Cheap insurance.

---

## 6. Failed attempts are still billed

**Decision.** A `TIMEOUT` or `ERROR` attempt records its tokens and cost like any other.

**Why.** The model was invoked; the spend happened. A pipeline that reports failures as free understates true cost precisely where an engineering lead is looking for waste.

**Benefit.** A re-routed task visibly costs twice, which makes the fallback rate a *financial* metric and not merely an operational one.

**Trade-off.** Total cost exceeds what a naive "cost per successful task" reading expects. Mitigated by exposing per-attempt costs so the split is inspectable.

---

## 7. Unknown task types are accepted; invalid priorities are rejected

**Decision.** A `type` the registry has never seen routes to the General agent with an explanatory `routing_note`. A `priority` outside `HIGH|MEDIUM|LOW` is a hard `400`.

**Why.** These fail differently. An ingestion endpoint fronting thousands of daily workflows should absorb a new document category from an upstream system — the General agent exists for exactly that. A misspelled priority, by contrast, silently changes queue behaviour and would be invisible.

**Benefit.** Resilient ingestion with an explicit audit note, and no silent mis-prioritisation.

**Trade-off.** A genuine client typo (`"TAXX"`) is accepted and quietly generalist-handled instead of bouncing. The `routing_note` makes it visible rather than invisible, which is the compromise.

---

## 8. Two independent fallback loop guards

**Decision.** (a) `fallback_applied` bounds a task to one fallback ever; (b) `selectFallbackAgent()` refuses to route a `GENERAL` agent to itself.

**Why.** An auto-retry that can retry itself is how you build an infinite billing loop. One guard is a single point of failure for a mechanism that spends money.

**Benefit.** Stress-tested with 60 tasks at a 100% failure rate: every task terminates with *exactly* two attempts and zero leaked slots. Guard (b) also covers the case guard (a) misses — a task that *started* on the General agent.

**Trade-off.** Exactly one retry, not a configurable policy. Deliberate: the requirement says re-route to General, and a retry budget is a different feature.

---

## 9. Fallback re-queues as PENDING rather than executing inline

**Decision.** On failure the task returns to `PENDING` reassigned to the General agent, then executes — rather than being run inline regardless of capacity.

**Why.** A correlated outage (a whole agent type failing) produces a burst of simultaneous fallbacks. Running them inline would ignore the General agent's `max_concurrent` exactly when load is highest.

**Benefit.** Capacity holds under a fallback storm — tested with the General agent capped at 1 slot and six simultaneous fallbacks.

**Trade-off.** `POST /:id/execute` can return a task that is `PENDING` again (with `fallback_applied: true`) when the General agent is saturated, rather than a final outcome. We attempt the fallback immediately so the common case still returns terminal, and the dispatcher picks up the parked case.

---

## 10. Server-Sent Events over WebSockets or polling

**Decision.** One `GET /api/events` SSE stream, sending a hydrating `snapshot` frame on connect.

**Why.** Traffic is strictly one-directional. WebSockets add a dependency and a second protocol to debug for capability we don't use; polling is laggy and chatty.

**Benefit.** Native `EventSource` with automatic browser reconnection, no dependency, ~60 lines. The `snapshot` frame means a late-joining or reconnecting dashboard hydrates fully without a separate round of REST calls — no gap where the UI is half-populated.

**Trade-off.** No client→server channel (unnecessary here), a browser six-connection-per-origin cap (irrelevant at one stream), and SSE is invisible to proxies that buffer — handled with `X-Accel-Buffering: no` and a 15s heartbeat.

---

## 11. Metrics are coalesced centrally, not computed per client

**Decision.** A single broadcaster recomputes metrics at most once per ~120ms window and emits one `metrics.updated` event.

**Why.** Seeding 20 tasks fires 20 creation events in one tick. Recomputing the full aggregate 20 times, once per connected client, is pure waste.

**Benefit.** Cost is O(1) per window regardless of client count. Tested: a 3-task burst yields fewer metrics frames than task frames.

**Trade-off.** Up to ~120ms of staleness, which is imperceptible against 1–3s task latencies.

---

## 12. Simulation parameters are env-tunable

**Decision.** `FAILURE_RATE`, `MIN/MAX_DELAY_MS`, `SEED`, `TIMEOUT_SHARE`, `AUTO_DISPATCH` are all configurable, and the RNG is seedable.

**Why.** A 10% random failure rate is untestable and undemonstrable. You cannot assert on fallback behaviour that fires one time in ten, and you cannot show it to a reviewer on demand.

**Benefit.** `FAILURE_RATE=1` makes the fallback path deterministic for both the test suite and the live demo; `FAILURE_RATE=0` pins the happy path; `SEED` makes token and latency draws reproducible. This single decision is what let the suite reach 218 tests without flake.

**Trade-off.** More configuration surface, and `config` is a mutable object so tests can patch it — which would need rethinking under parallel in-process test execution. `--test-concurrency=1` for now.

---

## 13. `node:test` instead of Jest or Vitest

**Decision.** Node 20's built-in test runner. Zero test dependencies.

**Benefit.** Nothing to install, no config file, no transform layer, instant startup — and one fewer supply-chain surface in a project whose brief is an audit tool. Total production dependency count is two (`express`, `cors`).

**Trade-off.** No built-in mocking, snapshots, or coverage thresholds. We needed none: dependencies are injected (`rng`, `sleep`), which is a better testing story than mocking anyway.

---

## 14. App factory rather than module singletons

**Decision.** `createApp()` builds its own registry, store and dispatcher per call.

**Why.** Agent concurrency counters are global mutable state. A slot leaked by one test would silently corrupt the next.

**Benefit.** Fully isolated in-process servers on ephemeral ports; tests run against the real Express app rather than a mock.

**Trade-off.** Wiring must be threaded explicitly through route factories. The `bus`, by contrast, *is* a module singleton — a pragmatic exception that requires care with listener counts across app instances (and is covered by leak tests).

---

## 15. The seed files are parsed leniently, never edited

**Decision.** Both provided JSON files open with a `// filename` comment, so neither is valid JSON. We strip comments at load time and leave the files byte-for-byte as delivered.

**Why.** Editing supplied inputs to make your code work is the wrong instinct; the artefact should consume what it was actually given.

**Benefit.** The provided files work as-is. The stripper is a string-aware scanner, not a regex, because `/\/\/.*$/` would corrupt any URL inside a task payload (`"https://x.com"` → `"https:"`) — there's a test for exactly that.

**Trade-off.** ~60 lines to solve a problem a one-line regex "solves" incorrectly, and we now silently accept comments in files that should not have them. A test asserts the raw files genuinely fail `JSON.parse`, so the premise can't rot.

---

## Bugs this design surfaced during the build

Two defects found and fixed with regression tests, both real rather than test-only:

1. **Open SSE streams made `server.close()` hang forever.** An event stream is a connection that never completes on its own, so graceful shutdown blocked indefinitely — this would have hung on `SIGTERM` in production. Open streams are now tracked and ended during shutdown.
2. **`Dispatcher.kick()` acted on a never-started dispatcher**, because `stopped` defaults to `false`. This silently ignored `autoDispatch: false` and auto-executed tasks callers expected to stay `PENDING`. Background dispatch now requires an explicit `start()`.

---

## What I would do next, given more than 90 minutes

- **Persistence.** Everything is in-memory; a restart loses all history. A real audit pipeline needs durable task records — the store is already behind an interface, so this is contained.
- **Auth and tenancy.** No authentication whatsoever. Fine for a local prototype, unacceptable for anything holding client tax data.
- **Backpressure on ingestion.** The queue is unbounded; a burst large enough would exhaust memory before capacity limits ever bind.
- **A configurable retry policy.** Exactly one fallback is right for this requirement, but real pipelines want per-type retry budgets and exponential backoff.
- **Structured logging with correlation ids.** `console.error` is not an audit log.
- **Frontend tests.** The dashboard is verified manually and by the API contract tests behind it; component-level tests were the deliberate casualty of the time budget.
