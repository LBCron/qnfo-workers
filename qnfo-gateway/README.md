# qnfo-gateway — QNFO site router (papers.qnfo.org, ideas, archive, ipatent, graph-api, legal)

Paper pages and Markdown downloads use `_shared/paper-format.js` (PAPER-FORMAT-2)
before rendering or export.
New, revised and imported papers share title, subtitle, abstract and metadata
handling; wrapped headings are joined without altering scientific text.
Downloads retain custom YAML and bibliographic metadata without duplicating titles
or abstracts. Regenerate the inlined copy with `node _shared/inline-paper-format.mjs`.

**Recovery state:** canonical source was never committed as a full source tree; this dir carries the
deployed bundle recovered from qnfo-web-unified/qnfo-gateway.deployed.worker.js (2026-09-10 re-home).
Treat deployed-current.worker.js as the ONLY source of truth until the bundle is de-compiled into
readable source (tracked: F4 re-home worklist).

**Purpose:** dynamic D1-driven site rendering (papers.qnfo.org serves living-paper columns at request
time). CORE worker — do NOT deprecate. No /health route yet (F3 probe worklist).

**Deploy method:** wrangler deploy from a reconstructed wrangler.toml; bindings LIVING (living-paper D1)
+ GRAPH (qnfo-graph D1). See taxonomy F6.

**qnfo.org/work-with-me (WORK-WITH-ME-1, 3.7.27, pillar reach):** the offers page (JPCUB assessment, review of an AI
research or agent operation, talks and workshops, research collaboration, roles), in the owner's first person and from the
published record only (the CV, the selected works, 44 deployed workers). No form: each offer
is a mailto to rowan.quni@qnfo.org whose subject starts `[work-with-me:<offer>]`, which qnfo-fleet-dashboard
WORK-WITH-ME-METRIC-1 counts. Linked from the home page (nav, byline, first card, footer), /about, the sitemap and llms.txt;
`/contact` redirects to it. Offline suite: `work-with-me.test.mjs` (deploy-gate).

## POST /api/ask is grounded (ASK-GROUND-1, 3.13.0)

Owner directive 2026-10-10. The route answers only from the text of one published paper. A missing slug returns 400 `no_source`;
an unknown or unpublished slug returns 404 `no_source`; neither calls the model. Up to 36000 characters of the paper are supplied
(`source_truncated` says when the paper is longer). The prompt is process-only, and every sentence of the answer that carries a
DOI, link, author citation or figure absent from the paper text is removed (`removed_statements` counts them). Suite:
`node qnfo-gateway/ask-ground.test.mjs`.
