# qnfo-jobsearch handoff (fail-safe for a session that stops mid-work)

State on 2026-11-06: 1.9.0 is in a draft PR (branch `claude/jobsearch-judge-pdf-prep`). Tests: `node qnfo-jobsearch/jobs-judge-pdf.test.mjs` plus the four existing suites. Research and design: `docs/JOBSEARCH-RESEARCH-2026-11.md`.

Order of work still open (each is a code change, not a report):
1. Phone UI: screens for Answers (`POST /api/answers`), Prep and Quiz (`/api/prep`, `/api/prep/quiz`), and a Calibrate row (qualified / stretch / not qualified) on every match and on pasted checks. Add a journey in `scripts/ux-journeys/apps/` (UX-JOURNEYS-1).
2. Judge in the hourly run: score the top N rubric matches and N random rejects with `judgeJob`, store `judge_fit`, and rank by a blend once `GET /api/calibration` shows the judge agrees with the owner more often than the rubric (judge_agreement_pct > rubric_agreement_pct over 30 or more verdicts).
3. Rubric: stop capping titles outside `FAMILIES` at 49 when the judge reads 60 or more; add the AI, physics and research-integrity families the record now supports.
4. Designed PDF variant for e-mailing people (the current `resume.pdf` is the single-column ATS one; keep it).
5. Referral step: for each applied or approved match, list the owner's contacts at that employer and draft the message (the owner sends it).
6. Companion link: when a match reaches `interview`, create the prep brief and put a calendar event with the brief link into personal-companion (look up its calendar route with `GET /fleet-graph/worker?worker=personal-companion` first).
7. Paste parsing: take the title from the page's `<h1>` or JSON-LD, not the first line.

Rules: bump with `python scripts/worker_release.py bump qnfo-jobsearch`, keep the mirror identical, run `python scripts/narrative-prompt-guard.py`, never merge a draft the owner has not released.
