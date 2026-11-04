import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-04-tracker-drift-age-policy.sql", import.meta.url), "utf8");
const db = new DatabaseSync(":memory:");
db.exec("create table ops_config(key,value);create table agent_issues(id,title,status,priority,created_at,updated_at);create table gh_issue_links(issue_id,gh_number,gh_state,gh_close_reason);create table code_task_pr_links(task_id,drift,synced_at);");
db.exec(sql);
db.exec("insert into ops_config values('gh_individual_priorities','critical');insert into agent_issues values(1,'t','open','critical',1,1);insert into gh_issue_links values(1,5,'closed','age-policy')");
const n = () => db.prepare("select count(*) n from v_tracker_drift where kind='issue-state'").get().n;
let bad = 0;
if (n() !== 0) { console.log("FAIL age-policy close counted as drift"); bad++; }
db.exec("update gh_issue_links set gh_close_reason = null");
if (n() !== 1) { console.log("FAIL real drift hidden"); bad++; }
if (bad) process.exit(1);
console.log("ok tracker-drift-age-policy");
