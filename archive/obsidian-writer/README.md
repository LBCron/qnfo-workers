# obsidian-writer

> Self-doc header (FLEET-SELF-DOC-1)
> Purpose: Obsidian-vault R2 file writer (radar sink)
> Canonical source: this directory (QNFO/qnfo-workers)
> Version: worker.js VERSION + /health (see fleet-drift scan)

Deployed-current discipline: deployed-current.worker.js mirrors the live bundle;
regenerate via: wrangler deploy --dry-run --outdir dist && cp dist/worker.js deployed-current.worker.js
