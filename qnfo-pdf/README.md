# qnfo-pdf — cloud-native PDF renderer

Cloud-native PDF rendering for QNFO scientific papers. Replaces the local
\`render-pdf.cjs\` (puppeteer + local Chrome) with a Worker that renders paper
markdown to a polished A4 PDF via Cloudflare **Browser Run** (headless Chromium)
and **MathJax** (SVG) for math.

## Why

The prior PDF path was local-only and low quality:
- **Tables** rendered with a naive split-on-\`|\` parser (dropped empty cells,
  ignored alignment colons, broke on \`|\` inside math).
- **Math** was captured before MathJax finished (async race) or mangled by the
  emphasis pass (\`*\`/\`_\` inside \`$...$\`).
- **No polish**: no title block, no page numbers, no print typography.

## What it fixes

- \`renderer.js\`: robust markdown -> print-HTML renderer
  - GFM tables: alignment (\`:---:\`), escaped pipes \`\\|\`, preserved empty
    cells, math-in-cells.
  - Math: inline \`$...$\` / \`\\(...\\)\` and display \`$$...$$\` / \`\\[...\\]\`
    extracted to placeholders BEFORE emphasis/table-split.
  - YAML front matter + the D1 record -> title block (kind · date · version, title, subtitle, authors with affiliation superscripts, affiliations, ORCID/ISNI/email, DOI, licence, abstract, keywords, subjects, "cite as").
  - Pandoc citations \`[@key; @key2]\` -> numbered citations resolved against the paper's own BibTeX (see below).
- \`worker.js\`: Browser Run \`quickAction("pdf")\` with MathJax wait
  (\`data-mathjax-done\` marker) + A4 print options (header/footer page numbers,
  margins, tagged PDF).
- Print CSS: booktabs-style tables, serif typography, hyphenation, page-break
  control, centered display math.

## Professional typesetting (TYPESET-PRO-1, 1.5.0)

The owner's 2026-10-18 directive — a paper PDF needs professional typesetting that includes the full bibliographic
information and the author/affiliation — exposed three defects in 1.4.0, all fixed here:

1. **The bibliography never reached the page.** Every paper's reference list ships beside its markdown in R2 as
   `references.bib`, and `body_md` ends at a bare `## References` heading. The renderer printed that empty heading and the raw
   `[@key]` markers. Now `loadBib()` reads `{r2_path}references.bib` (directory or `*.md` r2_path), `parseBibTeX()` walks each
   entry (nested braces, quoted values, math in titles), `[@key]` / `[@key; @key2]` become numbered citations in order of first
   appearance (`[1]`, `[2, 3]`, ranges collapsed) and the reference list is printed with a hanging indent and the full entry:
   authors, title, venue, volume, number, pages, year, DOI/arXiv/URL. A key with no entry prints as the key itself and is
   counted as unresolved — never invented, never silently dropped. An empty `## References` heading is removed, and dropped
   entirely when no bibliography ships.
2. **Author/affiliation metadata was dropped.** `respond()` and the backlog renderer passed only `{title}`. `buildPaperMeta()`
   now files the whole D1 row into the render (authors, DOI/identifier, licence, keywords, subjects/domains, version, published,
   paper type, journal, pages), and `extractBylineBlock()` lifts the in-body `Author: … / Affiliation: … / Email: … / ORCID: …`
   block out of the prose into the title block. Nothing is synthesised: a field that is absent stays absent.
3. **The running head and page numbers were dead code.** `displayHeaderFooter` was `false`, so `headerTemplate` and
   `footerTemplate` never reached the PDF. Both are on now: short title and author in the head, DOI · page x / y · licence in
   the footer, with A4 geometry from `PRINT_CSS @page` (`preferCSSPageSize`).

A stored PDF is stamped with `customMetadata.renderer`; the `*/10` sweep re-renders stored PDFs whose stamp is older than the
running renderer, so a typesetting change reaches the back catalogue (bounded, and it converges because a re-render restamps).

Suite: `typeset.test.mjs` (13 tests).

## Build

PAPER-FORMAT-2 uses the same `_shared/paper-format.js` as the publication pipeline
and public paper pages. The real body abstract appears once in the title block;
wrapped headings and blank-separated metadata use the same normalization as HTML.
Bibliographic metadata lifted from a body is retained in YAML by corpus repairs.
Run `node _shared/inline-paper-format.mjs` before `node qnfo-pdf/build.mjs` after
editing the shared formatter. The renderer stamp changes with typesetting fixes
so the existing backlog loop refreshes older PDFs.

`worker.js` is an esbuild artifact: KaTeX bundle, then the renderer inlined between the `// renderer.js` and `// worker.js`
markers, then the worker logic. `renderer.js` is the source of truth for that region — never edit the inlined copy by hand:

```bash
node build.mjs           # rewrite worker.js + refresh deployed-current.worker.js (mirror-guard)
node build.mjs --check   # exit 1 when the inlined renderer is stale
npm install              # install the locked KaTeX and esbuild versions
npm run bundle:katex     # refresh the bundled KaTeX code + deployed-current.worker.js
node bundle-katex.mjs --check
```

When upgrading KaTeX, update the lockfile, regenerate the bundle with `npm run bundle:katex`, bump the worker patch version,
and run the PDF suites. The deployment consumes the committed `worker.js`; changing the npm lockfile alone does not update
the KaTeX code deployed to production.

## Backlog loop (SCHOLAR-PDF-ALL-1, 1.2.0)

Google Scholar indexes a paper's full text only through an absolute `citation_pdf_url` on its abstract page, and qnfo-gateway emits
that tag only when `papers.pdf_path` names a stored PDF. On 2026-10-12, 472 of 567 public papers had none. The `*/10` cron renders
`PDF_BACKLOG_BATCH` (6) papers per tick, newest first, and re-renders a paper whose body changed after its stored PDF (R2 `uploaded`
older than `papers.updated_at`). Each run writes `cloud_ops_events` (job `qnfo-pdf`, kinds `pdf-backlog`, `pdf-render-fail`,
`pdf-oversize`) and `metric_registry.scholar_pdf_backlog`; a paper that failed three times in 24 h waits a day. The stall detector is
`fm-pdf-backlog-stalled` (migrations/2026-10-12-30-scholar-pdf-backlog.sql). Suite: `pdf-backlog.test.mjs`.

## Endpoints

- \`GET /health\` — status + bindings present
- \`GET /pdf/:slug\` — render paper PDF (from D1 living-paper)
- \`GET /html/:slug\` — render paper HTML
- \`POST /pdf\` — render PDF from \`body_md\` (JSON \`{body_md, title, slug}\` or raw markdown, plus an optional \`meta\` object
  with \`authors\`, \`doi\`/\`identifier\`, \`license\`, \`keywords\`, \`categories\`, \`published\`, \`version\`, \`paper_type\`, \`r2_path\`
  and \`bibtex\`; the same fields are honoured at the top level)
- \`POST /html\` — render HTML from \`body_md\`

## Deploy

\`\`\`bash
cd qnfo-workers/qnfo-pdf
npx wrangler deploy
\`\`\`

## Bindings

- \`BROWSER\` (Browser Run), \`LIVING\` (D1 living-paper), \`RELEASES\` (R2 qnfo-releases).
