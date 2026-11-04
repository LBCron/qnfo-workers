# GitHub Management Scripts

Operational scripts for managing QNFO and rwnq8 GitHub accounts.
These are the canonical reusable scripts — never rely on `%TEMP%` copies.

## Script Inventory

| Script | Purpose | When to Run |
|:-------|:--------|:------------|
| `star_audit.py` | Fetch all stars, classify by QNFO taxonomy, generate KEEP/DUMP report | Quarterly star audit, new program onboarding |
| `star_batch.py` | Batch star/unstar from classification JSON or curated lists | After audit, when adding new research repos |
| `label_manager.py` | Create/clone/verify standardized labels across all 7 QNFO program repos | New repo onboarding, label taxonomy updates |

## Quick Start

```bash
# Clone this repo to temp (one-shot, thin-client compliant)
git clone https://github.com/QNFO/qnfo-ops.git %TEMP%\qnfo-ops

# Star audit
python %TEMP%\qnfo-ops\scripts\github-management\star_audit.py --account rwnq8

# Label verification
python %TEMP%\qnfo-ops\scripts\github-management\label_manager.py --verify

# Clean up (thin-client mandate)
rmdir /s /q %TEMP%\qnfo-ops
```

## Authentication

All scripts use `gh` CLI for authentication. The active gh account determines
which GitHub account operations target:

- `rwnq8` (personal): Agentic AI toolkit, dev tools, personal experiments
- `QNFO` (org): Research-pure repos (quantum, ultrametric, number theory)

To switch: `gh auth switch`

## Architecture

Scripts follow the thin-client mandate:
1. Read-only discovery → query GitHub API directly (no local state)
2. Mutating operations → batch with rate limiting
3. No local file persistence → outputs go to stdout or optional `--output` flag
4. Scripts themselves live in git → clone, run, delete clone

## Canonical Locations

| Script type | Where it lives |
|:------------|:---------------|
| GitHub management | `QNFO/qnfo-ops/scripts/github-management/` (here) |
| Skill-specific | `QNFO/qnfo-skills/<skill>/scripts/` |
| Cloudflare infra | `QNFO/qwav-platform/scripts/` |
| Research analysis | `<program-repo>/scripts/` |
| Issue templates | `QNFO/.github/ISSUE_TEMPLATE/` |

## Thin-Client Compliance

> Local filesystem is ephemeral. Scripts in %TEMP% die with the session.

- **Clone → Run → Delete:** Every script invocation clones from git, runs, then cleans up
- **Never save to local:** No `.py` files survive beyond the session that created them
- **Commit after creation:** New scripts are committed to this repo in the SAME session
- **One-shot scripts:** Throwaway logic goes to %TEMP% and is intentionally not committed

## Related Resources

- Keyword taxonomy: `QNFO/qnfo-research:docs/QNFO-KEYWORD-TAXONOMY.md`
- WBS taxonomy: `docs/WBS.TAXONOMY.md` (parent directory)
- Memory recall: `memory_recall({query: "QNFO keyword taxonomy"})`

---

Version: **v1.0** — 2026-08-05
