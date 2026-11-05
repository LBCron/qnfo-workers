# qnfo-citation-watch

> Version: 1.0.0 (canonical repo copy of the deployed bundle 2026-09-03)
> Purpose: citation watch for the QNFO known-DOI set (OpenAlex cited_by_count + citing works)
> Capabilities: scheduled cron sweep (R2 VAULT notes/v1/YYYY/MM/DD/_citation-watch-*.md) +
>   /health + /run endpoints on workers.dev
> Deploy method: CF API bundle upload (workers.dev subdomain route re-enabled 2026-09-03 via
>   POST /accounts/{acct}/workers/scripts/qnfo-citation-watch/subdomain {enabled:true})
> Bindings: VAULT (R2) - writes markdown notes
> Canonical source: qnfo-workers/qnfo-citation-watch/worker.js (byte-matches the deployed bundle)
> Health: /health -> {"ok":true,"worker":"qnfo-citation-watch","version":"1.0.0"} HTTP 200
> Note: KNOWN_DOIS is a hardcoded 5-DOI set (legacy design). Corpus-wide citation sweep is
>   qnfo-ops/scripts/citation_sweep.py + qnfo-cloud-ops weekly job; consider moving this worker
>   to a dynamic corpus read in a future cycle (2026-09-03).
