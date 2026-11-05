# Owner emergency AI control

Charter pillars: `cost`, `autonomy`, `security`. Program: QNFO.OPS.

This is an explicit authenticated-owner override, separate from ordinary soft
spend budgets. It stops **new integrated dispatches**, not requests already
accepted by a provider. Implementation on a branch is not a deployment or an
account-wide Cloudflare spending cap.

## Status of this repository (2026-11-05)

The design below is the whole feature. What is on main with this document is the **authority half only** (OWNER-AI-CONTROL-SLICE-1, GitHub issue 6631):

| part | state |
|:--|:--|
| revisioned singleton `fleet_ai_control` + append-only audit in qnfo-audit (`migrations/2026-11-03-owner-ai-control.sql`) | in this slice |
| qnfo-deploy-guard routes `GET /ai-control`, `POST /ai-control/pause`, `POST /ai-control/resume`, trusted `GET /ai-control/check` (Cloudflare Access RS256 JWT verified in the Worker, first-primary D1 reads, compare-and-set resume) | in this slice |
| shared dispatch gate `_shared/fleet-ai-control.js` and its unit test | in this slice, **not yet inlined into any caller** |
| the owner routes need `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` and `OWNER_EMAILS` on qnfo-deploy-guard | **not set**: until an OTP-only Access application exists and these are pinned, every owner route answers 503 `owner_auth_unavailable` (fail closed) |
| the 22 caller integrations, `scripts/fleet-ai-control-sync.mjs`, the coverage test (`scripts/fleet-ai-control-coverage.test.mjs`), the `repo_content_index.py` check, the dashboard UI | **not in this slice**; tracked as ROADMAP-1 rows (see GitHub 6631) |

So nothing here pauses any dispatch yet: the authority can be read and written by an authenticated owner, and no caller consults it. The coverage test must stay failing, and the feature must not be presented as fleet-wide, until the callers (qnfo-ops and qnfo-research-exec included) are integrated and verified.

## Authority and dashboard contract

The existing `qnfo-deploy-guard` Worker owns the only state, the
`qnfo-audit.fleet_ai_control` singleton. No dashboard-local authoritative flag,
KV cache, process-global allow cache, or Gateway budget substitutes for it.
The migration also creates append-only `fleet_ai_control_audit` records.

| Request | Authorization | Body / result |
|---|---|---|
| `GET /ai-control` | Verified owner Access assertion | Current state, including while paused |
| `POST /ai-control/pause` | Verified owner Access assertion | `{ "reason": "..." }` |
| `POST /ai-control/resume` | Verified owner Access assertion | `{ "reason": "...", "expected_revision": 7 }` |
| `GET /ai-control/check` | Deployment-trusted HTTP service-binding caller props | Running: 200; paused/unavailable: 503 |

Successful owner responses and running check responses have this schema:

```json
{
  "ok": true,
  "paused": false,
  "revision": 8,
  "updated_at": "2026-11-03T00:00:00.000Z",
  "reason": "Explicit owner resume",
  "actor": "owner:<Access subject>"
}
```

Paused checks return `ok: false`, `error: "ai_paused"` and the paused state.
Control failures return HTTP 503 with
`{ "ok": false, "error": "ai_control_unavailable", "paused": true }`.
These responses are `Cache-Control: no-store`; a failure is never permission
to spend. Owner authentication can independently return `owner_auth_required`
(401), `owner_forbidden` (403), or `owner_auth_unavailable` (503).

Every pause increments the revision, even if already paused. Resume is a single
conditional `UPDATE ... WHERE revision = expected_revision RETURNING ...`.
A stale resume receives HTTP 409 with
`{ "error": "ai_control_conflict", "state": { ... } }`; it cannot undo a newer
pause. The client must display fresh state and obtain another explicit resume.
Integer revisions are not coerced from strings, booleans or null.

The separate dashboard Worker forwards `Cf-Access-Jwt-Assertion` to the owner
endpoints. Both Workers require matching `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`,
and comma-separated `OWNER_EMAILS`. The authority independently verifies RS256,
issuer, audience, signature, expiration/not-before, subject and owner email.
Forwarding an email header is insufficient. Neither mutation is exposed by
permissive CORS. Dashboard same-origin/JSON checks complement, rather than
replace, the authority's JWT validation.

Dashboard service declaration:

```toml
[[services]]
binding = "AI_CONTROL"
service = "qnfo-deploy-guard"
props = { caller = "qnfo-fleet-dashboard-ui" }
```

HTTP binding props arrive as `ctx.props.caller`, not as a request header.
Public header spoofing does not authenticate `/ai-control/check`. A trusted
service check does not authorize owner status or mutations. The separately
implemented dashboard uses Wrangler 4.156.2 for props support and checks before
each Lee model and agent-tool dispatch, as well as chat entry.

## Enforcement and coverage

`_shared/fleet-ai-control.js` is inlined into single-file deployments by
`scripts/fleet-ai-control-sync.mjs`. Each dispatch opens its own
`withSession("first-primary")` and reads the singleton from **qnfo-audit**,
using the host's explicitly declared audit binding. A previous successful read,
a request-local session or sequential consistency alone is insufficient.
Missing binding/table/state, invalid state, exceptions and a three-second read
deadline all refuse dispatch.

The acquired implementation covers 22 Worker directories:

