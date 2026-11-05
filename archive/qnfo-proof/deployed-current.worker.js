var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var VERSION = "0.1.0";
var WORKER_NAME = "qnfo-proof";
var BASE_URL = "https://qnfo-proof.q08.workers.dev";
var CLEARED_CHILD_STATES = ["validated", "admitted", "archived"];
var SEVERITIES = ["critical", "major", "minor", "note"];
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Proof-Token"
};
function json(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: { "content-type": "application/json" } });
}
__name(json, "json");
function err(message, status) {
  return json({ error: message }, status || 400);
}
__name(err, "err");
async function sha256hex(str) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(digest)).map(function(b) {
    return b.toString(16).padStart(2, "0");
  }).join("");
}
__name(sha256hex, "sha256hex");
async function getNode(env, proofId, nodeId) {
  return env.PROOF_DB.prepare("SELECT * FROM proof_nodes WHERE proof_id = ? AND node_id = ?").bind(proofId, nodeId).first();
}
__name(getNode, "getNode");
async function appendEvent(env, proofId, type, payload) {
  const last = await env.PROOF_DB.prepare(
    "SELECT seq, hash FROM proof_events WHERE proof_id = ? ORDER BY seq DESC LIMIT 1"
  ).bind(proofId).first();
  const seq = (last ? last.seq : 0) + 1;
  const prevHash = last ? last.hash : "genesis";
  const canonical = JSON.stringify({ proofId, seq, type, payload });
  const hash = await sha256hex(prevHash + ":" + canonical);
  await env.PROOF_DB.prepare(
    "INSERT INTO proof_events (proof_id, seq, type, payload, ts, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(proofId, seq, type, canonical, Date.now(), prevHash, hash).run();
  return { seq, hash };
}
__name(appendEvent, "appendEvent");
function computeTaint(node, childrenByParent, parentById) {
  const anc = [];
  let p = parentById.get(node.node_id);
  while (p) {
    anc.push(p);
    p = parentById.get(p.node_id);
  }
  const desc = [];
  const stack = (childrenByParent.get(node.node_id) || []).slice();
  while (stack.length) {
    const c = stack.pop();
    desc.push(c);
    const more = childrenByParent.get(c.node_id) || [];
    for (const m of more) stack.push(m);
  }
  if (node.state === "archived" || node.state === "refuted") return "clean";
  if (node.state === "admitted") return "self_admitted";
  const activeDesc = desc.filter(function(d) {
    return d.state !== "archived" && d.state !== "refuted";
  });
  const unresolved = /* @__PURE__ */ __name(function(n) {
    return n.state === "pending" || n.state === "needs_refinement";
  }, "unresolved");
  if (unresolved(node) || anc.some(unresolved) || activeDesc.some(unresolved)) return "unresolved";
  if (anc.some(function(a) {
    return a.state === "admitted";
  }) || activeDesc.some(function(d) {
    return d.state === "admitted";
  })) return "tainted";
  return "clean";
}
__name(computeTaint, "computeTaint");
function buildTaint(nodes) {
  const parentById = /* @__PURE__ */ new Map();
  const childrenByParent = /* @__PURE__ */ new Map();
  for (const n of nodes) {
    if (n.parent_id) {
      const p = nodes.find(function(x) {
        return x.node_id === n.parent_id;
      });
      if (p) parentById.set(n.node_id, p);
      const arr = childrenByParent.get(n.parent_id) || [];
      arr.push(n);
      childrenByParent.set(n.parent_id, arr);
    }
  }
  const out = {};
  for (const n of nodes) out[n.node_id] = computeTaint(n, childrenByParent, parentById);
  return out;
}
__name(buildTaint, "buildTaint");
function cmpId(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = i < pa.length ? pa[i] : 0;
    const y = i < pb.length ? pb[i] : 0;
    if (x !== y) return x - y;
  }
  return 0;
}
__name(cmpId, "cmpId");
async function loadNodes(env, proofId) {
  const res = await env.PROOF_DB.prepare("SELECT * FROM proof_nodes WHERE proof_id = ?").bind(proofId).all();
  return res.results || [];
}
__name(loadNodes, "loadNodes");
async function handleInit(env, body) {
  const conjecture = String(body.conjecture || "").trim();
  if (!conjecture) return err("conjecture required");
  const author = String(body.author || body.owner || "unknown").trim();
  const proofId = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const now = Date.now();
  await env.PROOF_DB.prepare(
    "INSERT INTO proofs (id, conjecture, author, status, paper_slug, paper_doi, created_at, updated_at) VALUES (?, ?, ?, 'open', ?, ?, ?, ?)"
  ).bind(proofId, conjecture, author, body.paper_slug || null, body.paper_doi || null, now, now).run();
  await env.PROOF_DB.prepare(
    "INSERT INTO proof_nodes (proof_id, node_id, parent_id, statement, state, author, created_at) VALUES (?, '1', NULL, ?, 'pending', ?, ?)"
  ).bind(proofId, conjecture, author, now).run();
  await appendEvent(env, proofId, "proof_initialized", { conjecture, author, paper_slug: body.paper_slug || null, paper_doi: body.paper_doi || null });
  return json({ proof_id: proofId, root: "1", conjecture });
}
__name(handleInit, "handleInit");
async function handleClaim(env, proofId, nodeId, body) {
  const node = await getNode(env, proofId, nodeId);
  if (!node) return err("node not found", 404);
  const owner = String(body.owner || "").trim();
  if (!owner) return err("owner required");
  const role = body.role === "prover" || body.role === "verifier" ? body.role : null;
  await env.PROOF_DB.prepare(
    "UPDATE proof_nodes SET claimed_by = ?, claim_role = ?, claim_expires = ? WHERE proof_id = ? AND node_id = ?"
  ).bind(owner, role, Date.now() + 36e5, proofId, nodeId).run();
  await appendEvent(env, proofId, "node_claimed", { nodeId, owner, role });
  return json({ ok: true, node: nodeId, claimed_by: owner, role });
}
__name(handleClaim, "handleClaim");
async function handleRelease(env, proofId, nodeId, body) {
  const node = await getNode(env, proofId, nodeId);
  if (!node) return err("node not found", 404);
  await env.PROOF_DB.prepare("UPDATE proof_nodes SET claimed_by = NULL, claim_role = NULL, claim_expires = NULL WHERE proof_id = ? AND node_id = ?").bind(proofId, nodeId).run();
  await appendEvent(env, proofId, "node_released", { nodeId, by: body.owner || null });
  return json({ ok: true });
}
__name(handleRelease, "handleRelease");
async function handleRefine(env, proofId, nodeId, body) {
  const node = await getNode(env, proofId, nodeId);
  if (!node) return err("node not found", 404);
  if (node.state !== "pending" && node.state !== "needs_refinement") return err("cannot refine " + node.state + " node", 409);
  const owner = String(body.owner || "").trim();
  if (!owner) return err("owner required");
  const children = Array.isArray(body.children) ? body.children.map(function(s) {
    return String(s).trim();
  }).filter(Boolean) : [];
  if (!children.length) return err("children required");
  const row = await env.PROOF_DB.prepare(
    "SELECT COUNT(*) AS c FROM proof_nodes WHERE proof_id = ? AND parent_id = ?"
  ).bind(proofId, nodeId).first();
  const start = (row ? row.c : 0) + 1;
  const now = Date.now();
  const added = [];
  for (let i = 0; i < children.length; i++) {
    const id = nodeId + "." + (start + i);
    await env.PROOF_DB.prepare(
      "INSERT INTO proof_nodes (proof_id, node_id, parent_id, statement, state, author, created_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)"
    ).bind(proofId, id, nodeId, children[i], owner, now).run();
    added.push(id);
  }
  await appendEvent(env, proofId, "node_refined", { nodeId, children: added, author: owner });
  return json({ ok: true, added });
}
__name(handleRefine, "handleRefine");
async function handleChallenge(env, proofId, nodeId, body) {
  const node = await getNode(env, proofId, nodeId);
  if (!node) return err("node not found", 404);
  if (node.state === "validated" || node.state === "admitted" || node.state === "refuted" || node.state === "archived") {
    return err("cannot challenge " + node.state + " node", 409);
  }
  const reason = String(body.reason || "").trim();
  if (!reason) return err("reason required");
  const severity = SEVERITIES.includes(body.severity) ? body.severity : "major";
  const owner = String(body.owner || "").trim();
  if (!owner) return err("owner required");
  const res = await env.PROOF_DB.prepare(
    "INSERT INTO proof_challenges (proof_id, node_id, severity, aspect, reason, status, raised_by, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)"
  ).bind(proofId, nodeId, severity, body.aspect || null, reason, owner, Date.now()).run();
  await appendEvent(env, proofId, "challenge_raised", { nodeId, challenge_id: res.meta.last_row_id, severity, reason, raised_by: owner });
  return json({ ok: true, challenge_id: res.meta.last_row_id, severity });
}
__name(handleChallenge, "handleChallenge");
async function handleResolve(env, proofId, nodeId, body) {
  const challenge = await env.PROOF_DB.prepare(
    "SELECT * FROM proof_challenges WHERE proof_id = ? AND node_id = ? AND id = ?"
  ).bind(proofId, nodeId, body.challenge_id).first();
  if (!challenge) return err("challenge not found", 404);
  if (challenge.status !== "open") return err("challenge not open", 409);
  const response = String(body.response || "").trim();
  if (!response) return err("response required");
  const by = String(body.owner || "").trim();
  if (!by) return err("owner required");
  if (by === challenge.raised_by) return err("challenge must be resolved by someone other than the raiser (adversarial boundary)", 409);
  await env.PROOF_DB.prepare(
    "UPDATE proof_challenges SET status = 'resolved', response = ?, resolved_by = ?, resolved_at = ? WHERE id = ?"
  ).bind(response, by, Date.now(), challenge.id).run();
  await appendEvent(env, proofId, "challenge_resolved", { nodeId, challenge_id: challenge.id, response, resolved_by: by });
  return json({ ok: true, challenge_id: challenge.id });
}
__name(handleResolve, "handleResolve");
async function handleAccept(env, proofId, nodeId, body) {
  const node = await getNode(env, proofId, nodeId);
  if (!node) return err("node not found", 404);
  if (node.state !== "pending" && node.state !== "needs_refinement") return err("cannot accept " + node.state + " node", 409);
  const verifier = String(body.owner || "").trim();
  if (!verifier) return err("owner required");
  if (!body.allow_self && verifier === (node.author || "")) {
    return err("self-acceptance refused: verifier must differ from author (trust-model gap #3 guard)", 409);
  }
  const openCh = await env.PROOF_DB.prepare(
    "SELECT COUNT(*) AS c FROM proof_challenges WHERE proof_id = ? AND node_id = ? AND status = 'open'"
  ).bind(proofId, nodeId).first();
  if (openCh && openCh.c > 0) return err("node has " + openCh.c + " open challenge(s)", 409);
  const childrenRes = await env.PROOF_DB.prepare(
    "SELECT node_id, state FROM proof_nodes WHERE proof_id = ? AND parent_id = ?"
  ).bind(proofId, nodeId).all();
  const children = childrenRes.results || [];
  const bad = children.filter(function(r) {
    return CLEARED_CHILD_STATES.indexOf(r.state) < 0;
  });
  if (bad.length) {
    return err("children not cleared: " + bad.map(function(r) {
      return r.node_id + "(" + r.state + ")";
    }).join(", "), 409);
  }
  const archivedChildren = children.filter(function(r) {
    return r.state === "archived";
  }).map(function(r) {
    return r.node_id;
  });
  const admittedChildren = children.filter(function(r) {
    return r.state === "admitted";
  }).map(function(r) {
    return r.node_id;
  });
  await env.PROOF_DB.prepare(
    "UPDATE proof_nodes SET state = 'validated', verifier = ? WHERE proof_id = ? AND node_id = ?"
  ).bind(verifier, proofId, nodeId).run();
  await appendEvent(env, proofId, "node_accepted", {
    nodeId,
    verifier,
    warn_archived_children: archivedChildren.length ? archivedChildren : null,
    warn_admitted_children: admittedChildren.length ? admittedChildren : null
  });
  if (nodeId === "1") {
    await env.PROOF_DB.prepare("UPDATE proofs SET status = 'complete', updated_at = ? WHERE id = ?").bind(Date.now(), proofId).run();
  }
  return json({ ok: true, node: nodeId, state: "validated" });
}
__name(handleAccept, "handleAccept");
async function handleAdmit(env, proofId, nodeId, body) {
  const node = await getNode(env, proofId, nodeId);
  if (!node) return err("node not found", 404);
  if (node.state !== "pending" && node.state !== "needs_refinement") return err("cannot admit " + node.state + " node", 409);
  await env.PROOF_DB.prepare("UPDATE proof_nodes SET state = 'admitted' WHERE proof_id = ? AND node_id = ?").bind(proofId, nodeId).run();
  await appendEvent(env, proofId, "node_admitted", { nodeId, by: String(body.owner || "").trim() });
  return json({ ok: true, node: nodeId, state: "admitted" });
}
__name(handleAdmit, "handleAdmit");
async function handleRefute(env, proofId, nodeId, body) {
  const node = await getNode(env, proofId, nodeId);
  if (!node) return err("node not found", 404);
  await env.PROOF_DB.prepare("UPDATE proof_nodes SET state = 'refuted' WHERE proof_id = ? AND node_id = ?").bind(proofId, nodeId).run();
  await appendEvent(env, proofId, "node_refuted", { nodeId, by: String(body.owner || "").trim(), note: body.note || null });
  return json({ ok: true, node: nodeId, state: "refuted" });
}
__name(handleRefute, "handleRefute");
async function handleArchive(env, proofId, nodeId, body) {
  const node = await getNode(env, proofId, nodeId);
  if (!node) return err("node not found", 404);
  const openCh = await env.PROOF_DB.prepare(
    "SELECT COUNT(*) AS c FROM proof_challenges WHERE proof_id = ? AND node_id = ? AND status = 'open'"
  ).bind(proofId, nodeId).first();
  if (openCh && openCh.c > 0) {
    return err("archive refused: " + openCh.c + " open challenge(s) (trust-model gap #1 guard)", 409);
  }
  await env.PROOF_DB.prepare("UPDATE proof_nodes SET state = 'archived' WHERE proof_id = ? AND node_id = ?").bind(proofId, nodeId).run();
  await appendEvent(env, proofId, "node_archived", { nodeId, by: String(body.owner || "").trim() });
  return json({ ok: true, node: nodeId, state: "archived" });
}
__name(handleArchive, "handleArchive");
async function handleStatus(env, proofId) {
  const proof = await env.PROOF_DB.prepare("SELECT * FROM proofs WHERE id = ?").bind(proofId).first();
  if (!proof) return err("proof not found", 404);
  const nodes = await loadNodes(env, proofId);
  const taint = buildTaint(nodes);
  const chRes = await env.PROOF_DB.prepare(
    "SELECT node_id, COUNT(*) AS open FROM proof_challenges WHERE proof_id = ? AND status = 'open' GROUP BY node_id"
  ).bind(proofId).all();
  const openByNode = {};
  for (const c of chRes.results || []) openByNode[c.node_id] = c.open;
  const outNodes = nodes.map(function(n) {
    return {
      id: n.node_id,
      parent: n.parent_id,
      statement: n.statement,
      state: n.state,
      taint: taint[n.node_id],
      author: n.author,
      verifier: n.verifier,
      open_challenges: openByNode[n.node_id] || 0
    };
  }).sort(function(a, b) {
    return cmpId(a.id, b.id);
  });
  const root = outNodes.find(function(n) {
    return n.id === "1";
  }) || {};
  return json({
    proof: { id: proof.id, conjecture: proof.conjecture, author: proof.author, status: proof.status, paper_slug: proof.paper_slug, paper_doi: proof.paper_doi },
    root_state: root.state,
    root_taint: root.taint,
    node_count: outNodes.length,
    nodes: outNodes
  });
}
__name(handleStatus, "handleStatus");
async function handleExport(env, proofId) {
  const proof = await env.PROOF_DB.prepare("SELECT * FROM proofs WHERE id = ?").bind(proofId).first();
  if (!proof) return err("proof not found", 404);
  const nodes = await loadNodes(env, proofId);
  const taint = buildTaint(nodes);
  const byId = {};
  const kids = {};
  for (const n of nodes) {
    byId[n.node_id] = n;
    if (n.parent_id) (kids[n.parent_id] = kids[n.parent_id] || []).push(n.node_id);
  }
  for (const k in kids) kids[k].sort(cmpId);
  const lines = [];
  (/* @__PURE__ */ __name((function emit(id, depth) {
    const n = byId[id];
    if (!n) return;
    lines.push("  ".repeat(depth) + id + " [" + n.state + "/" + taint[id] + "] " + n.statement);
    for (const c of kids[id] || []) emit(c, depth + 1);
  }), "emit"))("1", 0);
  const NL = String.fromCharCode(10);
  return new Response(
    "# Proof: " + proof.conjecture + NL + NL + lines.join(NL) + NL,
    { headers: { "content-type": "text/markdown; charset=utf-8" } }
  );
}
__name(handleExport, "handleExport");
async function handleList(env) {
  const res = await env.PROOF_DB.prepare(
    "SELECT id, conjecture, author, status, paper_slug, paper_doi, created_at FROM proofs ORDER BY created_at DESC LIMIT 50"
  ).all();
  return json({ count: (res.results || []).length, proofs: res.results || [] });
}
__name(handleList, "handleList");
async function selfRegister(env) {
  const manifest = {
    service: WORKER_NAME,
    kind: "worker",
    version: VERSION,
    base_url: BASE_URL,
    purpose: "adversarial proof verification ledger: Lamport-style structured proof trees with prover/verifier challenge cycles, taint tracking, hash-chained event ledger (server-side port of tobiasosborne/vibefeld protocol)",
    capabilities: ["proof-ledger", "lamport-structured-proofs", "adversarial-verification", "taint-tracking", "hash-chain-ledger", "markdown-export"],
    routes: ["/health", "/proofs", "/proofs/:id/status", "/proofs/:id/export"],
    tools: [],
    models: [],
    deps: ["qnfo-audit D1 (proofs/proof_events/proof_nodes/proof_challenges)", "qnfo-ops registry"]
  };
  const resp = await env.QNFO_OPS.fetch("https://qnfo-ops.internal/registry/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + (env.REGISTRY_TOKEN || "") },
    body: JSON.stringify(manifest)
  });
  return resp.ok;
}
__name(selfRegister, "selfRegister");
var worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let path = url.pathname;
    while (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    if (!path) path = "/";
    const method = request.method;
    if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (path === "/health" && method === "GET") {
      if (ctx && ctx.waitUntil && env.QNFO_OPS && env.REGISTRY_TOKEN) {
        ctx.waitUntil(selfRegister(env).catch(function(e) {
          console.log("self-register err", e && e.message || e);
        }));
      }
      return json({ ok: true, worker: WORKER_NAME, version: VERSION, engine: "vibefeld-protocol-port", auth: "x-proof-token (mutations)", ledger: "qnfo-audit D1, hash-chained" });
    }
    const parts = path.split("/").filter(Boolean);
    if (method === "GET") {
      if (parts.length === 1 && parts[0] === "proofs") return handleList(env);
      if (parts.length === 3 && parts[0] === "proofs" && parts[2] === "status") return handleStatus(env, parts[1]);
      if (parts.length === 3 && parts[0] === "proofs" && parts[2] === "export") return handleExport(env, parts[1]);
      return err("not found", 404);
    }
    if (method === "POST") {
      if (!env.PROOF_TOKEN) return err("proof engine not configured (PROOF_TOKEN unset) - fail closed", 503);
      const tok = request.headers.get("x-proof-token") || "";
      if (tok !== env.PROOF_TOKEN) return err("unauthorized", 401);
      let body = {};
      try {
        body = await request.json();
      } catch (e) {
        body = {};
      }
      if (parts.length === 1 && parts[0] === "proofs") return handleInit(env, body);
      if (parts.length >= 4 && parts[0] === "proofs" && parts[2] === "nodes") {
        const proofId = parts[1];
        const nodeId = parts[3];
        const action = parts[4] || "";
        switch (action) {
          case "claim":
            return handleClaim(env, proofId, nodeId, body);
          case "release":
            return handleRelease(env, proofId, nodeId, body);
          case "refine":
            return handleRefine(env, proofId, nodeId, body);
          case "challenge":
            return handleChallenge(env, proofId, nodeId, body);
          case "resolve-challenge":
            return handleResolve(env, proofId, nodeId, body);
          case "accept":
            return handleAccept(env, proofId, nodeId, body);
          case "admit":
            return handleAdmit(env, proofId, nodeId, body);
          case "refute":
            return handleRefute(env, proofId, nodeId, body);
          case "archive":
            return handleArchive(env, proofId, nodeId, body);
          default:
            return err("unknown action: " + action, 404);
        }
      }
      return err("not found", 404);
    }
    return err("method not allowed", 405);
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map