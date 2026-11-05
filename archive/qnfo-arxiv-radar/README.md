# qnfo-arxiv-radar

> Self-doc header (FLEET-SELF-DOC-1)
> Purpose: arXiv watch to outreach_queue
> Canonical source: this directory (QNFO/qnfo-workers)
> Version: worker.js VERSION + /health (see fleet-drift scan)

Deployed-current discipline: deployed-current.worker.js mirrors the live bundle;
regenerate via: wrangler deploy --dry-run --outdir dist && cp dist/worker.js deployed-current.worker.js
