import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const start = source.indexOf("var _wobsMemo = null;\nasync function workerObservability(env, nowMs) {");
const end = source.indexOf('\n__name(workerObservabilityRead, "workerObservabilityRead");', start);
assert.ok(start >= 0 && end > start, "workerObservability, its 5-minute memo and the read are present");

const activeIssues = new Function("d1all", "ERR_ACTIVE_MS", "__name", `${source.slice(start, end)}\nreturn workerObservability;`)(
  async (env, sql, params) => env.db.prepare(sql).all(...params),
  3 * 36e5,
  (fn) => fn
);

test("reports only fresh unresolved issues not followed by a successful deployment", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE fleet_issue_loop (fingerprint TEXT, category TEXT, last_seen TEXT, closed_at TEXT);
      CREATE TABLE fleet_issue_dispatch (fingerprint TEXT, payload TEXT);
      CREATE TABLE fleet_deploys (worker TEXT, ok INTEGER, note TEXT, ts TEXT);`);
    const now = Date.parse("2026-10-30T09:30:00Z");
    const issue = db.prepare("INSERT INTO fleet_issue_loop VALUES (?, 'worker-observability', ?, ?)");
    const dispatch = db.prepare("INSERT INTO fleet_issue_dispatch VALUES (?, ?)");
    const deploy = db.prepare("INSERT INTO fleet_deploys VALUES (?, 1, '', ?)");
    const observe = (id, service, minutesAgo, closedAt = null) => {
      const observed = now - minutesAgo * 60_000;
      issue.run(id, String(observed), closedAt);
      if (service) dispatch.run(id, JSON.stringify({ service, lastObserved: observed }));
    };

    observe("live-ai", "qnfo-ai", 30);
    observe("live-search", "qnfo-ai-search", 120);
    observe("stale-search", "qnfo-ai-search", 240);
    observe("deployed-control", "qnfo-fleet-control", 30);
    deploy.run("qnfo-fleet-control", new Date(now - 10 * 60_000).toISOString());
    observe("closed-ai", "qnfo-ai", 10, new Date(now - 5 * 60_000).toISOString());
    observe("legacy-fallback", null, 20);
    db.prepare("UPDATE fleet_issue_loop SET last_seen = ? WHERE fingerprint = 'legacy-fallback'").run(
      new Date(now - 20 * 60_000).toISOString()
    );

    const result = await activeIssues({ AUDIT: { db } }, now);
    assert.equal(result.count, 3);
    assert.deepEqual(new Set(result.workers), new Set(["qnfo-ai", "qnfo-ai-search"]));

    // D1-OVERLOAD-1d: a second call inside 5 minutes answers from the isolate memo, not from D1
    db.exec("DELETE FROM fleet_issue_loop");
    assert.equal((await activeIssues({ AUDIT: { db } }, now + 60_000)).count, 3);
    assert.equal((await activeIssues({ AUDIT: { db } }, now + 6 * 60_000)).count, 0);
  } finally {
    db.close();
  }
});
