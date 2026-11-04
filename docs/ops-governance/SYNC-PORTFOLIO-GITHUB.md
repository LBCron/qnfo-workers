# SYNC-PORTFOLIO-GITHUB.md — Public Ledger Sync

Public transparency ledger: Cloudflare (canonical) → GitHub (public mirror), one-way.

## Architecture

| Layer | Store | Endpoint / Path |
|:------|:------|:----------------|
| Canonical | D1 `portfolio-state` | Cloudflare REST `d1/database/d80fdf2a-0a60-45a3-968b-2907ce806dcd/query` |
| Canonical | QNFO Knowledge Graph | `https://graph-api.qnfo.org/query` (SQL over `nodes`/`edges`) |
| Mirror | Board #7 "QNFO Public Program Board" (public) | https://github.com/orgs/QNFO/projects/7 |
| Mirror | `PORTFOLIO.md` (full inventory snapshot) | `QNFO/.github/PORTFOLIO.md` |
| Mirror | Org profile README | `QNFO/.github/profile/README.md` |

**Mechanism:** cronjob **"QNFO GitHub Board Sync (weekly)"** (Sat 06:00 UTC, id `90e6cff6`)
→ runs `scripts/qnfo_github_board_sync.py`.

**Direction & safety:** one-way Cloudflare → GitHub. The sync is **idempotent** (dedups by WBS
key extracted from title) and **NEVER deletes board items** — drift is reported, not force-reconciled.

## Regenerating PORTFOLIO.md

`PORTFOLIO.md` is a curated snapshot of the KG: 21 programs, 150 projects, 77 KEPLER tasks,
21 phases, 21 open items. To refresh, re-query the KG `nodes` table (`Program` / `Project` /
`Task` / `Phase` / `OpenItem` labels) and regenerate the tables.

> **NOTE:** `PORTFOLIO.md` regeneration is **not yet** part of the weekly board sync — see follow-ups.

## Known drift (snapshot 2026-08-13)

1. **ACRP** (Adelic Core Research Program, ACRP-01..08) and **KEPLER** (10-phase master roadmap)
   are active in the KG but not WBS-coded in `WBS.TAXONOMY.md`.
2. **Portfolio API** `qnfo-data-api.q08.workers.dev/v2` → HTTP 404 (down). KG is the fallback source.
3. Sync dedup is **program-level** (WBS key only); project-level name variants can duplicate
   (e.g. `QNFO.UMP.003` appears as both `—` and `-`).
4. KG has 6 `task-*` nodes mislabeled as `OpenItem` (analytics-infrastructure, knowing-patterns-refactor).

## Follow-ups

- [ ] Fold `PORTFOLIO.md` + README programs-table regeneration into `qnfo_github_board_sync.py`.
- [ ] Decide WBS registration for ACRP + KEPLER (they are active, but may map to ADL / a roadmap, not new programs).
- [ ] Repair or replace the Portfolio API (OI-004).
- [ ] Tighten sync dedup to project level (prevent hyphen/em-dash duplicates).
