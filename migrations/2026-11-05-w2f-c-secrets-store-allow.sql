-- SECRETS-STORE-BIND-1 (2026-11-05, agent W2-F-C, charter pillar security; roadmap row 51 RM-SECRETS-STORE-1; agent_issues 1001969 and 1001981).
-- qnfo-ops 2.65.0 teaches installDeclaredBindings the [[secrets_store_secrets]] table. The decision taken here, so nobody waits on it (DEFAULT-APPROVE-1): a declared store
-- binding goes live ONLY for a name in ops_config secrets_store_bind_allow (comma list of secret names, or worker:secret), and only when the Secrets Store lists the entry with
-- the workers scope. The key is created EMPTY, so the first qnfo-infra deploy after 2.65.0 changes nothing: the store entry CF_API_TOKEN was last modified 2026-07-04, its value
-- cannot be read, and infraSecret prefers the store without a silent fallback (qnfo-infra/secrets-store.test.mjs). This replaces the blind activation that agent_issues 1001981
-- proposed; its code-probe (a secrets_store_secret case in qnfo-ops/worker.js) is satisfied by the same change, and the live binding follows the allowlist, which SECRETS-STORE-ADOPT-1
-- (agent_issues 1001970) fills with the first name once the store entry exists with a value the fleet minted.
-- PREDICTION: no metric moves from this file (one empty config row and two issue notes). After the first allowlisted name and a canonical deploy, cf-ops-actions secrets-inventory
-- lists it in store_bindings_live and declared_not_live is empty; the qnfo-infra snapshot secrets_census.store_bindings reads at least 1.
-- Revert: empty the allowlist (a live binding stays, live wins on type and name) or write the store entry back; the code revert is the canonical revert of the qnfo-ops merge.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM ops_config WHERE key = 'secrets_store_bind_allow' AND coalesce(value, '') = ''; UPDATE agent_issues SET description = substr(description, 1, instr(description, char(10) || 'SECRETS-STORE-BIND-1 2026-11-05') - 1) WHERE id IN (1001969, 1001981) AND instr(description, char(10) || 'SECRETS-STORE-BIND-1 2026-11-05') > 0
-- CAUSE-MAPPED: registers no metric.
-- spof-review: adds no worker, cron, D1 trigger, route or credential; it writes one ops_config row (empty), two issue notes and one decision_log row.

INSERT OR IGNORE INTO ops_config (key, value, note)
VALUES ('secrets_store_bind_allow', '', 'SECRETS-STORE-BIND-1 (qnfo-ops 2.65.0, 2026-11-05): comma list of Secrets Store secret names (or worker:secret) whose declared [[secrets_store_secrets]] binding the canonical deploy may install. Empty = none. A name is added only after its store entry exists with the workers scope and a value the fleet minted; revert by emptying it.');

UPDATE agent_issues
SET description = description || char(10) || 'SECRETS-STORE-BIND-1 2026-11-05: qnfo-ops 2.65.0 (agent W2-F-C) parses [[secrets_store_secrets]] in installDeclaredBindings (secretsStoreBinding, parseSecretsStoreAllow, selectSecretsStoreBindings, resolveSecretsStoreBindings; suite qnfo-ops/secrets-store-bind.test.mjs, 135 checks). The binding is installed only for a name in ops_config secrets_store_bind_allow (created empty by migrations/2026-11-05-w2f-c-secrets-store-allow.sql) that the store lists with the workers scope; an unreadable allowlist, an unreadable store or a missing entry skips it with a note in the deploy ledger row and never fails the deploy, and a deploy Cloudflare refuses is sent once more without the store bindings it added. Nothing is bound until a name is allowlisted. The live gate (store_bindings_live in cf-ops-actions secrets-inventory) follows the first allowlisted name, which is SECRETS-STORE-ADOPT-1 (agent_issues 1001970).'
WHERE id = 1001969 AND instr(description, char(10) || 'SECRETS-STORE-BIND-1 2026-11-05') = 0;

UPDATE agent_issues
SET description = description || char(10) || 'SECRETS-STORE-BIND-1 2026-11-05: the case exists (qnfo-ops 2.65.0, see agent_issues 1001969). The activation note above is replaced by the allowlist: the first qnfo-infra deploy after the case lands binds nothing, because ops_config secrets_store_bind_allow is empty and the CF_API_TOKEN store entry (last modified 2026-07-04) may hold a rotated-out value that infraSecret would prefer without a fallback. qnfo-infra binds CF_TOKEN_STORE when CF_API_TOKEN is allowlisted after the entry is refreshed (SECRETS-STORE-ADOPT-1, agent_issues 1001970).'
WHERE id = 1001981 AND instr(description, char(10) || 'SECRETS-STORE-BIND-1 2026-11-05') = 0;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:w2f-c',
 'binding the existing Secrets Store entry CF_API_TOKEN to qnfo-infra blind could move it to a stale or rotated-out token, because infraSecret prefers the store and does not fall back',
 'SECRETS-STORE-BIND-1: qnfo-ops installDeclaredBindings installs a declared [[secrets_store_secrets]] binding only for names in ops_config secrets_store_bind_allow (created empty)',
 'secrets-inventory run 41934447956 (2026-11-04): 39 workers, 112 secret_text bindings, 0 store bindings, 30 store entries, 25 older than 90 days; CF_API_TOKEN entry modified 2026-07-04; qnfo-infra/secrets-store.test.mjs pins no silent bypass',
 'the first qnfo-infra deploy after qnfo-ops 2.65.0 binds nothing and behaves as before; a name binds only after an explicit allowlist entry',
 'one ops_config row; the canonical deploy of every worker that declares [[secrets_store_secrets]] (qnfo-infra today)',
 'empty ops_config secrets_store_bind_allow; revert the qnfo-ops merge through the canonical revert path; a live binding is removed by redeploying without it',
 'a fleet-minted credential can move into the Secrets Store and rotate with one PATCH once SECRETS-STORE-ADOPT-1 fills the allowlist',
 'secrets-inventory store_bindings_live stays empty and qnfo-infra /health stays ok after the next qnfo-infra deploy; it lists the first name only after allowlisting',
 'no external reach change',
 'offline vm suite qnfo-ops/secrets-store-bind.test.mjs (installer and deploy paths against recorded Cloudflare and GitHub calls)'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'session:w2f-c' AND action LIKE 'SECRETS-STORE-BIND-1:%');
