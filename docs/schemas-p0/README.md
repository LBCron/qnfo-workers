# qnfo-schemas — QNFO Code-Parsable Artifact Registry

> **Self-doc header (FLEET-SELF-DOC-1)**
> Purpose: single source of truth for QNFO code-parsable artifact schemas + validators.
> Capabilities: JSON Schema registry (envelope + kind payloads), deterministic validators (Python functional, TS mirror), gate-manifest bootstrap.
> Canonical source: this repo (QNFO/qnfo-schemas). R2 mirror: bucket qnfo-schemas (P1).
> Scope record: QNFO.CODEPARSE.SCOPE.v1 (this repo, SCOPE.v1.json).

## What this is

Implements P0 (foundation) of QNFO.CODEPARSE.SCOPE.v1: every instruction, chat, prompt, skill,
and response gets a versioned, schema-bound, machine-parseable representation (dual-representation:
canonical parseable form authoritative, human markdown rendered from it).

## Layout

- SCOPE.v1.json — the canonical scoping record (kind=scoping-record).
- schemas/envelope.json — universal envelope (schema_version, kind, id, ts, provenance, payload).
- schemas/message.json — chat message payload (role enum, text, model, conversation_id, tool_calls).
- schemas/plan.json — task plan payload (items[]: step/status enum/wbs_code).
- schemas/finding.json — adversarial finding payload (severity enum, evidence, status, claim_sheet).
- schemas/gate-manifest.json — mandatory-gate manifest payload (gates[]: id/version/status/description/evidence_pointer).
- schemas/event.json — ops event payload (kind, source, note, data).
- gates/bootstrap-manifest.json — bootstrap subset of active gates (17), kind=gate-manifest.
- validate.py — deterministic validator (jsonschema Draft-07). Exit 0 iff all pass.
- validate.ts — TypeScript mirror; envelope checks functional, payload via ajv in P1.
- examples/ok/*.json — positive samples (must PASS; sweep exits 0).
- examples/bad/*.json — negative samples (must FAIL; each exits 1).

## Usage

    python validate.py examples/ok/message.ok.json      # PASS, exit 0
    python validate.py --dir examples/ok SCOPE.v1.json --gate-manifest   # positives-only sweep, exit 0
    python validate.py --dir examples/bad                # negatives sweep, exit 1
    python validate.py examples/bad/message.bad-missing-version.json   # FAIL, exit 1

## Conventions

- sha256 in provenance covers the canonicalized payload (json.dumps(payload, sort_keys=True, separators=(",", ":"))).
- Unknown schema_version is rejected (D5). Unknown kind: envelope-only validation (permissive edges, strict canonical keys).
- Posture: advisory (warn) on ingress; blocking (reject) at canonical-store writes (SCOPE.v1 architecture).

## Status

P0 executed 2026-09-09. Server-side wiring (ops_ai_log persist validation) deferred to
task_dod_register dated row — qnfo-ops live 2.6.1 is ahead of repo 2.5.1 (DEPLOY-LAST-WINS-RECONCILE-1).
