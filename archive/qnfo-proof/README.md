# qnfo-proof - adversarial proof verification ledger

Server-side port of the vibefeld protocol (tobiasosborne/vibefeld, MIT).
Provers convince, verifiers attack. Lamport-style hierarchical proofs with
taint tracking and a SHA-256 hash-chained event ledger in qnfo-audit D1.

- Auth: mutations require X-Proof-Token == PROOF_TOKEN secret (fail closed).
- Taint: vibefeld semantics (admitted/pending/needs_refinement propagate;
  archived/refuted severed; upward taint never re-flows down).
- Guards shipped: self-accept refusal, archive-with-open-challenge refusal,
  resolve-by-raiser refusal, hash chain.
- Trust model: validated/clean = adversarially accepted natural language,
  NOT formal proof.
- Self-registers to the qnfo-ops service registry on /health.
