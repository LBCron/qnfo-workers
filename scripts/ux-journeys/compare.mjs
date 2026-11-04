#!/usr/bin/env node
// scripts/ux-journeys/compare.mjs <base.json> <head.json>: exit 1 when the pull request makes a phone journey broken or harder
// that is fine on the base branch (UX-JOURNEYS-1). Journeys already red on the base are listed but do not fail the PR.
import fs from "node:fs";
import { regressions } from "./lib.mjs";
const [base, head] = process.argv.slice(2).map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
const r = regressions(base, head);
const pre = (head.apps || []).flatMap((a) => a.journeys.filter((j) => ["broken", "harder"].includes(j.grade.status)).map((j) => a.app + " / " + j.id)).filter((k) => !r.some((x) => x.startsWith(k + ":")));
const md = (r.length ? "### This change makes a phone journey worse\n" + r.map((x) => "- " + x).join("\n") : "No phone journey got worse.") +
  (pre.length ? "\n\nAlready red on the base branch (filed from main, not this PR's): " + pre.join(", ") : "");
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, "\n" + md + "\n");
process.exit(r.length ? 1 : 0);
