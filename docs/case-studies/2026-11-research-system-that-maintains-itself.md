# Case study 1 (draft for owner approval): a research system that asks the right questions and maintains itself

Status: **draft**. Written in the owner's first person for LinkedIn, `qnfo.org/work-with-me` and a long-form post. Nothing here is posted until the owner approves it. Numbers were read on 2026-11-04 from
`qnfo-audit.metric_registry` and GitHub; re-read them before posting. Part of REACH-FOCUS-1 (`docs/REACH-PLAYBOOK.md` section 0).

## Draft

**I build AI systems that do the slow part of research, ask the questions people skip, and keep themselves running. Here is one, with its failures.**

Research is slow because most of it is reading, checking and housekeeping. So I built a system that does that work around the clock, and I measure what it gets wrong.

**1. It researches.** The system has published 262 papers in the last 30 days. Each one is a versioned record with a public revision history and a correction channel. I do not call that peer review, and every page says so.

**2. It asks the right questions.** The Universal Ignorance Audit is a fifteen-question method for finding what is not known in a domain before answering anything. It ships as a library others can run.

**3. It maintains itself.** 39 workers run on Cloudflare. When one breaks, the system files the defect, a code loop writes the fix as a pull request, tests run, risky changes are read by two models from different families, and a canary reverts the deploy if the live check fails. At least 300 pull requests merged in the last 30 days.

**What did not work.** The code loop succeeds on 52 percent of tasks over 30 days. 97 measures are in breach right now and 508 issues are open. Output was far ahead of readers: papers a day swung from 2 to 89 and the number of people reading did not move. I found that by measuring readers instead of counting clicks, and it changed the plan: fewer posts on the channels nobody reads, more where readers act.

**Where it caught me out.** I ran the code for my own most-downloaded paper. Its reported trajectory does not follow from its stated equations. I filed the correction as a tracked task and the finding is public in the repository. The corrected version is not published yet.

**If you run research, analysis or operations that is slow, or an AI system you cannot check:** the same method works on yours. Start at qnfo.org/work-with-me.

## Why this draft is built this way

- Leads with the owner's pitch (research, right questions, self-maintenance) and gives each claim a number a stranger can check.
- States the failure rate and the breach count next to the successes. A reader who finds the weak numbers themselves stops trusting the strong ones.
- No claim of a lab, a team or peer review (ORG-LABEL-1).
- Strongest argument against posting it: 97 measures in breach and a 52 percent success rate may read as a system that does not work, to an employer who skims. The reply is the last paragraph before the call to action: the point is that it measures itself and says so.

## Before posting

1. Re-read the five numbers (papers 30d, workers, merged PRs, code-task success, breaches and open issues).
2. Owner edits the voice. The fleet does not post this: it is a first-person claim in the owner's name.
3. Post on LinkedIn as a document or plain text, and link `qnfo.org/work-with-me` (item REACH-FOCUS-1.4 puts the matching offer on that page).
