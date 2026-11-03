// personal-companion/wellbeing-wire.js
// WELLBEING-LOOP-1 wiring: routes, the hourly tick, the morning check-in, delivery.
// Kept out of worker.js so the 345 KB bundle needs three small insertions and nothing else.
//
// Facts this file relies on (verified 2026-10-17):
//   owner mailbox rwnquni@outlook.com (worker.js PROMPT_OWNER / sendMail)
//   mail primitive sendOne(env, to, subject, body) (worker.js)
//   personal-life D1: chat(role,ts), notes(kind,ts), activity(date), events(start_date)
//   crisis numbers verified on https://www.113.nl : 112 immediate danger, 113 or 0800-0113, chat 24/7

import * as WB from "./wellbeing.js";

export const OWNER = "rwnquni@outlook.com";
export const BASE = "https://reading.q08.org";

// Seeded once, then owned by the owner: a row in wellbeing_config always wins.
const SEEDS = {
  crisis_lines: [
    { label: "112 - immediate danger", number: "112" },
    { label: "113 Zelfmoordpreventie", number: "113" },
    { label: "0800-0113 (free)", number: "0800-0113" },
    { label: "chat 24/7", number: "", url: "https://www.113.nl" }
  ]
};

const parseVal = (v) => { try { return JSON.parse(v); } catch { return v; } };
const esc = (s) => String(s === null || s === undefined ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const days = (ms) => ms / 864e5;

export async function ensureWellbeing(db) {
  await WB.ensureWellbeingSchema(db);
  const now = new Date().toISOString();
  for (const [k, v] of Object.entries(SEEDS)) {
    await db.prepare(
      "INSERT INTO wellbeing_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING"
    ).bind(k, JSON.stringify(v), now).run();
    // DEFAULT_CONFIG seeds an empty crisis_lines first, so the INSERT above is a no-op. Fill an
    // empty list once; the WHERE guard means an owner edit, made at any point, is never overwritten.
    const cur = await db.prepare("SELECT value FROM wellbeing_config WHERE key = ?").bind(k).first();
    const parsed = cur ? parseVal(cur.value) : null;
    if (Array.isArray(parsed) && parsed.length === 0) {
      await db.prepare(
        "UPDATE wellbeing_config SET value = ?, updated_at = ? WHERE key = ? AND value = ?"
      ).bind(JSON.stringify(v), now, k, cur.value).run();
    }
  }
}

export async function cfg(env) {
  const r = await env.PERSONAL.prepare("SELECT key, value FROM wellbeing_config").all();
  const out = { ...WB.DEFAULT_CONFIG };
  for (const row of r.results || []) out[row.key] = parseVal(row.value);
  return out;
}

export async function setCfg(env, key, value) {
  await env.PERSONAL.prepare(
    "INSERT INTO wellbeing_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).bind(key, typeof value === "string" ? value : JSON.stringify(value), new Date().toISOString()).run();
}

// ---------------------------------------------------------------- context

// The companion's picture of "how is he, right now". Built only from what is already recorded,
// so it works on day one, before a single check-in exists.
export async function context(env, nowIso, c) {
  const conf = c || (await cfg(env));
  const now = nowIso || new Date().toISOString();
  const nowMs = new Date(now).getTime();
  const tz = conf.tz;
  const day = WB.dayKey(now, tz);
  const iso = (d) => new Date(nowMs - d * 864e5).toISOString();

  const one = async (sql, ...b) => {
    try { return (await env.PERSONAL.prepare(sql).bind(...b).first()) || {}; } catch { return {}; }
  };
  const many = async (sql, ...b) => {
    try { return ((await env.PERSONAL.prepare(sql).bind(...b).all()).results) || []; } catch { return []; }
  };

  const lastNote = await one("SELECT MAX(ts) AS t FROM notes WHERE kind NOT IN ('email')");
  const lastAct = await one("SELECT MAX(date) AS d FROM activity");
  const vol = await one(
    "SELECT SUM(CASE WHEN ts >= ? THEN 1 ELSE 0 END) AS w, COUNT(*) AS m FROM chat WHERE LOWER(role) = 'user' AND ts >= ?",
    iso(7), iso(28)
  );
  // The table carries both 'USER' and 'user' (two import eras): compare case-insensitively or a
  // whole client's history disappears from the baseline.
  const nightRows = await many("SELECT ts FROM chat WHERE LOWER(role) = 'user' AND ts >= ? LIMIT 2000", iso(14));

  const vrows = await many(
    "SELECT path, size FROM files WHERE path LIKE 'obsidian/notes/v1/%' AND path GLOB '*/_[0-9][0-9].md' ORDER BY modified DESC LIMIT 400"
  );
  const vault = vaultNoteDays(vrows, day);

  const check = await one("SELECT mood, energy, sleep_hours FROM wellbeing_checkins WHERE day = ? ORDER BY ts DESC", day);
  const avg = await one(
    "SELECT ROUND(AVG(mood),2) a7 FROM wellbeing_checkins WHERE mood IS NOT NULL AND day >= ?", WB.dayKey(iso(7), tz)
  );
  const recentMood = await one(
    "SELECT ROUND(AVG(CASE WHEN day >= ? THEN mood END),2) m2, ROUND(AVG(CASE WHEN day < ? THEN mood END),2) m5 FROM wellbeing_checkins WHERE mood IS NOT NULL AND day >= ?",
    WB.dayKey(iso(2), tz), WB.dayKey(iso(2), tz), WB.dayKey(iso(7), tz)
  );

  let night = 0;
  for (const row of nightRows) {
    const h = WB.localHourFloat(row.ts, tz);
    if (h < 5) night += 1;
  }

  const answers = await WB.unansweredStreak(env.PERSONAL);
  const idx = {
    days_since_note: lastNote.t ? days(nowMs - Date.parse(lastNote.t)) : 999,
    days_since_daily_note: vault.latest ? days(nowMs - Date.parse(vault.latest + "T12:00:00Z")) : 999,
    daily_note_days_7d: vault.days7,
    daily_note_last_size: vault.latestSize,
    days_since_activity: lastAct.d ? days(nowMs - Date.parse(lastAct.d + "T12:00:00Z")) : 999,
    night_share: nightRows.length ? night / nightRows.length : 0,
    volume_ratio: vol.m ? (Number(vol.w) / 1) / (Number(vol.m) / 4) : null,
    mood_today: check.mood === undefined ? null : check.mood,
    energy_today: check.energy === undefined ? null : check.energy,
    sleep_today: check.sleep_hours === undefined ? null : check.sleep_hours,
    mood_avg7: avg.a7 === undefined ? null : avg.a7,
    mood_drop_2d: recentMood.m2 !== null && recentMood.m5 !== null && recentMood.m2 !== undefined && recentMood.m5 !== undefined
      ? Number(recentMood.m5) - Number(recentMood.m2) >= 0.75 : false,
    unanswered_streak: answers
  };

  return {
    day,
    hour: WB.localHourFloat(now, tz),
    ctx: idx,
    drift: WB.drift(idx),
    checked_in: check.mood !== undefined || check.energy !== undefined,
    // SCALE-ANCHORED-1: the same instrument the check-in page shows, machine-readable, so no reader
    // has to guess what 1 and 5 mean or which direction is good. Thresholds are drift()'s own.
    scale: {
      mood: { question: "how you feel right now", 1: "rough", 2: "low", 3: "okay", 4: "good", 5: "great" },
      energy: { question: "how much you have in the tank", 1: "empty", 2: "thin", 3: "steady", 4: "strong", 5: "full" },
      direction: "5 is best; 1-2 low, 3 neutral, 4-5 high",
      not_a_grade: true,
      used_for: "low values drop the ask ladder to presence; nothing is scored and there is no target",
      thresholds: { mood_today_strong_low: 1, mood_avg7_strong_low: 2.5, mood_drop_2d_points: 0.75 }
    }
  };
}

export async function recentNudges(env, limit = 40) {
  const r = await env.PERSONAL.prepare(
    "SELECT * FROM companion_nudges ORDER BY id DESC LIMIT ?"
  ).bind(limit).all();
  return r.results || [];
}

export async function loopRows(env) {
  try {
    const r = await env.PERSONAL.prepare("SELECT * FROM v_nudge_loop").all();
    return r.results || [];
  } catch { return []; }
}

// ---------------------------------------------------------------- delivery

// The owner's own daily notes live in the vault as notes/v1/YYYY/MM/DD/_DD.md. The same note is
// mirrored under several prefixes, so dedupe by the date in the path, not by row.
export function vaultNoteDays(rows, today) {
  const days = new Set();
  let latest = null, latestSize = 0;
  for (const r of rows || []) {
    const m = String(r.path || "").match(/\/(\d{4})\/(\d{2})\/(\d{2})\/_\d\d\.md$/);
    if (!m) continue;
    const d = m[1] + "-" + m[2] + "-" + m[3];
    days.add(d);
    if (!latest || d > latest) { latest = d; latestSize = Number(r.size || 0); }
  }
  const ref = Date.parse(today + "T12:00:00Z");
  let days7 = 0;
  for (const d of days) if (Date.parse(d + "T12:00:00Z") >= ref - 7 * 864e5) days7 += 1;
  return { days7, latest, latestSize, total: days.size };
}

function token(env, u) {
  const expected = env.WELLBEING_TOKEN;
  if (!expected) return true;                    // unset: same fail-open convention as authorized()
  return u.searchParams.get("t") === expected || u.searchParams.get("k") === expected;
}

export function nudgeMail(n, c, tok) {
  const q = tok ? "&t=" + encodeURIComponent(tok) : "";
  if (n.kind === "presence") {
    return {
      subject: "I'm here",
      body: [c.presence_line || "I'm here. Nothing needed from you right now.", "", "No reply needed.", "", BASE + "/wb/checkin" + (tok ? "?t=" + encodeURIComponent(tok) : "")].join("\n")
    };
  }
  if (n.kind === "checkin") {
    return {
      subject: "morning - two taps",
      body: ["How's it landing today?", "", "Mood (how you feel) then energy (what you have in the tank). Two taps, 1 low to 5 high, nothing to type:", "", BASE + "/wb/checkin" + (tok ? "?t=" + encodeURIComponent(tok) : "")].join("\n")
    };
  }
  return {
    subject: "one small thing",
    body: [
      n.ask,
      "",
      "Did it:    " + BASE + "/wb/done?id=" + n.id + q,
      "Not today: " + BASE + "/wb/no?id=" + n.id + q,
      "",
      "Either answer is a good answer. If nothing happens this closes on its own and nothing else is asked today."
    ].join("\n")
  };
}

// ONE-MORNING-MAIL-1: the morning brief and the standalone check-in both fire on the 06:00Z tick,
// which put two messages in the owner's inbox 15 minutes apart. The check-in now rides inside the
// brief when the brief goes out; the standalone path remains as the fallback for days with no brief.
export async function briefCheckinLines(env, nowIso) {
  const c = await cfg(env);
  if (c.wellbeing_prompts !== true) return [];
  const day = WB.dayKey(nowIso || new Date().toISOString(), c.tz);
  const seen = await env.PERSONAL.prepare(
    "SELECT 1 AS x FROM companion_nudges WHERE day = ? AND kind = 'checkin' LIMIT 1"
  ).bind(day).first();
  if (seen) return [];
  const t = env.WELLBEING_TOKEN ? "?t=" + encodeURIComponent(env.WELLBEING_TOKEN) : "";
  return ["", "How's it landing? Two taps: mood and energy, 1 low to 5 high, nothing to type:", BASE + "/wb/checkin" + t];
}

export async function noteCheckinInBrief(env, nowIso) {
  const c = await cfg(env);
  if (c.wellbeing_prompts !== true) return false;
  const now = nowIso || new Date().toISOString();
  const day = WB.dayKey(now, c.tz);
  try {
    await env.PERSONAL.prepare(
      `INSERT INTO companion_nudges (ts, day, kind, ladder_step, ask, minutes, expected, due_at, state, sent_at, reason)
       VALUES (?, ?, 'checkin', 0, 'How''s it landing today?', 0, 'log:checkin', ?, 'sent', ?, 'morning-brief')`
    ).bind(now, day, new Date(Date.parse(now) + 6 * 3600e3).toISOString(), now).run();
    return true;
  } catch (e) {
    if (String(e && e.message || e).includes("NUDGE-DUP-1")) return false;
    throw e;
  }
}

// ---------------------------------------------------------------- the tick

// Called hourly. Idempotent by construction: one row per kind per day, a min gap, a daily cap.
export async function wellbeingTick(env, deps = {}) {
  const send = deps.send;
  const now = deps.nowIso || new Date().toISOString();
  await ensureWellbeing(env.PERSONAL);

  const c = await cfg(env);
  const out = { now, expired: await WB.expireStale(env.PERSONAL, now) };
  if (c.wellbeing_prompts !== true) return { ...out, skipped: "practical-notifications-only" };
  const pack = await context(env, now, c);
  out.drift = pack.drift;
  // RED-TEAM-1 (personal-api 4.12.0): the pause he sets on /companion silences this ladder too (one budget of
  // attention). A risk-words care touch still comes from personal-api's companion tick, never from here.
  if (!deps.force && c.pause_until && Date.parse(c.pause_until) > Date.parse(now)) { out.skipped = "paused"; return out; }
  // Sunday evening review, independent of the ask ladder; silent without enough data.
  try { out.review = await weeklyReview(env, { send, nowIso: now, force: !!deps.forceReview }); } catch (eRv) { out.review = { error: String(eRv && eRv.message || eRv) }; }

  // 1. The morning check-in. Its own schedule, not the reading brief's: 07:45 local, once a day.
  if (pack.hour >= 7.75 && pack.hour < 12) {
    const already = (await recentNudges(env, 20)).some((r) => r.kind === "checkin" && r.day === pack.day);
    if (!already && send) {
      const row = await insertNudge(env, {
        day: pack.day, kind: "checkin", step: 0, ask: "How's it landing today?",
        minutes: 0, expected: "log:checkin", due_at: new Date(Date.parse(now) + 6 * 3600e3).toISOString(),
        reason: "morning-checkin"
      });
      if (row) {
        const mail = nudgeMail(row, c, env.WELLBEING_TOKEN);
        const sent = await send(env, OWNER, mail.subject, mail.body);
        await markSent(env, row.id, sent, now);
        out.checkin = { id: row.id, sent: !!(sent && sent.ok !== false) };
      }
    }
  }

  // 2. At most one ask, on the WS ladder, with every cadence rule applied.
  const planCfg = deps.force
    ? { ...c, quiet_start: 0, quiet_end: 0, max_per_day: 99, min_gap_min: 0 }
    : c;
  const plan = WB.planNext({
    nowIso: now,
    ctx: { ...pack.ctx, drift_level: pack.drift.level, checked_in: pack.checked_in },
    cfg: planCfg,
    recent: await recentNudges(env, 40), loopRows: await loopRows(env)
  });
  if (plan.skip) { out.skipped = plan.skip; return out; }
  if (!send) { out.planned = plan; return out; }

  const row = await insertNudge(env, {
    day: pack.day, kind: plan.kind, step: plan.ladder_step, ask: plan.ask,
    minutes: plan.minutes, expected: plan.expected, due_at: plan.due_at, reason: plan.reason
  });
  if (!row) { out.skipped = "insert-failed"; return out; }
  const mail = nudgeMail(row, c, env.WELLBEING_TOKEN);
  const sent = await send(env, OWNER, mail.subject, mail.body);
  await markSent(env, row.id, sent, now);
  out.sent = { id: row.id, kind: plan.kind, step: plan.ladder_step, ok: !!(sent && sent.ok !== false) };
  return out;
}

async function insertNudge(env, n) {
  const now = new Date().toISOString();
  try {
    const r = await env.PERSONAL.prepare(
      `INSERT INTO companion_nudges (ts, day, kind, ladder_step, ask, minutes, expected, due_at, state, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)`
    ).bind(now, n.day, n.kind, n.step, n.ask, n.minutes ?? null, n.expected ?? null, n.due_at ?? null, n.reason ?? null).run();
    const newId = r && r.meta ? r.meta.last_row_id : null;
    // Never hand an undefined id to a later UPDATE: a row with no id is a silent delivery failure.
    if (newId === null || newId === undefined) throw new Error("NUDGE-ID-1: insert returned no row id");
    return { id: newId, ...n };
  } catch (e) {
    if (!String(e && e.message || e).includes("NUDGE-DUP-1")) throw e;
    // A queued row from a failed send is reused, never duplicated.
    const r = await env.PERSONAL.prepare(
      "SELECT * FROM companion_nudges WHERE day = ? AND kind = ? AND state = 'queued' LIMIT 1"
    ).bind(n.day, n.kind).all();
    return (r.results || [])[0] || null;
  }
}

async function markSent(env, id, sent, nowIso) {
  // COMPANION-EMAIL-OPT-IN-1: with companion e-mail off the ask still happens, on the phone: the row is marked sent "via app"
  // and personal-api's companion tick mirrors fresh ladder rows to Web Push (and shows them on Today).
  if (sent && sent.disabled && sent.app) {
    await env.PERSONAL.prepare(
      "UPDATE companion_nudges SET state = 'sent', sent_at = ?, outcome = ? WHERE id = ? AND state = 'queued'"
    ).bind(nowIso, JSON.stringify({ via: "app", email_mode: sent.mode || "off" }), id).run();
    return;
  }
  // owner_notice_enabled=0 is a deliberate off switch, not a delivery failure: record it as closed
  // rather than leaving a row to be retried forever.
  if (sent && sent.disabled) {
    await env.PERSONAL.prepare(
      "UPDATE companion_nudges SET state = 'expired', closed_at = ?, outcome = ? WHERE id = ? AND state = 'queued'"
    ).bind(nowIso, JSON.stringify({ owner_notices_disabled: true }), id).run();
    return;
  }
  if (sent && sent.ok !== false && !sent.suppressed) {
    await env.PERSONAL.prepare(
      "UPDATE companion_nudges SET state = 'sent', sent_at = ?, outcome = ? WHERE id = ? AND state = 'queued'"
    ).bind(nowIso, JSON.stringify({ via: sent.via || "mail" }), id).run();
    return;
  }
  const why = JSON.stringify({ send_failed: sent ? (sent.error || (sent.suppressed ? "suppressed" : "unknown")) : "no-send" });
  await env.PERSONAL.prepare(
    "UPDATE companion_nudges SET state = 'queued', outcome = ? WHERE id = ?"
  ).bind(why, id).run();
}

// ---------------------------------------------------------------- crisis

export async function escalate(env, deps, { text, source }) {
  const c = await cfg(env);
  const block = WB.crisisBlock(c, c.safety_plan || null);
  const sig = WB.crisisSignal(text);
  if (sig.level < 2) return { level: sig.level, sent: false };
  const body = block.text + "\n\n" + BASE + "/wb/checkin" + (env.WELLBEING_TOKEN ? "?t=" + encodeURIComponent(env.WELLBEING_TOKEN) : "");
  let sent = null;
  try { sent = deps.send ? await deps.send(env, OWNER, "not alone", body, "crisis") : null; } catch (e) { sent = { ok: false, error: String(e && e.message || e) }; }
  try {
    await env.PERSONAL.prepare(
      "INSERT INTO companion_nudges (ts, day, kind, ladder_step, ask, minutes, expected, due_at, state, sent_at, reason) VALUES (?, ?, 'crisis', 0, ?, 0, NULL, ?, 'sent', ?, ?)"
    ).bind(new Date().toISOString(), WB.dayKey(new Date().toISOString(), c.tz), "escalation", new Date(Date.now() + 864e5).toISOString(), new Date().toISOString(), "signal:" + sig.match + " source:" + source).run();
  } catch { /* the mail is what matters; the ledger row is best effort */ }
  return { level: 2, match: sig.match, sent: !!(sent && sent.ok !== false), block };
}

// ---------------------------------------------------------------- weekly review

function localWeekday(nowIso, tz) {
  const t = new Date(new Date(nowIso).getTime() + WB.tzOffsetMinutes(tz, new Date(nowIso).getTime()) * 60000);
  return t.getUTCDay();   // 0 = Sunday
}

function addDays(day, n) {
  return new Date(Date.parse(day + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
}

function mondayOf(day) {
  const dow = (new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7;   // 0 = Monday
  return addDays(day, -dow);
}

// Everything the review may report, each figure computed from rows and nothing inferred.
// A correlation is only reported when there are at least two observations behind it.
export async function weeklyData(env, nowIso, c) {
  const conf = c || (await cfg(env));
  const now = nowIso || new Date().toISOString();
  const today = WB.dayKey(now, conf.tz);
  const week = mondayOf(today);
  const win = addDays(today, -27);
  const many = async (sql, ...b) => {
    try { return ((await env.PERSONAL.prepare(sql).bind(...b).all()).results) || []; } catch { return []; }
  };
  const checks = await many("SELECT day, mood, energy FROM wellbeing_checkins WHERE day >= ? AND mood IS NOT NULL ORDER BY day", win);
  const dones = await many("SELECT day, kind, ask FROM companion_nudges WHERE state = 'done' AND day >= ? AND kind IN ('micro','body','contact','care') ORDER BY day", win);

  const after = {};
  for (const d of dones) { const nd = addDays(d.day, 1); (after[d.kind] = after[d.kind] || new Set()).add(nd); }
  const allAfter = new Set();
  for (const k of Object.keys(after)) for (const v of after[k]) allAfter.add(v);
  const avg = (arr) => (arr.length ? Math.round((arr.reduce((a, b) => a + Number(b), 0) / arr.length) * 10) / 10 : null);
  const helped = [];
  for (const kind of Object.keys(after)) {
    const a = checks.filter((r) => after[kind].has(r.day)).map((r) => r.mood);
    if (a.length < 2) continue;                       // one good day is not a finding
    const others = checks.filter((r) => !allAfter.has(r.day)).map((r) => r.mood);
    helped.push({ kind, mood_after: avg(a), mood_other: avg(others) });
  }

  return {
    week, today,
    checks: checks.filter((r) => r.day >= week),
    done: dones.filter((r) => r.day >= week),
    helped,
    retired: [...WB.retiredKinds(await loopRows(env), conf)]
  };
}

// Sunday evening. Silent unless there is enough of his own data to say something true.
export async function weeklyReview(env, deps = {}) {
  const c = await cfg(env);
  const now = deps.nowIso || new Date().toISOString();
  const today = WB.dayKey(now, c.tz);
  if (!deps.force && (localWeekday(now, c.tz) !== 0 || WB.localHourFloat(now, c.tz) < 18)) {
    return { skipped: "not-sunday-evening" };
  }
  const week = mondayOf(today);
  const seen = await recentNudges(env, 30);
  if (seen.some((r) => r.kind === "review" && r.day === week)) return { skipped: "already-reviewed" };

  const data = await weeklyData(env, now, c);
  if (!deps.force && data.checks.length < 3 && data.done.length < 2) {
    return { skipped: "not-enough-data", checks: data.checks.length, done: data.done.length };
  }
  const text = WB.weeklyReviewText({ week, checkins: data.checks, done: data.done, helped: data.helped, retired: data.retired });
  if (!deps.send) return { planned: true, text };

  const row = await insertNudge(env, { day: week, kind: "review", step: 0, ask: "weekly review", minutes: 0, expected: null, due_at: null, reason: "weekly-review" });
  if (!row) return { skipped: "insert-failed" };
  const sent = await deps.send(env, OWNER, "the week - " + week, text);
  await markSent(env, row.id, sent, now);
  return { ok: !!(sent && sent.ok !== false), id: row.id, done: data.done.length, checks: data.checks.length };
}

// ---------------------------------------------------------------- http

function page(title, body) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${esc(title)}</title>` +
    `<style>body{font:17px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1.2rem;color:#1b1b1b}` +
      `a.b{display:inline-block;min-width:3.9rem;text-align:center;padding:.6rem 0;margin:.2rem;border:1px solid #bbb;border-radius:.6rem;text-decoration:none;color:#111}` +
      `a.b small{display:block;font-size:.68rem;line-height:1.1;opacity:.75}` +
    `a.b.sel{background:#111;color:#fff;border-color:#111}a.q{color:#666}textarea{width:100%;min-height:6rem;font:inherit;padding:.6rem;border:1px solid #bbb;border-radius:.6rem}` +
    `input{width:calc(100% - 1.4rem);font:inherit;padding:.6rem;border:1px solid #bbb;border-radius:.6rem;margin:.2rem 0}` +
    `h1{font-size:1.15rem;font-weight:600}</style></head><body>` + String(body || "") + `</body>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );
}
const txt = (body, status = 200) => new Response(String(body) + "\n", { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export async function handleWellbeing(request, env, deps = {}) {
  const u = new URL(request.url);
  const p = u.pathname;
  if (!p.startsWith("/wb/") && p !== "/api/wellbeing") return null;
  await ensureWellbeing(env.PERSONAL);
  if (!token(env, u)) return txt("unauthorized: append ?t=TOKEN", 401);

  const c = await cfg(env);
  const t = env.WELLBEING_TOKEN || "";

  if (p === "/wb/checkin") {
    let note = u.searchParams.get("note");
    if (request.method === "POST") {
      try { const fd = await request.formData(); note = fd.get("note") || note; } catch { /* not a form */ }
    }
    const mood = u.searchParams.get("mood");
    const energy = u.searchParams.get("energy");
    if (mood !== null || energy !== null || note) {
      await WB.recordCheckin(env.PERSONAL, {
        mood: mood || null, energy: energy || null,
        sleep_hours: u.searchParams.get("sleep"), load: u.searchParams.get("load"),
        note: note || null, source: "web", ts: new Date().toISOString()
      });
      const esc2 = note ? await escalate(env, deps, { text: note, source: "checkin-note" }) : { level: 0 };
      if (esc2.level >= 2) {
        return page("not alone", "<h1>You said something that matters.</h1><p>I have sent you the numbers and the one thing to do. You do not have to hold this alone tonight.</p><p><a class='q' href='/wb/checkin?t=" + esc(t) + "'>back</a></p>");
      }
    }
    const st = await env.PERSONAL.prepare("SELECT mood, energy FROM wellbeing_checkins WHERE day = ? ORDER BY ts DESC LIMIT 1")
      .bind(WB.dayKey(new Date().toISOString(), c.tz)).all();
    const row = (st.results || [])[0] || {};
    const link = (k, v) => "/wb/checkin?" + k + "=" + v + (t ? "&t=" + encodeURIComponent(t) : "");
    // SCALE-ANCHORED-1: a bare 1-5 row is not an instrument. Every rung carries the word it means,
    // the page states the direction and the bands, and it says the number is not a grade.
    const MOOD_WORDS = ["rough", "low", "okay", "good", "great"];
    const ENERGY_WORDS = ["empty", "thin", "steady", "strong", "full"];
    const btns = (k, cur, words) => [1, 2, 3, 4, 5].map((v) => `<a class="b${cur === v ? " sel" : ""}" href="${link(k, v)}">${v}<small>${words[v - 1]}</small></a>`).join("");
    const done = row.mood !== undefined || row.energy !== undefined;
    return page("check-in",
      `<h1>Today</h1>` +
      `<p><b>Mood</b> is how you feel right now. <b>Energy</b> is how much you have in the tank. Both 1 to 5, where 5 is best.</p>` +
      `<p class="q">mood - how you feel right now</p><div>${btns("mood", row.mood, MOOD_WORDS)}</div>` +
      `<p class="q">energy - what you have in the tank</p><div>${btns("energy", row.energy, ENERGY_WORDS)}</div>` +
      `<p class="q">1-2 is low, 3 is neutral, 4-5 is high. It is not a grade and there is no target: a low day means fewer asks and more presence, nothing else.</p>` +
      (done ? `<form method="post"><p class="q">anything you want to leave here</p><textarea name="note" autofocus></textarea><p><button class="b" type="submit">save</button></p></form>` : "")
    );
  }

  if (p === "/wb/done" || p === "/wb/no") {
    const id = Number(u.searchParams.get("id"));
    if (!id) return txt("missing id", 400);
    await WB.closeNudge(env.PERSONAL, id, {
      state: p === "/wb/done" ? "done" : "declined",
      response: p === "/wb/done" ? "web" : "declined-web"
    });
    return page("logged", p === "/wb/done"
      ? "<h1>Logged.</h1><p>That counts. Nothing else needed.</p>"
      : "<h1>Noted.</h1><p>Nothing more today. It will not ask again.</p>");
  }

  // Ops path: prove the loop now instead of waiting for the hour. Token-gated like every other
  // wellbeing route. force=1 bypasses quiet hours and the daily cap, never the ladder or retirement.
  if (p === "/wb/tick") {
    // kind=checkin proves the check-in path now instead of waiting for 07:45.
    if (u.searchParams.get("kind") === "review") {
      const rv = await weeklyReview(env, { send: deps.send, force: true });
      return new Response(JSON.stringify(rv, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8" } });
    }
    if (u.searchParams.get("kind") === "checkin") {
      const c0 = await cfg(env);
      const nowC = new Date().toISOString();
      const dayC = WB.dayKey(nowC, c0.tz);
      const rowC = await insertNudge(env, {
        day: dayC, kind: "checkin", step: 0, ask: "How's it landing today?", minutes: 0,
        expected: "log:checkin", due_at: new Date(Date.parse(nowC) + 6 * 3600e3).toISOString(), reason: "ops-force"
      });
      if (!rowC) return new Response(JSON.stringify({ ok: false, skipped: "already-sent-today" }, null, 2), { headers: { "Content-Type": "application/json" } });
      const mailC = nudgeMail(rowC, c0, env.WELLBEING_TOKEN);
      const sentC = deps.send ? await deps.send(env, OWNER, mailC.subject, mailC.body) : null;
      await markSent(env, rowC.id, sentC, nowC);
      return new Response(JSON.stringify({ ok: !!(sentC && sentC.ok !== false), id: rowC.id, subject: mailC.subject }, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8" } });
    }
    const out = await wellbeingTick(env, { send: deps.send, force: u.searchParams.get("force") === "1" });
    return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  }

  // The six-step safety plan (Stanley & Brown), in his own words, written when it is not an
  // emergency. The escalation block is the only reader.
  if (p === "/wb/plan") {
    const plan = (c.safety_plan && typeof c.safety_plan === "object") ? c.safety_plan : {};
    if (request.method === "POST") {
      let fd = null;
      try { fd = await request.formData(); } catch { /* not a form */ }
      if (fd) {
        const linesOf = (k) => String(fd.get(k) || "").split("\n").map((s) => s.trim()).filter(Boolean);
        const people = linesOf("people").map((line) => {
          const parts = line.split("|").map((s) => s.trim());
          return parts[1] ? { name: parts[0], contact: parts[1] } : { name: parts[0] };
        }).filter((x) => x.name);
        await setCfg(env, "safety_plan", {
          warning_signs: linesOf("warning_signs"),
          coping: linesOf("coping"),
          distraction: linesOf("distraction"),
          people,
          environment: linesOf("environment"),
          updated_at: new Date().toISOString()
        });
      }
      return page("saved", "<h1>Saved.</h1><p>It will use this if you ever need it.</p><p><a class='q' href='/wb/plan?t=" + esc(t) + "'>back</a></p>");
    }
    const ta = (k, label, hint, val) =>
      "<p class='q'>" + label + (hint ? " <span style='opacity:.7'>" + hint + "</span>" : "") + "</p>" +
      "<textarea name='" + k + "'>" + esc((val || []).join("\n")) + "</textarea>";
    const sp = WB.safetyPlanBlock(plan, c);
    return page("safety plan",
      "<h1>Your safety plan</h1>" +
      "<p class='q'>One item per line, in your own words. Written now, while it is not an emergency. It is read only by the escalation message.</p>" +
      "<form method='post'>" +
      ta("warning_signs", "1. What it looks like when it starts", "your earliest signs", plan.warning_signs) +
      ta("coping", "2. What has worked before, on your own", "no one else needed", plan.coping) +
      ta("distraction", "3. Where to go, or who to be near", "places that ask nothing of you", plan.distraction) +
      ta("people", "4. People you can tell", "Name | phone or email", (plan.people || []).map((x) => (typeof x === "string" ? x : (x.contact ? x.name + " | " + x.contact : x.name)))) +
      "<p class='q'>5. Services: " + esc((c.crisis_lines || []).map((l) => (l.label || "") + " " + (l.number || "")).join(" · ") || "none on file") + "</p>" +
      ta("environment", "6. Making the flat safer for tonight", "", plan.environment) +
      "<p><button class='b' type='submit'>save</button></p></form>" +
      (sp.missing.length
        ? "<p class='q'>Still empty: " + esc(sp.missing.join(", ")) + "</p>"
        : "<p class='q'>All six steps have something in them.</p>")
    );
  }

  // The owner fills the two things the machine cannot infer. Token-gated like everything else.
  if (p === "/wb/settings") {
    if (request.method === "POST") {
      let fd = null;
      try { fd = await request.formData(); } catch { /* not a form */ }
      if (fd) {
        const cand = fd.get("contact_candidates");
        if (cand !== null) {
          const list = String(cand).split(",").map((s) => s.trim()).filter(Boolean);
          await setCfg(env, "contact_candidates", list);
        }
        for (const k of ["backstop_name", "backstop_contact", "presence_line"]) {
          const v = fd.get(k);
          if (v !== null) await setCfg(env, k, String(v).trim());
        }
        for (const k of ["quiet_start", "quiet_end"]) {
          const v = fd.get(k);
          if (v !== null && String(v).trim() !== "" && !Number.isNaN(Number(v))) await setCfg(env, k, Number(v));
        }
      }
      return page("saved", "<h1>Saved.</h1><p>It will use this from the next tick.</p><p><a class='q' href='/wb/settings?t=" + esc(t) + "'>back</a></p>");
    }
    const v = (x, d = "") => esc(x === undefined || x === null ? d : x);
    const cands = Array.isArray(c.crisis_lines) ? c.crisis_lines : [];
    return page("settings",
      "<h1>What only you can tell it</h1>" +
      "<form method='post'>" +
      "<p class='q'>people it may name on the contact rung (comma separated)</p>" +
      "<input name='contact_candidates' value='" + v((c.contact_candidates || []).join(", ")) + "'>" +
      "<p class='q'>backstop name - the person it names if you say something that scares it</p>" +
      "<input name='backstop_name' value='" + v(c.backstop_name) + "'>" +
      "<p class='q'>how to reach them</p>" +
      "<input name='backstop_contact' value='" + v(c.backstop_contact) + "'>" +
      "<p class='q'>quiet from / until (local hour, 22 and 7.5 by default)</p>" +
      "<input name='quiet_start' value='" + v(c.quiet_start) + "' style='width:5rem'> " +
      "<input name='quiet_end' value='" + v(c.quiet_end) + "' style='width:5rem'>" +
      "<p class='q'>what it says when it only wants to be present</p>" +
      "<input name='presence_line' value='" + v(c.presence_line) + "'>" +
      "<p><button class='b' type='submit'>save</button></p>" +
      "</form>" +
      "<p class='q' style='margin-top:2rem'>crisis lines on file: " +
      esc(cands.map((l) => (l && l.label ? l.label + " " + (l.number || "") : (l && l.number) || "")).join(" · ") || "none") +
      "</p>"
    );
  }

  if (p === "/api/wellbeing") {
    const pack = await context(env, null, c);
    const gaps = [];
    if (!c.backstop_contact && !c.backstop_name) gaps.push("backstop_contact");
    if (!Array.isArray(c.crisis_lines) || !c.crisis_lines.length) gaps.push("crisis_lines");
    if (!env.WELLBEING_TOKEN) gaps.push("WELLBEING_TOKEN secret");
    const trend = await env.PERSONAL.prepare("SELECT * FROM v_wellbeing_trend ORDER BY day DESC LIMIT 30").all();
    const cov = await env.PERSONAL.prepare("SELECT * FROM v_wellbeing_coverage").all();
    return new Response(JSON.stringify({
      ok: true,
      day: pack.day, hour: pack.hour, checked_in: pack.checked_in,
      context: pack.ctx, drift: pack.drift,
      config_gaps: gaps,
      plan_missing: WB.safetyPlanBlock(c.safety_plan || {}, c).missing,
      coverage: (cov.results || [])[0] || null,
      loop: await loopRows(env),
      trend: trend.results || [],
      nudges: (await recentNudges(env, 12)).map((n) => ({ id: n.id, ts: n.ts, kind: n.kind, step: n.ladder_step, state: n.state, ask: n.ask, response: n.response }))
    }, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  }

  return null;
}