`idea-hub`, `personal-api`, `personal-companion`, `q08-signal-engine`, `qnfo-ai`,
`qnfo-ai-calibration`, `qnfo-ai-search`, `qnfo-cloud-ops`,
`qnfo-code-orchestrator`, `qnfo-email`, `qnfo-fleet-control`,
`qnfo-fleet-dashboard`, `qnfo-gateway`, `qnfo-infra`,
`qnfo-intent-orchestrator`, `qnfo-ipatent`, `qnfo-jobsearch`,
`qnfo-lifecycle`, `qnfo-memory-mcp`, `qnfo-model-eval`, `qnfo-social`,
and `qnfo-youtube-shorts`.

The dispatch inventory includes Workers AI binding calls, attribution proxy
calls, known direct provider/Gateway HTTP invocations, AI Search upload/search,
and known internal inference service calls. Gateway HTTP uses a request-aware
transport instead of an opaque wrapper; its existing two bounded transient-error
retries now each require a new primary check.
Agent-tool entrypoints in the router and personal twin also check independently.
Pause/unavailable exceptions are terminal for model/provider fallback; an
upstream emergency HTTP 503 carries `x-fleet-ai-control` and is rethrown as a
terminal control error by the shared transport.

`scripts/repo_content_index.py` independently checks the same D1 singleton
through primary D1 REST queries before each embedding call. It does not create
a second authority.

The external `rwnq8/qnfo-fleet-dashboard` deployment is a separate integration,
not the similarly named directory in this repository. Its local UI implementation
was reported at commit `5f5e7df`; it must be deployed with the binding above.
The repository coverage test cannot attest to that external deployment.

The inventory test is deliberately fail-loud for the two held source gaps.
Retired/folded standalone deployments and arbitrary external clients, other
accounts, untracked provider endpoints, future callers, and direct console/API
use are not magically controlled. A new AI transport must join this inventory.

## Pause and restart behavior

Scheduled entrypoints defer before taking work. They do not enqueue replacement
events or replay missed ticks on resume. Existing task queues and their normal
batch/concurrency limits remain in place; resume does not bulk-drain them.
Normal pending work can subsequently run at the existing cadence.

The personal twin's Durable Object alarm leaves schedules pending and rearms
once for ten minutes when paused or unavailable. A control error after a task
was claimed restores that task to pending instead of marking it failed.
Ordinary errors retain existing error handling.

The companion generation workflow uses durable ten-minute sleeps and separate
fresh control-read steps. Model generation has no automatic Workflow step
retry. A mid-generation control error records a deferred attempt and waits
before a new attempt; successful generation is not repeated merely because
publication is waiting. Publication has its own control wait. Existing
concurrent instances remain concurrent; this is not a global concurrency cap.

**The qnfo-ops queue/workflow/alarm integration is not persisted while its source
is claimed.** Its proposed patch requires holder integration and verification
against the existing D1 job ledger, retry limits and DLQ. Do not rely on that
proposal as production queue protection or assume repeated queue retries
preserve a job indefinitely.

There is an unavoidable interval between a primary permission read and the
subsequent dispatch. A pause can arrive inside that interval. Already dispatched
HTTP/streaming/inference requests and asynchronous work already submitted to
Cloudflare/provider systems may finish and incur cost. This control does not
cancel provider requests, delete resources, revoke credentials or suppress all
non-AI Cloudflare charges. D1 reads and durable sleep/alarm wakeups themselves
also have platform cost. There is no zero-residual-spend promise.
Provider-managed retries or fallback inside an already accepted operation
cannot consult this gate and are part of that in-flight limitation.

## Verification and rollout

Local regression commands:

```powershell
node qnfo-deploy-guard\ai-control.test.mjs
node _shared\fleet-ai-control.test.mjs
node _shared\fleet-ai-dispatch.test.mjs
python scripts\repo_content_index_ai_control_test.py -q
node scripts\fleet-ai-control-sync.mjs --check
node scripts\fleet-ai-control-coverage.test.mjs
python scripts\apply_migrations.py --check
python scripts\narrative-prompt-guard.py
```

The authority suite exercises signed owner JWTs, audit behavior, invalid
requests and stale-resume CAS. Dispatch regressions drive the real router's
attribution/fallback functions, preserve folded audit bindings, exercise
same-request state changes, provider/service checks, deferred alarms, and
workflow control waits. Older unrelated model/SQL suites explicitly use a
running fixture; they are not evidence of emergency enforcement.

`qnfo-deploy-guard/ai-control-runtime.mjs` runs the **actual authority Worker**
with local D1 and signed Access/JWKS fixtures in workerd. Install
`miniflare@5.20261102.0-beta` into a temporary directory, then run:

```powershell
node qnfo-deploy-guard\ai-control-runtime.mjs "<temporary-directory>\node_modules\miniflare"
```

The persisted integration passed 39 assertions with Miniflare
5.20261102.0-beta / workerd 1.20261102.1, including real service props delivery,
public spoof rejection, owner state transitions, stale resume, audit entries,
and missing-table fail-closed behavior. Local D1 executes the first-primary
Sessions API path, but cannot prove physical production replica selection.

No rollout or production pause was performed for this build. Before rollout:

1. Integrate the held callers; make coverage, mirrors and relevant regression
   checks pass. Confirm every intended deployed caller and numeric version.
2. Apply the migration through the canonical CI migration runner and verify its
   successful ledger entry. Initial singleton creation is running, not paused;
   reapplication never resets an existing owner decision.
3. Configure the matching Access values and deploy the authority first through
   the canonical workflow. Verify owner authorization, state and audit without
   pausing production as an unrequested test.
4. Deploy the integrated callers and the external dashboard's service binding.
   Callers deployed before the singleton exists refuse AI rather than spend.
5. Verify the actual deployed inventory and primary-read behavior. Any live
   pause/resume exercise needs explicit operational authorization and must
   account for in-flight work and preserved queues.
