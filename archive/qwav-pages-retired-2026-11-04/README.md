# qwav Pages project, domains retired 2026-11-04 (QWAV-PAGES-RETIRE-1)

Pages project `qwav`, production deployment ac57d908-0478-4285-9c68-82e3f4202d08 (2026-11-03). Copies of its landing page (index.html),
its research listing (papers.html) and sitemap.xml are kept here. The landing page duplicated qwav.org's gateway page and lacked only
the ten demos, which the gateway page now lists.

Detached from the project: qwav.org, www.qwav.org, qwav.net, qwav.uk, www.qwav.uk, score.qwav.tech. Revert: re-add each as a Pages custom
domain (POST /accounts/<id>/pages/projects/qwav/domains) and delete the routes `qwav.org/*`, `www.qwav.org/*`, `qwav.net/*`, `www.qwav.uk/*`.

Kept on the project: deep.qwav.tech and primer.qwav.tech. About 500 hash-named static pages under /papers/ exist only there; none maps to a
papers.qnfo.org slug (25 of 25 sampled returned 404). Migrate them before detaching the project.
