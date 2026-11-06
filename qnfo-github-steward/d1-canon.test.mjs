// TRACKER-D1-CANON-1: the steward reopens a fleet-issue mirror the seven-day age policy closed; a foreign aged not_planned close still stands.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const m = /function agePolicyClosed\(issue, nowMs\) \{[\s\S]*?\n\}/.exec(src);
const agePolicyClosed = new Function(m[0] + "; return agePolicyClosed;")();
const now = Date.parse("2026-11-06T12:00:00Z");
const aged = { state: "closed", state_reason: "not_planned", created_at: "2026-10-01T00:00:00Z" };

test("a mirror closed by the age policy is not protected from reopening", () => {
  assert.equal(agePolicyClosed({ ...aged, labels: [{ name: "fleet-issue" }] }, now), false);
});
test("an unlabelled aged not_planned close is still left closed", () => {
  assert.equal(agePolicyClosed({ ...aged, labels: [{ name: "bug" }] }, now), true);
});
test("the migration removes the critical-only rollup with a backup", () => {
  const sql = readFileSync(new URL("../migrations/2026-11-06-tracker-one-to-one.sql", import.meta.url), "utf8");
  assert.match(sql, /DELETE FROM ops_config WHERE key = 'gh_individual_priorities'/);
  assert.match(sql, /-- BACKUP: bak_20261106_ops_config_gh_individual/);
});
