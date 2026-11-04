# Paper ledger and withdrawal guard (PAPER-LEDGER-1, PAPER-WITHDRAW-GUARD-1)

Owner directive 2026-10-26: "papers should never disappear en masse; versioning needs to preserve changes across multiple revisions for auditing and provenance."
The DDL is in `migrations/living-paper/` (applied to the living-paper D1 on 2026-10-26 after a 42-case test on a scratch D1 built from production's own DDL).
The registers are `migrations/2026-10-26-paper-ledger-1.sql`.

## What is kept

Every insert, update and delete on `papers` that changes the body, status, version, title, abstract, slug, identifier or the bibliographic metadata writes one row to
`paper_change_ledger` (immutable): the fields changed, version, status and gate reason before and after, body length and a fingerprint before and after, the prior
title, abstract and metadata, the actor and the reason. The full prior body is in `paper_change_bodies` under the same `seq`. The legacy archive
(`paper_version_history`) keeps one body per (slug, version) and stays as it was; the ledger is the record.

```sql
SELECT * FROM v_paper_revisions WHERE slug = '<slug>' ORDER BY seq;      -- the chain of changes to one paper
SELECT * FROM v_paper_withdrawals_24h;                                   -- who moved papers out of public status
SELECT * FROM v_paper_ledger_health;                                     -- volume, unattributed share, withdrawals in the hour and day
SELECT body_md FROM paper_change_bodies WHERE seq = <seq>;               -- the body a change replaced
```

## Writers set who and why

A writer sets `papers.change_actor` (`<worker>:<run id>`) and `papers.change_reason` in the same UPDATE. Use text that differs for each change: the same pair twice in a
row reads as unattributed. A change that does not set them is recorded as `unattributed` (`v_paper_ledger_health.unattributed_24h`). Adopted so far: this session's
repairs and qnfo-cloud-ops 1.37.0 (the publication gate's restore from quarantine, `qnfo-cloud-ops:<run id>`; its verdict-only writes touch `release_gate_*` alone, which the ledger does not record, because `publication_gate_audit` holds them). Open: PAPER-LEDGER-ATTRIBUTION-2 (qnfo-research-exec and qnfo-errata-publish).

## Nothing disappears en masse

`trg_papers_mass_withdraw_guard` refuses a status change that takes a 26th paper out of published, distributed or external_preprint within an hour (or an 81st within a day);
`trg_papers_mass_delete_guard` refuses a 6th `DELETE FROM papers` within an hour. A refused statement raises `MASS-WITHDRAWAL-BLOCKED` (or `MASS-DELETE-BLOCKED`) and a D1 batch
containing it rolls back whole. A larger withdrawal that is intended (a deduplication sweep, a retraction of a whole series) first inserts a row:

```sql
INSERT INTO paper_withdrawal_override (expires_at, max_papers, reason, created_by, scope)
VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now','+2 hours'), 60, '<why, and who decided>', '<worker or session>', 'withdraw');   -- scope 'delete' for deletes
```

An override needs a reason and a creator, covers at most 500 papers, expires within 24 hours, and can never be edited or deleted. Restores (to published) are not withdrawals and
are never counted. The publication gate itself no longer withdraws any paper (`pub-gate-v4-no-withdraw`); it marks a failing paper for revision and leaves it published.

## Bodies and size

Stored bodies grow by roughly 50 KB per revision (881 rows held about 44 MB on 2026-10-26). A row of `paper_change_bodies` can be deleted only after `paper_change_body_archive` holds an
off-database copy of the same size (a trigger enforces it). Since qnfo-cloud-ops 1.38.0 (PAPER-LEDGER-ARCHIVE-1) the hourly quality sweep archives the oldest bodies once the table exceeds 300 MB:
it writes the text unchanged to the `qnfo-releases` bucket as `paper-ledger/<seq>.md`, reads the object back and compares its SHA-256, then inserts the proof (`r2_key`, `bytes` = SQLite
`length()`, `fingerprint` = `sha256:<hex>`) and deletes the stored body in one atomic batch. To read a revision, take `body_md` from `paper_change_bodies`; if the row is gone, `r2_key` in
`paper_change_body_archive` names the object, and `paperLedgerBody(env, seq)` in qnfo-cloud-ops returns either with the fingerprint checked. Ledger rows themselves are never removed.
Detector `fm-paper-ledger-bodies-unbounded` fails above 330 MB.

## Rollback

`DROP TRIGGER paper_ledger_ai, paper_ledger_au, paper_ledger_ad, trg_papers_mass_withdraw_guard, trg_papers_mass_delete_guard` (one statement each). The tables, views and data stay.

## Also found while building it

`papers_fts` (the full-text index) failed its integrity check in production because `papers_au` ran an FTS5 delete on every update; see
`migrations/living-paper/2026-10-26-papers-fts-drift.sql`. A new trigger on `papers` must not issue an FTS statement for an update that leaves `title` and `abstract` alone.

## Stored shape (PAPER-CANONICAL-1)

Owner directive 2026-11-04: a revised paper looks like a new release, and the earlier text stays verbatim. `papers.body_md` holds only `# Title`, an optional italic subtitle, `## Abstract` and the paper: no YAML front matter, byline or metadata block, repeated or wrapped title, in-body Version History, Changelog, correction notice or revision banner (`_shared/paper-canonical.js`, inlined into qnfo-research-exec between the `PAPER-CANONICAL-1` markers by `node _shared/inline-paper-canonical.mjs`). Every writer stores that shape (`canonicalBody`), and `paperFormatTick` rewrites the stored corpus 100 papers a tick: it sets `change_actor` and a per-paper `change_reason`, so the ledger keeps the previous body in `paper_change_bodies`; it leaves `updated_at`, `version` and `last_revised_at` alone and puts the new text in the R2 mirror (the git copy follows through `repoSyncTick`). A body that would lose more than 35 percent of its words, a reference list or unexplained headings is refused and listed in `ops_config paper_format_state` (`refusedList`, `lastSweep.refused`). Owner-written `qnfo-2025-*` papers keep a history section that is their own text. Who changed what, and when, is read from `v_paper_revisions`, `paper_revision_log` and the Versions tab.

## Reading the record (PAPER-HISTORY-1, qnfo-gateway 3.56.0)

Owner directive 2026-11-04: every edit of a paper keeps its full version information, earlier versions stay verbatim, the Versions tab shows what changed (not only raw text), and each paper links to the
files kept about it. The gateway reads the ledger above; nothing new is stored.

| URL (papers.qnfo.org/papers/<slug>/...) | What it shows |
|---|---|
| `history` | every version (date, size, SHA-256, verbatim text, "what changed" link) and every ledger change (when, version, fields, why, by, size) |
| `diff?from=v1.0.0&to=current` | paragraph + word diff of the Markdown; refs are `current`, `v<semver>`, `c<seq>` (the text before ledger change seq) or `s<id>` (a `paper_version_history` snapshot) |
| `diff?change=<seq>` | what one ledger change did (raw source view; `&view=clean` ignores front matter, byline, repeated title, in-body version history) |
| `files`, `files.json`, `ro-crate-metadata.json` | the record as a repository keeps it: files with size and SHA-256, earlier versions, the `QNFO/qnfo-research` directory (`papers/<slug>`, read from its `provenance.json`), the research runs pinned to their commit (`research_run_ledger`), other QNFO papers linked, as an RO-Crate 1.1 |
| `history.json` | the same versions and changes as JSON |

Limits: the ledger starts 2026-10-26, so older versions come from `paper_version_history` (one body per version); a ledger body archived off-database (`paper_change_body_archive`) is read from `RELEASES paper-ledger/<seq>.md`, and
shown as not held when neither is readable; at most 80 recent changes are listed. Suite: `node qnfo-gateway/paper-history.test.mjs`. Rollback: remove the `paperHistoryRoutes` hook in `serve`; the Versions tab links then 404 and nothing else changes.
