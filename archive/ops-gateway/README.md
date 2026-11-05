# ops-gateway

Canonical repo mirror (FLEET-CONTROL-NO-REPO-MIRROR-1), captured 2026-09-19 from the deployed
CF bundle (script `ops-gateway`). Version **1.0.1**.

A thin OpenAI-compatible proxy that forwards `/v1/chat/completions` to the account AI Gateway
compat endpoint (`default` route). No bindings required.

Status: **UNREFERENCED** — a 2026-09-19 scan of all 51 fleet workers found ZERO service/name
bindings pointing at `ops-gateway`, and its public URL returns 404. Registry previously recorded
version `0.1.0` (drift vs the live `1.0.1`).

With this mirror in place the worker is retirable under FLEET-GHOST-RETIREMENT-1 without losing
the only copy of its source.
