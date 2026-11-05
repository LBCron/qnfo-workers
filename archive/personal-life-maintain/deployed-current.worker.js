const MEM_DECAY_HALF_LIFE_DAYS = 90;
const MEM_PRUNE_EFFECTIVE_IMPORTANCE = 0.2;
function json(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}
async function runMemoryMaintain(env, opts) {
  opts = opts || {};
  var commit = !!opts.commit;
  var result = { status: "memory-maintained", plane: "personal", commit: commit, timestamp: new Date().toISOString(), scanned: 0, decayed: 0, expired: 0, deduped: 0, pruned: 0, ids: [] };
  try {
    var rows = await env.PERSONAL.prepare("SELECT id, category, content, summary, importance, session_id, created_at, expires_at FROM agent_memories").all();
    var mems = rows.results || [];
    result.scanned = mems.length;
    var now = Date.now();
    var pruneIds = new Set();
    for (var i = 0; i < mems.length; i++) {
      var m = mems[i];
      var importance = m.importance != null ? Number(m.importance) : 0.7;
      if (m.expires_at) {
        var exp = new Date(m.expires_at).getTime();
        if (!isNaN(exp) && exp <= now) { pruneIds.add(m.id); result.expired++; continue; }
      }
      var created = new Date(m.created_at).getTime();
      if (isNaN(created)) continue;
      var ageDays = (now - created) / 864e5;
      var effective = importance * Math.pow(0.5, ageDays / MEM_DECAY_HALF_LIFE_DAYS);
      if (effective < MEM_PRUNE_EFFECTIVE_IMPORTANCE) { pruneIds.add(m.id); result.decayed++; }
    }
    var byCat = {};
    for (var j = 0; j < mems.length; j++) {
      var mm = mems[j];
      if (pruneIds.has(mm.id)) continue;
      var key = mm.category + "::" + String(mm.content || "").toLowerCase().replace(/\s+/g, " ").trim();
      if (!byCat[key]) byCat[key] = [];
      byCat[key].push(mm);
    }
    for (var k in byCat) {
      var group = byCat[k];
      if (group.length < 2) continue;
      group.sort(function(a, b) { return (Number(b.importance) || 0) - (Number(a.importance) || 0); });
      for (var g = 1; g < group.length; g++) {
        var dup = group[g];
        if (pruneIds.has(dup.id)) continue;
        pruneIds.add(dup.id); result.deduped++;
      }
    }
    if (commit && pruneIds.size) {
      var ids = Array.from(pruneIds);
      for (var c = 0; c < ids.length; c += 100) {
        var chunk = ids.slice(c, c + 100);
        var ph = chunk.map(function() { return "?"; }).join(",");
        await env.PERSONAL.prepare("DELETE FROM agent_memories WHERE id IN (" + ph + ")").bind.apply(null, chunk).run();
        await env.VZ.deleteByIds(chunk).catch(function(e) { console.error("[personal-maintain] VZ delete error:", e.message); });
      }
    }
    result.pruned = pruneIds.size;
    result.ids = Array.from(pruneIds).slice(0, 50);
    if (commit) {
      await env.PERSONAL.prepare("INSERT INTO memory_maintain_runs (run_id, plane, scanned, pruned, decayed, expired, deduped, notes, created_at) VALUES (?, 'personal', ?, ?, ?, ?, ?, ?, datetime('now'))").bind("memory-maintain-" + Date.now(), result.scanned, result.pruned, result.decayed, result.expired, result.deduped, JSON.stringify(result.ids)).run().catch(function(e) { console.error("[personal-maintain] run record error:", e.message); });
    }
  } catch (e) { result.error = e.message; }
  return result;
}
export default {
  async fetch(request, env) {
    var url = new URL(request.url), p = url.pathname;
    if (p === "/health") return json({ status: "ok", worker: "personal-life-maintain", version: "0.1", plane: "personal", bindings: { d1: !!env.PERSONAL, vz: !!env.VZ }, cron: "0 2 * * *" });
    if (p === "/run/memory-maintain") {
      var q = url.searchParams;
      var commit = q.get("commit") === "1" || q.get("commit") === "true";
      var result = await runMemoryMaintain(env, { commit: commit });
      return json(result);
    }
    return json({ error: "not found" }, 404);
  },
  async scheduled(event, env, ctx) {
    console.log("[personal-life-maintain] cron:", event.cron);
    try { var r = await runMemoryMaintain(env, { commit: true }); console.log("[personal-life-maintain] done:", JSON.stringify({ scanned: r.scanned, pruned: r.pruned })); }
    catch (e) { console.error("[personal-life-maintain] error:", e.message); }
  }
};