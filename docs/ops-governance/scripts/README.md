# qnfo-ops/scripts — Ops Toolbox (bootstrapped 2026-08-05)

Per the thin-client mandate (KIF-32), reusable ops scripts live here in git and
NEVER persist on the local filesystem. The local machine is a thin client: any
script that exists ONLY locally is a violation.

## Lifecycle (HOW)

1. Need a script? -> Check this dir first.
2. Not here? -> Write it, commit to qnfo-ops/scripts/ (same-turn commit), then
   clone-to-TEMP to run.
3. Here? -> Clone to %%TEMP%%, run, DELETE the clone (same turn). Use the
   `\\?\` + rmtree pattern to clear read-only git pack files, or chmod-sweep first.
4. One-shot logic? -> Write to %%TEMP%% and let it die. NEVER commit throwaways.

## Rules

- Skill-bound scripts (e.g. bloat-cleanup's 26 scripts) live in QNFO/qnfo-skills
  under skills/<name>/scripts/ — NOT here. This dir is for CROSS-CUTTING ops tools
  that no single skill owns.
- qnfo-ops is governance (AUDT/HAND/PLCY/SKIL/WBS). scripts/ is the executable
  toolbox layer added per the thin-client mandate.
- Every session ends with: no local-only files (bloat-cleanup pre-closeout scan).

## F2: default-gateway Claude Code model guard (#8)

`model_guard.py` already guards Claude Code's user prompt and runs in the
`QNFO-ModelKey-Guard` cycle. It now also repairs **existing**
`~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`) when its
`env.ANTHROPIC_BASE_URL` selects Cloudflare's `default` Anthropic/compat gateway.
It pins the model and picker to `claude-sonnet-5.5`, remaps the Opus alias to
Sonnet, and repairs explicit Opus subagent/legacy fast-model overrides.
Credentials, gateway URL, permissions, cheaper fast models and other clients
are preserved. Opus must not be restored without explicit owner approval.
The guard emits client/gateway identity and changed **field names**, never
credentials or configuration contents, and verifies the settings after writing.

Evidence boundary: Claude Code is a candidate explicitly present in the
existing guard, **not a confirmed identification of the October caller**.
This checkout contains no Opus selector, opencode configuration or
Anthropic-calling Node script. A bare `node` user-agent without metadata cannot
distinguish those clients. The cited October closeout is absent from this
checkout. Fleet/claim hosts failed DNS resolution in the cloud sandbox and
Cloudflare API MCP tools were unavailable, so gateway logs, owner-machine
settings and billing could not be read. No live configuration or budget was
changed by this branch.

Deployment uses the existing guard execution/mirror procedure; committing
this file does not update the owner's running client. User settings also do
not override higher-priority project/managed settings, shell configuration or
explicit CLI/SDK model choices. Those sources must be inspected during caller
attribution; this guard is not a gateway-wide Opus ban.

Closing probe for #8: correlate resumed default-gateway Anthropic requests
with the actual client configuration and gateway request timestamps, record
that attribution in the issue, verify no Opus requests, then measure the
Anthropic rolling 30-day spend/run-rate below **$60/month**. Sonnet selection
alone does not guarantee that spend target or change the existing $180 cap.
Leave attribution and spend acceptance unverified until these live reads pass.

Focused validation (standard-library unittest; no provider calls):

```sh
python -m unittest discover -s scripts -p 'test_model_guard.py' -v
```
