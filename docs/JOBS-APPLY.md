# JOBSEARCH-APPLY-1: one-click apply (qnfo-jobsearch 1.7.0, jobs.q08.org)

Charter pillar: personal. Owner ask 2026-11-05: one-stop, one-click applications with tailored resumes, posting keywords and automated submittal.

## What ships
- **Apply button** on every verified match and on "Check a job": downloads a tailored `.docx`, copies a form kit to the clipboard, opens the ATS apply page directly (`#app` Greenhouse, `/apply` Lever, `/application` Ashby, `/apply/` Workable, `/c/new` Recruitee).
- **Fill application bookmark** (set up once): reads the kit, fills first/last name, e-mail, LinkedIn, website, location and cover note, and attaches the resume file. It never fills work authorization, sponsorship, salary or demographic questions; the kit lists them as "left for you".
- **Keyword report** (`keywordReport`): posting terms grouped as on the resume, in the CV but left off, or missing from the CV. Missing terms are reported as gaps and never written into a resume; the claim verifier is unchanged.
- **Resume ordering**: facts that use the posting's own terms come first; every CV skill the posting names goes on the skills line.
- **Exports**: `GET /api/matches/:id/resume.docx|html|txt|md`, `note.txt`; `GET /api/matches/:id/kit` (sign-in) rebuilds from the live posting and current CV.
- **Ready to apply** filter: tier A, pending.

## Research basis and decisions
- ATS parsers read single-column text with standard headings and `.docx` or text PDF; the exports use one column, plain headings, no tables or images.
- Keyword echo only where the record backs it: tailoring that invents skills is the documented failure of auto-apply tools (see jobsearch/README.md).
- Fully unattended submission is declined: the Greenhouse Job Board API submit endpoint needs the employer's Basic-auth API key (docs.greenhouse.io/job-board.html, read 2026-11-05), the other ATS public APIs have no candidate submit, captchas and attestations are the applicant's own, and auto-apply measures 0.4-6% response. The owner presses Submit.
- The bookmark runs in the owner's own browser, so no bot automation and no ATS terms issue. Verified on a local Greenhouse/Lever-style form: 7 items filled, resume attached, phone/company/authorization left blank. Strict page CSP can block a bookmark on some sites; the kit stays on the clipboard to paste.

## Follow-ups (shipped as JOBSEARCH-FOLLOWUP-1, 1.8.0: reminders after 7 days)
Phone number is not in the CV bank (field left blank until added on /cv); follow-up reminders for applications with no reply after 7 days.
