#!/usr/bin/env python3
"""FOLD-KIT-1/2 (docs/TRANSFORMATION-PROGRAM.md T3 lever 14, pillar autonomy): fold one worker into another in one command.

FOLD-KIT-2 (2026-10-06, CALENDAR-FOLD-2): --public-route "METHODS /path[*]" (method, query and body kept, no binding props),
--callers for binders not named qnfo-*, --env-derive (an HMAC of a host secret, so a guest secret that cannot be copied is
replaced without exposing the host secret to the member) and --env-const; a host with an older runtime is refused.

Fold waves 1 to 3 (2026-10-06, PRs 668, 672, 674) moved nine workers into hosts by hand-written builders, each editing the
host's own fetch and scheduled handlers. This kit does the same job without touching the host's handlers:

  * the guest bundle runs unchanged inside an IIFE (`var <member> = (function () { ...; return <guest default>; })();`):
    its single-line imports become aliased host imports, its `var VERSION = "..."` line becomes the member version, and its
    default export becomes the IIFE's return value. A guest that exports anything else (a Durable Object or Workflow class)
    is refused: those carry state and move by hand.
  * the host's default export is wrapped by one runtime helper (`__foldWrap`, inserted once per host): a service-binding
    call whose props name the member (`props.member`, with a `qnfo-*` caller) goes to the member with the mapped env, a GET
    of `<prefix>/health` (and any `--public` path) goes to the member, everything else goes to the host unchanged; on every
    host tick the member's job for that tick (`--due`, a JS expression over `ms` and `cron` that returns the guest's own
    cron string or null) runs as a table entry with a collecting ctx and is awaited next to the host's own scheduled work.
  * wrangler.toml: guest bindings the host lacks are appended; a guest binding whose name the host uses for a different
    resource must be mapped with `--env-map`; Durable Objects and Workflows are refused; the guest's crons are dropped (the
    member runs on the host's existing trigger, the lesson of fold wave 1: a newly registered trigger never fired).
  * every live wrangler.toml that binds the guest is re-pointed to the host with `props.member` (SERVICE-REPOINT-1 in
    scripts/cf_ops_actions.py unbinds the old binding after the merge).
  * writes the guest's FOLDED marker, the host mirror, and `<host>/<guest>-fold.test.mjs` (parity, routing, schedule).

Usage (from the repository root):
  python3 scripts/fold_worker.py calendar-api personal-companion --member-version 0.7.2-folded \\
    --host-version 1.11.0-calendar-fold --note "CALENDAR-FOLD-1 (...)" --prefix /calendar \\
    --due '"17 * * * *"' --why "agent_issues 2010, T3.10"
It prints the post-merge runbook (unbind, delete-worker, ledgers). --dry-run writes nothing.
"""
import argparse
import datetime
import json
import os
import re
import sys
import tomllib

RUNTIME_BEGIN = "// ---- FOLD-KIT-1:RUNTIME:BEGIN ----"
RUNTIME = RUNTIME_BEGIN + """
// FOLD-KIT-2 (scripts/fold_worker.py): wraps a host's default export with one folded member. A service-binding call whose
// props name the member (props.member, with a qnfo-* caller or one of m.callers), GET <prefix>/health, the member's public
// GET paths and its public routes (m.publicRoutes: methods, exact path or prefix, body kept) reach the member with its
// mapped env; everything else reaches the host unchanged. A public request reaches the member without binding props. The
// member env is least privilege: its own names, m.consts, and m.derive values (HMAC-SHA256 of a host secret over
// "fold-kit|<member>|<name>", so the member never sees the host secret itself). On every host tick the member's job for that
// tick (m.due) runs as a table entry with a collecting ctx and is awaited next to the host's own work.
function __foldWrap(host, m) {
  var derived = null;
  async function memberEnv(env) {
    var e = m.env(env), dk = Object.keys(m.derive || {});
    if (m.consts) Object.assign(e, m.consts);
    if (dk.length) {
      if (!derived) {
        var d = {};
        for (var i = 0; i < dk.length; i++) {
          var src = env[m.derive[dk[i]]];
          if (typeof src !== "string" || !src) continue;
          var key = await crypto.subtle.importKey("raw", new TextEncoder().encode(src), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
          var sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("fold-kit|" + m.name + "|" + dk[i])));
          d[dk[i]] = Array.from(sig).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
        }
        derived = d;
      }
      Object.assign(e, derived);
    }
    return e;
  }
  function publicCtx(ctx) {
    return { props: {}, waitUntil: function (x) { if (ctx && ctx.waitUntil) ctx.waitUntil(x); }, passThroughOnException: function () {} };
  }
  var wrapped = Object.assign({}, host, {
    async fetch(request, env, ctx) {
      var p = ctx && ctx.props, c = String(p && p.caller || "");
      if (p && p.member === m.name && (/^qnfo-[a-z0-9-]{1,60}$/.test(c) || (m.callers || []).indexOf(c) >= 0)) {
        var req = request, menv = await memberEnv(env);
        if (m.tokenHeader) {
          var nonce = crypto.randomUUID(), hh = new Headers(request.headers);
          hh.set(m.tokenHeader, m.tokenScheme === "bearer" ? "Bearer " + nonce : nonce);
          req = new Request(request, { headers: hh });
          if (m.tokenEnv) menv[m.tokenEnv] = nonce;
        }
        return m.mod.fetch(req, menv, ctx);
      }
      var u = new URL(request.url);
      if (request.method === "GET") {
        if (u.pathname === m.prefix + "/health") return m.mod.fetch(new Request(new URL("/health", request.url)), await memberEnv(env), publicCtx(ctx));
        for (var i = 0; i < m.publicPaths.length; i++) {
          if (u.pathname === m.prefix + m.publicPaths[i]) return m.mod.fetch(new Request(new URL(m.publicPaths[i] + u.search, request.url)), await memberEnv(env), publicCtx(ctx));
        }
      }
      var rs = m.publicRoutes || [];
      for (var j = 0; j < rs.length; j++) {
        var r = rs[j], full = m.prefix + r.path;
        var hit = r.prefix ? u.pathname.indexOf(full) === 0 && u.pathname.length > full.length : u.pathname === full;
        if (hit && r.methods.indexOf(request.method) >= 0) {
          var body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
          return m.mod.fetch(new Request(new URL(u.pathname.slice(m.prefix.length) + u.search, request.url), { method: request.method, headers: request.headers, body: body }), await memberEnv(env), publicCtx(ctx));
        }
      }
      return host.fetch ? host.fetch(request, env, ctx) : new Response("not found", { status: 404 });
    },
    async scheduled(event, env, ctx) {
      var at = Number(event && event.scheduledTime) || Date.now(), job = null;
      try { job = m.due(at, event && event.cron); } catch (e) { job = null; }
      var run = null;
      if (job && m.mod.scheduled) {
        var pending = [], menv2 = await memberEnv(env);
        run = Promise.resolve(m.mod.scheduled({ cron: job, scheduledTime: at, type: "scheduled", tickEntry: true }, menv2, { waitUntil: function (x) { pending.push(Promise.resolve(x)); }, passThroughOnException: function () {} }))
          .then(function () { return Promise.allSettled(pending); })
          .catch(function (e) { console.error(m.name + " member: " + String(e && e.message || e)); });
      }
      var own = host.scheduled ? Promise.resolve(host.scheduled(event, env, ctx)) : null;
      var out = await Promise.allSettled([run, own]);
      if (out[1] && out[1].status === "rejected") throw out[1].reason;
    }
  });
  Object.defineProperty(wrapped, "__foldHost", { value: host, enumerable: false });
  Object.defineProperty(wrapped, "__foldMember", { value: m, enumerable: false });
  return wrapped;
}
// ---- FOLD-KIT-1:RUNTIME:END ----
"""

IMPORT_RE = re.compile(r'^import\s+(.+?)\s+from\s+"([^"]+)";\s*$')
VERSION_RE = re.compile(r'^var VERSION = "([^"]*)";', re.M)
# The final export block, optionally followed by comment lines (a bundler's sourceMappingURL), which group 2 keeps. Each
# trailer line starts after its own newline, so one line can never be split between repetitions (no backtracking blow-up).
EXPORT_BLOCK_RE = re.compile(r'\nexport \{\n([\s\S]*?)\n\};((?:\n[ \t]*//[^\n]*)*)\s*$')


def die(msg):
    sys.exit("fold_worker: " + msg)


def ident(name):
    parts = re.split(r"[^A-Za-z0-9]+", name)
    return parts[0] + "".join(p[:1].upper() + p[1:] for p in parts[1:])


def rd(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def parse_import(line):
    m = IMPORT_RE.match(line)
    if not m:
        return None
    clause, mod = m.group(1).strip(), m.group(2)
    names = []
    if clause.startswith("{") and clause.endswith("}"):
        for part in clause[1:-1].split(","):
            part = part.strip()
            if not part:
                continue
            if " as " in part:
                a, b = [x.strip() for x in part.split(" as ")]
            else:
                a = b = part
            names.append((a, b))
        return {"mod": mod, "named": names, "default": None}
    if re.match(r"^[A-Za-z_$][\w$]*$", clause):
        return {"mod": mod, "named": [], "default": clause}
    die("import shape not supported: " + line)


def transform_guest(guest, src, member_version_const):
    lines = src.split("\n")
    host_imports, aliases, body = [], [], []
    g = ident(guest)
    for line in lines:
        if line.startswith("import "):
            imp = parse_import(line)
            if imp is None:
                die("multi-line or unparsed import in the guest: " + line)
            spec = []
            for a, b in imp["named"]:
                alias = "__fk_" + g + "_" + b
                spec.append(a + " as " + alias)
                aliases.append("var " + b + " = " + alias + ";")
            if imp["default"]:
                alias = "__fk_" + g + "_" + imp["default"]
                host_imports.append("import " + alias + ' from "' + imp["mod"] + '";')
                aliases.append("var " + imp["default"] + " = " + alias + ";")
            if spec:
                host_imports.append("import { " + ", ".join(spec) + ' } from "' + imp["mod"] + '";')
            continue
        body.append(line)
    gsrc = "\n".join(body)
    vm = VERSION_RE.search(gsrc)
    if not vm:
        die("the guest has no `var VERSION = \"...\";` line")
    old_version = vm.group(1)
    gsrc = gsrc[:vm.start()] + "var VERSION = " + member_version_const + "; // member version (FOLD-KIT-1); was " + json.dumps(old_version) + " as its own worker;" + gsrc[vm.end():]
    em = EXPORT_BLOCK_RE.search(gsrc)
    if em:
        entries = [e.strip().rstrip(",") for e in em.group(1).split(",") if e.strip()]
        dflt = [e for e in entries if e.endswith(" as default")]
        others = [e for e in entries if not e.endswith(" as default")]
        if len(dflt) != 1:
            die("the guest export block has no single default export")
        if others:
            die("the guest exports " + ", ".join(others) + " besides its default (Durable Object or Workflow classes move by hand)")
        gsrc = gsrc[:em.start()] + "\nreturn " + dflt[0][: -len(" as default")].strip() + ";\n"
    elif gsrc.count("\nexport default {") == 1:
        # FOLD-RETURN-ORDER-1 (qnfo-model-eval fold, 2026-11-05): a guest written as `export default {...}` may carry top-level statements after it
        # (`var CRON_GRID_CFG = ...`), which are legal in a module because the default export is only a binding. An inline `return {` ended the IIFE
        # before them, so the folded member's `scheduled` read an undefined config and threw on every tick. The default is held in a variable and
        # returned after the guest's last statement.
        holder = "__fk_" + g + "_guestDefault"
        gsrc = gsrc.replace("\nexport default {", "\nvar " + holder + " = {") + "\nreturn " + holder + ";\n"
    else:
        die("no recognisable default export in the guest")
    if re.search(r"^export\s", gsrc, re.M):
        die("the guest still has a top-level export after the rewrite")
    return host_imports, aliases, gsrc, old_version


def toml_bindings(t):
    """(kind, binding name, resource, block text) for every binding the kit knows how to carry."""
    out = []
    for d in t.get("d1_databases", []):
        out.append(("d1", d["binding"], d.get("database_id") or d.get("database_name"), '[[d1_databases]]\nbinding = "%s"\ndatabase_name = "%s"\ndatabase_id = "%s"\n' % (d["binding"], d.get("database_name", ""), d.get("database_id", ""))))
    for d in t.get("r2_buckets", []):
        out.append(("r2", d["binding"], d["bucket_name"], '[[r2_buckets]]\nbinding = "%s"\nbucket_name = "%s"\n' % (d["binding"], d["bucket_name"])))
    for d in t.get("kv_namespaces", []):
        out.append(("kv", d["binding"], d["id"], '[[kv_namespaces]]\nbinding = "%s"\nid = "%s"\n' % (d["binding"], d["id"])))
    for d in t.get("vectorize", []):
        out.append(("vectorize", d["binding"], d["index_name"], '[[vectorize]]\nbinding = "%s"\nindex_name = "%s"\n' % (d["binding"], d["index_name"])))
    for d in t.get("services", []):
        props = d.get("props")
        ptxt = ""
        if props:
            ptxt = "props = { " + ", ".join('%s = "%s"' % (k, v) for k, v in props.items()) + " }\n"
        out.append(("service", d["binding"], d["service"], '[[services]]\nbinding = "%s"\nservice = "%s"\n%s' % (d["binding"], d["service"], ptxt)))
    if "ai" in t:
        out.append(("ai", t["ai"]["binding"], "ai", '[ai]\nbinding = "%s"\n' % t["ai"]["binding"]))
    if "browser" in t:
        out.append(("browser", t["browser"]["binding"], "browser", '[browser]\nbinding = "%s"\n' % t["browser"]["binding"]))
    for d in t.get("send_email", []):
        out.append(("send_email", d["name"], d.get("destination_address", "*"), None))
    return out


# Personal-plane resources (PERSONAL-RESEARCH-SEPARATION-1; it outlived the deleted core prompt rule 8 because it protects other people's personal data): the owner's private D1s, vector index and media.
PERSONAL_RES = {("d1", "personal-life"), ("d1", "qnfo-identity"), ("vectorize", "personal-life"), ("r2", "personal-media")}


def personal_bindings(t):
    """Binding names of t that reach a personal-plane resource."""
    out = set()
    for d in t.get("d1_databases", []):
        if ("d1", str(d.get("database_name", ""))) in PERSONAL_RES:
            out.add(d["binding"])
    for d in t.get("vectorize", []):
        if ("vectorize", str(d.get("index_name", ""))) in PERSONAL_RES:
            out.add(d["binding"])
    for d in t.get("r2_buckets", []):
        if ("r2", str(d.get("bucket_name", ""))) in PERSONAL_RES:
            out.add(d["binding"])
    return out


def member_keys(gt, guest_code):
    """Least privilege: the env names the member receives are the guest's own bindings, its vars, and the upper-case
    property names its code reads (secrets such as ROUTER_TOKEN are not in wrangler.toml), nothing else of the host."""
    names = {b[1] for b in toml_bindings(gt)} | set(gt.get("vars", {}).keys())
    names |= set(re.findall(r"\.([A-Z][A-Z0-9_]{1,40})\b", guest_code))
    return sorted(names)


def plane_check(guest, host, gt, ht, keys, env_map):
    """PERSONAL-RESEARCH-SEPARATION-1: the member never receives a personal-plane binding its guest did not have, and the host never gains one."""
    gp, hp = personal_bindings(gt), personal_bindings(ht)
    gets = {k for k in keys if k in hp and k not in env_map} | {v for k, v in env_map.items() if v in hp}
    if gets and not gp:
        die("%s would receive the personal-plane binding(s) %s of %s: a fold may not cross the personal/research separation (PERSONAL-RESEARCH-SEPARATION-1)" % (guest, ", ".join(sorted(gets)), host))
    if gp and not hp:
        die("%s binds personal-plane resources (%s) and %s does not: the fold would move them into a research-plane worker (PERSONAL-RESEARCH-SEPARATION-1)" % (guest, ", ".join(sorted(gp)), host))


def merge_toml(guest, host, gt_text, ht_text, env_map):
    gt, ht = tomllib.loads(gt_text), tomllib.loads(ht_text)
    for key in ("durable_objects", "workflows", "migrations", "containers"):
        if gt.get(key):
            die(guest + " declares " + key + "; that state does not move by this kit")
    hb = {b[1]: b for b in toml_bindings(ht)}
    add, notes = [], []
    for kind, name, res, block in toml_bindings(gt):
        target = env_map.get(name, name)
        if target in hb:
            if target == name and (hb[target][0] != kind or str(hb[target][2]) != str(res)):
                die("binding %s means %s %s in %s but %s %s in %s: map it with --env-map" % (name, kind, res, guest, hb[target][0], hb[target][2], host))
            if target != name and hb[target][0] != kind:
                die("--env-map %s=%s maps a %s onto a %s" % (name, target, kind, hb[target][0]))
            continue
        if target != name:
            die("--env-map %s=%s names a host binding that does not exist" % (name, target))
        if kind == "service" and res == host:
            die("the guest binds its own host (%s); remove that binding first" % name)
        if kind == "send_email":
            if "send_email" in ht_text:
                die("both declare send_email; merge the destinations by hand")
            add.append("send_email = [\n  { name = \"%s\" }\n]\n" % name)
            continue
        if kind in ("ai", "browser") and block is None:
            continue
        add.append(block)
        notes.append("%s %s (%s)" % (kind, name, res))
    flags = set(ht.get("compatibility_flags", []))
    need = [f for f in gt.get("compatibility_flags", []) if f not in flags]
    out = ht_text.rstrip("\n") + "\n"
    if need:
        if "compatibility_flags" in ht:
            die("the host already has compatibility_flags; add %s by hand" % need)
        out = re.sub(r'^(compatibility_date = "[^"]*"\n)', lambda m: m.group(1) + "compatibility_flags = %s\n" % json.dumps(sorted(need)), out, count=1, flags=re.M)
        notes.append("compatibility_flags " + ",".join(need))
    if add:
        out += "\n# FOLD-KIT-1: bindings " + guest + " brought with it (folded into this worker).\n" + "\n".join(add)
    crons = gt.get("triggers", {}).get("crons", [])
    try:
        tomllib.loads(out)
    except tomllib.TOMLDecodeError as e:
        die("the merged %s/wrangler.toml is invalid TOML: %s" % (host, e))
    return out, notes, crons


def repoint_text(s, d, guest, host):
    """Every [[services]] block of worker d that binds the guest now binds the host with props.member = guest."""
    if ('service = "%s"' % guest) not in s:
        return s
    blocks = re.split(r"(?=^\[\[services\]\]\s*$)", s, flags=re.M)
    out = []
    for b in blocks:
        if b.startswith("[[services]]") and re.search(r'^service = "%s"[ \t]*$' % re.escape(guest), b, re.M):
            b = re.sub(r'^service = "%s"[ \t]*$' % re.escape(guest), 'service = "%s"' % host, b, count=1, flags=re.M)
            pm = re.search(r"^props = \{([^}\n]*)\}[ \t]*$", b, re.M)
            if pm:
                kv = dict(re.findall(r'(\w+)\s*=\s*"([^"]*)"', pm.group(1)))
                kv["caller"] = kv.get("caller", d)
                kv["member"] = guest
                b = b[:pm.start()] + "props = { " + ", ".join('%s = "%s"' % (k, v) for k, v in kv.items()) + " }" + b[pm.end():]
            else:
                b = re.sub(r'^(service = "%s")[ \t]*$' % re.escape(host), r'\1\nprops = { caller = "%s", member = "%s" }' % (d, guest), b, count=1, flags=re.M)
        out.append(b)
    ns = "".join(out)
    try:
        tomllib.loads(ns)
    except tomllib.TOMLDecodeError as e:
        die("re-pointing %s/wrangler.toml produced invalid TOML: %s" % (d, e))
    return ns


def repoint_binders(root, guest, host, write):
    changed = []
    for d in sorted(os.listdir(root)):
        p = os.path.join(root, d, "wrangler.toml")
        if d in (guest, host) or not os.path.isfile(p) or os.path.exists(os.path.join(root, d, "RETIRED")) or os.path.exists(os.path.join(root, d, "FOLDED")):
            continue
        s = rd(p)
        ns = repoint_text(s, d, guest, host)
        if ns != s:
            changed.append(d)
            if write:
                with open(p, "w", encoding="utf-8") as f:
                    f.write(ns)
    return changed


TEST_TEMPLATE = r'''// FOLD-KIT-1 suite for __GUEST__ folded into __HOST__ (generated by scripts/fold_worker.py; edit the kit, not this file).
// Proves: every __GUEST__ line runs unchanged in the host except its imports, its VERSION line, its export and a bundler's
// sourceMappingURL trailer; one top-level quoted
// VERSION constant; GET __PREFIX__/health answers as the member; a service binding whose props name the member with a
// qnfo-* caller (or a named one) reaches it, any other caller or path reaches the host; public routes keep their method,
// query and body and carry no binding props; derived env values are HMACs of a host secret the member never sees; on a host
// tick the member's due job runs with the mapped env as a table entry and is awaited, next to the host's own scheduled work.
// Run: node --no-warnings __HOST__/__GUEST__-fold.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const guest = readFileSync(new URL("../__GUEST__/worker.js", import.meta.url), "utf8");
// cloudflare:* modules do not exist under node: each imported name becomes an empty function (extendable and callable).
const stubbed = src.replace(/^import \{([^}]*)\} from "cloudflare:[^"]+";$/gm, (_, names) => names.split(",").map((n) => n.trim()).filter(Boolean).map((n) => { const p = n.split(/\s+as\s+/); return "function " + (p[1] || p[0]).trim() + "() {}"; }).join("\n"));
const mod = await import("data:text/javascript;base64," + Buffer.from(stubbed + "\nexport { __MEMBER__ as __member, __WRAPPED__ as __wrapped, VERSION as __hv, __MVCONST__ as __mv };\n").toString("base64"));
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 300) : "")); } };
{
  const lines = guest.split("\n");
  const exportAt = lines.findIndex((l) => l === "export {" || l === "export default {");
  const missing = lines.filter((l, i) => l.trim() && !src.includes(l.trim()) && !l.startsWith("import ") && !l.startsWith("//# sourceMappingURL") && !/^var VERSION = "/.test(l) && !(exportAt >= 0 && i >= exportAt && (l === "export {" || /^\s+\w+ as default$/.test(l) || l === "};" || l === "export default {")));
  ok(missing.length === 0, "every __GUEST__ line is in the host except its imports, VERSION line and export", missing.map((l) => l.slice(0, 80)));
  ok((src.match(/^var VERSION = "/gm) || []).length === 1 && mod.__hv === __HVJSON__ && mod.__mv === __MVJSON__, "host __HV__, member __MV__, one top-level quoted VERSION constant", [mod.__hv, mod.__mv]);
}
const W = mod.__wrapped, M = mod.__member, H = W.__foldHost;
const calls = [];
const real = { mf: M.fetch, ms: M.scheduled, hf: H.fetch, hs: H.scheduled };
M.fetch = async (req, env, ctx) => { calls.push({ who: "member", path: new URL(req.url).pathname, search: new URL(req.url).search, env, method: req.method, body: req.method === "GET" || req.method === "HEAD" ? null : await req.text(), props: ctx && ctx.props }); return new Response("m"); };
H.fetch = async (req) => { calls.push({ who: "host", path: new URL(req.url).pathname }); return new Response("h"); };
const env = __ENVOBJ__;
{
  calls.length = 0;
  await W.fetch(new Request("https://__HOST__.example__PREFIX__/health"), env, {});
  ok(calls.length === 1 && calls[0].who === "member" && calls[0].path === "/health", "GET __PREFIX__/health answers as the member", calls);
  calls.length = 0;
  await W.fetch(new Request("https://internal/any/route", { method: "POST", body: "{}" }), env, { props: { caller: "qnfo-ops", member: "__GUEST__" } });
  ok(calls.length === 1 && calls[0].who === "member" && calls[0].path === "/any/route", "a binding whose props name the member reaches it", calls);
  __ENVASSERT__
  ok(calls[0] && !("__HOST_ONLY__" in calls[0].env), "the member env carries only its own names (least privilege), not the host's other bindings", calls[0] && Object.keys(calls[0].env));
  calls.length = 0;
  await W.fetch(new Request("https://internal/any/route", { method: "POST", body: "{}" }), env, { props: { caller: "evil", member: "__GUEST__" } });
  ok(calls.length === 1 && calls[0].who === "host", "props with a caller outside qnfo-* reach the host, not the member", calls);
  calls.length = 0;
  await W.fetch(new Request("https://__HOST__.example/any/route"), env, {});
  ok(calls.length === 1 && calls[0].who === "host", "a public request outside the member's prefix reaches the host", calls);
  calls.length = 0;
  await W.fetch(new Request("https://__HOST__.example__PREFIX__/health"), env, { props: { caller: "qnfo-ops" } });
  ok(calls[0] && calls[0].who === "member" && !(calls[0].props && calls[0].props.caller), "a public request reaches the member without binding props", calls);
__EXTRA__
}
{
  let memberDone = false, hostRan = false; const seen = [];
  M.scheduled = async (ev, e, c) => { seen.push(ev); c.waitUntil(new Promise((r) => setTimeout(() => { memberDone = true; r(); }, 30))); };
  H.scheduled = async () => { hostRan = true; };
  const at = __DUEAT__;
  await W.scheduled({ cron: __HOSTCRON__, scheduledTime: at }, env, { waitUntil(p) { Promise.resolve(p).catch(() => {}); } });
  ok(seen.length === 1 && seen[0].cron === __DUECRON__ && seen[0].tickEntry === true, "the host tick at its due time runs the member's job as a table entry", seen);
  ok(memberDone && hostRan, "the handler awaits the member's waitUntil work and runs the host's own scheduled work");
}
M.fetch = real.mf; M.scheduled = real.ms; H.fetch = real.hf; H.scheduled = real.hs;
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
'''


def main():
    ap = argparse.ArgumentParser(description="FOLD-KIT-1: fold a guest worker into a host worker")
    ap.add_argument("guest")
    ap.add_argument("host")
    ap.add_argument("--member-version", required=True)
    ap.add_argument("--host-version", required=True)
    ap.add_argument("--note", required=True, help="text for the host VERSION comment (tag, issue, pillar, what moved)")
    ap.add_argument("--prefix", required=True, help="public prefix on the host, e.g. /calendar (serves <prefix>/health)")
    ap.add_argument("--public", default="", help="comma-separated guest GET paths also served under the prefix")
    ap.add_argument("--env-map", default="{}", help='JSON {"GUEST_BINDING": "HOST_BINDING"}')
    ap.add_argument("--due", required=True, help="JS expression over ms and cron: the guest cron string to run on this host tick, or null")
    ap.add_argument("--test-due-at", required=True, help="an epoch-ms expression at which --due returns a cron (for the generated test)")
    ap.add_argument("--test-due-cron", required=True, help="the cron string --due returns at --test-due-at")
    ap.add_argument("--host-cron", required=True, help="the host trigger the member rides (for the generated test)")
    ap.add_argument("--token", default="", help="HEADER:ENVVAR[:bearer]: the guest's inbound token gate the props stand in for")
    ap.add_argument("--public-route", action="append", default=[], help='"METHODS PATH": e.g. "GET,POST /e/*" (a trailing * matches a prefix); body and query kept, no binding props')
    ap.add_argument("--callers", default="", help="comma-separated binder names besides qnfo-* that may reach the member through props.caller")
    ap.add_argument("--env-derive", default="{}", help='JSON {"MEMBER_NAME": "HOST_SECRET"}: the member gets HMAC-SHA256(host secret, "fold-kit|<guest>|MEMBER_NAME") as hex, never the secret')
    ap.add_argument("--env-const", default="{}", help='JSON {"MEMBER_NAME": "value"}: constants in the member env (e.g. its public base URL on the host)')
    ap.add_argument("--why", required=True, help="tracking reference for the FOLDED marker")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    root = os.getcwd()
    g, h = a.guest, a.host
    for d in (g, h):
        if not os.path.isfile(os.path.join(root, d, "worker.js")):
            die(d + "/worker.js not found (run from the repository root)")
        for mk in ("RETIRED", "FOLDED"):
            if os.path.exists(os.path.join(root, d, mk)):
                die(d + " already carries a " + mk + " marker")
    env_map = json.loads(a.env_map)
    env_derive = json.loads(a.env_derive)
    env_const = json.loads(a.env_const)
    callers = [c.strip() for c in a.callers.split(",") if c.strip()]
    for c in callers:
        if not re.match(r"^[a-z][a-z0-9-]{1,60}$", c):
            die("--callers entry %r is not a worker name" % c)
    routes = []
    for spec in a.public_route:
        mm = re.match(r"^\s*([A-Z,]+)\s+(/[A-Za-z0-9._/-]*?)(\*?)\s*$", spec)
        if not mm:
            die("--public-route %r is not \"METHODS /path[*]\"" % spec)
        methods = [x for x in mm.group(1).split(",") if x]
        if any(x not in ("GET", "HEAD", "POST", "PUT", "DELETE", "PATCH") for x in methods):
            die("--public-route %r names an unknown method" % spec)
        routes.append({"path": mm.group(2), "prefix": bool(mm.group(3)), "methods": methods})
    for k in list(env_derive) + list(env_const):
        if not re.match(r"^[A-Z][A-Z0-9_]{1,40}$", k):
            die("member env name %r is not UPPER_CASE" % k)
    gi = ident(g)
    member_var = gi + "FoldMod"
    mv_const = re.sub(r"[^A-Za-z0-9_]", "_", re.sub(r"([a-z])([A-Z])", r"\1_\2", gi)).upper() + "_FOLD_VERSION"
    wrapped_var = "__fk_" + gi + "_default"

    gsrc = rd(os.path.join(root, g, "worker.js"))
    hsrc = rd(os.path.join(root, h, "worker.js"))
    if member_var in hsrc:
        die(h + " already carries " + g)
    host_imports, aliases, body, old_gv = transform_guest(g, gsrc, mv_const)

    hv = VERSION_RE.search(hsrc)
    if not hv or len(re.findall(r'^var VERSION = "', hsrc, re.M)) != 1:
        die(h + " needs exactly one top-level quoted `var VERSION = \"...\";` line")
    old_hv = hv.group(1)
    hsrc = hsrc[:hv.start()] + 'var VERSION = "' + a.host_version + '"; /* ' + a.host_version + " " + a.note.replace("*/", "* /") + " (FOLD-KIT-1). Was " + old_hv + ". */" + hsrc[hv.end():]

    em = EXPORT_BLOCK_RE.search(hsrc)
    if em:
        entries = [e.strip().rstrip(",") for e in em.group(1).split(",") if e.strip()]
        dflt = [e for e in entries if e.endswith(" as default")]
        if len(dflt) != 1:
            die(h + " export block has no single default export")
        host_default = dflt[0][: -len(" as default")].strip()
        new_entries = [e if not e.endswith(" as default") else wrapped_var + " as default" for e in entries]
        tail = "\nexport {\n" + ",\n".join("  " + e for e in new_entries) + "\n};\n" + (em.group(2).strip() + "\n" if em.group(2).strip() else "")
        hsrc = hsrc[:em.start()]
    elif hsrc.count("\nexport default {") == 1:
        hsrc = hsrc.replace("\nexport default {", "\nvar __fk_host_default = {")
        host_default = "__fk_host_default"
        tail = "\nexport {\n  " + wrapped_var + " as default\n};\n"
    else:
        die("no recognisable default export in " + h)

    env_pairs = ", ".join("%s: raw.%s" % (k, v) for k, v in env_map.items())
    gt_obj, ht_obj = tomllib.loads(rd(os.path.join(root, g, "wrangler.toml"))), tomllib.loads(rd(os.path.join(root, h, "wrangler.toml")))
    keys = member_keys(gt_obj, body)
    plane_check(g, h, gt_obj, ht_obj, keys, env_map)
    tok = a.token.split(":") if a.token else []
    public = [p.strip() for p in a.public.split(",") if p.strip()]
    block = []
    block.append("// ---- FOLD-KIT-1:%s:BEGIN (%s) ----" % (g, a.why))
    block.append("// %s runs here as a member: its code below is the %s bundle unchanged except its imports (aliased host imports)," % (g, g))
    block.append("// its VERSION line and its export. Public: GET %s/health%s. Every other route answers only a service binding" % (a.prefix, (" and " + ", ".join(a.prefix + p for p in public)) if public else ""))
    block.append("// whose props name the member (props.member = \"%s\", props.caller = qnfo-*%s). Its job runs on this worker's own tick." % (g, (" or " + ", ".join(callers)) if callers else ""))
    if routes:
        block.append("// Public routes: %s." % "; ".join(",".join(r["methods"]) + " " + a.prefix + r["path"] + ("*" if r["prefix"] else "") for r in routes))
    block.append("var %s = %s;" % (mv_const, json.dumps(a.member_version)))
    block.append("var %s = (function () {" % member_var)
    block.extend(aliases)
    block.append(body.rstrip("\n"))
    block.append("})();")
    if RUNTIME_BEGIN not in hsrc:
        block.append(RUNTIME.rstrip("\n"))
    elif RUNTIME.rstrip("\n") not in hsrc:
        die(h + " carries an older FOLD-KIT runtime; refresh it to this kit's runtime before adding a member")
    block.append("var %s = __foldWrap(%s, {" % (wrapped_var, host_default))
    block.append("  name: %s, mod: %s, prefix: %s, publicPaths: %s," % (json.dumps(g), member_var, json.dumps(a.prefix), json.dumps(public)))
    block.append("  publicRoutes: %s, callers: %s," % (json.dumps(routes), json.dumps(callers)))
    block.append("  consts: %s, derive: %s," % (json.dumps(env_const), json.dumps(env_derive)))
    block.append("  tokenHeader: %s, tokenEnv: %s, tokenScheme: %s," % (json.dumps(tok[0]) if tok else "null", json.dumps(tok[1]) if len(tok) > 1 else "null", json.dumps(tok[2]) if len(tok) > 2 else "null"))
    block.append("  // Least privilege: the member gets its own bindings, vars and the env names its code reads, never the whole host env.")
    block.append("  keys: %s," % json.dumps(keys))
    block.append("  env: function (raw) { var e = {}, k = this.keys; for (var i = 0; i < k.length; i++) if (raw[k[i]] !== undefined) e[k[i]] = raw[k[i]]; return Object.assign(e, {%s}); }," % ((" " + env_pairs + " ") if env_pairs else ""))
    block.append("  due: function (ms, cron) { return (%s); }" % a.due)
    block.append("});")
    block.append("// ---- FOLD-KIT-1:%s:END ----" % g)
    # Imports go first in the module text (they are hoisted either way; first keeps the bundle readable).
    hsrc = "".join(i + "\n" for i in host_imports) + hsrc.rstrip("\n") + "\n" + "\n".join(block) + tail

    gt_text = rd(os.path.join(root, g, "wrangler.toml"))
    ht_text = rd(os.path.join(root, h, "wrangler.toml"))
    new_toml, toml_notes, dropped_crons = merge_toml(g, h, gt_text, ht_text, env_map)
    # The host's own binding to the guest becomes a self-binding with props.member: its code keeps calling the same binding.
    self_bound = repoint_text(new_toml, h, g, h)
    if self_bound != new_toml:
        new_toml = self_bound
        toml_notes.append("self-binding: the host's own binding to %s now targets %s with props.member" % (g, h))

    env_obj = "{ " + ", ".join(['%s: { tag: "%s" }' % (v, v) for v in sorted(set(env_map.values()) | {"__HOST_ONLY__"})] + ['%s: "secret-%s"' % (v, v) for v in sorted(set(env_derive.values()))]) + " }"
    extra = []
    for c in callers:
        extra.append('  calls.length = 0;\n  await W.fetch(new Request("https://internal/x"), env, { props: { caller: %s, member: "%s" } });\n  ok(calls.length === 1 && calls[0].who === "member", "the named caller %s reaches the member", calls);' % (json.dumps(c), g, c))
    for r in routes:
        path = a.prefix + r["path"] + ("7" if r["prefix"] else "")
        meth = r["methods"][0]
        bodyjs = ', body: "a=keep"' if meth not in ("GET", "HEAD") else ""
        extra.append('  calls.length = 0;\n  await W.fetch(new Request("https://%s.example%s?s=1", { method: "%s"%s }), env, { props: { caller: "qnfo-ops", member: "other" } });\n'
                     '  ok(calls.length === 1 && calls[0].who === "member" && calls[0].path === %s && calls[0].search === "?s=1" && calls[0].method === "%s" && (calls[0].body === null || calls[0].body === "a=keep") && !(calls[0].props && calls[0].props.caller), "%s %s reaches the member with its query, body and no binding props", calls);'
                     % (h, path, meth, bodyjs, json.dumps(path[len(a.prefix):]), meth, meth, path))
        other = [x for x in ("DELETE", "PUT", "PATCH") if x not in r["methods"]][0]
        extra.append('  calls.length = 0;\n  await W.fetch(new Request("https://%s.example%s", { method: "%s", body: "x" }), env, {});\n  ok(calls.length === 1 && calls[0].who === "host", "%s %s is not a member route", calls);' % (h, path, other, other, path))
        if r["prefix"]:
            extra.append('  calls.length = 0;\n  await W.fetch(new Request("https://%s.example%s"), env, {});\n  ok(calls.length === 1 && calls[0].who === "host", "the bare prefix %s is not a member route", calls);' % (h, a.prefix + r["path"], a.prefix + r["path"]))
    for k, v in env_derive.items():
        extra.append('  calls.length = 0;\n  await W.fetch(new Request("https://internal/x"), env, { props: { caller: "qnfo-ops", member: "%s" } });\n'
                     '  ok(calls[0] && /^[0-9a-f]{64}$/.test(calls[0].env.%s || "") && calls[0].env.%s !== env.%s && !Object.values(calls[0].env).includes(env.%s), "%s is derived from %s and the member never sees %s", calls[0] && calls[0].env.%s);'
                     % (g, k, k, v, v, k, v, v, k))
        extra.append('  { const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.%s), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const x = Buffer.from(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode("fold-kit|%s|%s"))).toString("hex"); ok(calls[0] && calls[0].env.%s === x, "%s is HMAC-SHA256(%s, fold-kit|%s|%s), stable across isolates"); }'
                     % (v, g, k, k, k, v, g, k))
    for k, v in env_const.items():
        extra.append('  ok(calls[0] && calls[0].env.%s === %s, "the member env carries %s");' % (k, json.dumps(v), k) if env_derive else
                     '  calls.length = 0;\n  await W.fetch(new Request("https://internal/x"), env, { props: { caller: "qnfo-ops", member: "%s" } });\n  ok(calls[0] && calls[0].env.%s === %s, "the member env carries %s");' % (g, k, json.dumps(v), k))
    env_assert = " ".join('ok(calls[0] && calls[0].env.%s === env.%s, "the member gets %s as %s");' % (k, v, v, k) for k, v in env_map.items())
    test = (TEST_TEMPLATE.replace("__GUEST__", g).replace("__HOST__", h).replace("__PREFIX__", a.prefix)
            .replace("__MEMBER__", member_var).replace("__WRAPPED__", wrapped_var).replace("__MVCONST__", mv_const)
            .replace("__HVJSON__", json.dumps(a.host_version)).replace("__MVJSON__", json.dumps(a.member_version))
            .replace("__HV__", a.host_version).replace("__MV__", a.member_version).replace("__ENVOBJ__", env_obj)
            .replace("__ENVASSERT__", env_assert).replace("__DUEAT__", a.test_due_at).replace("__DUECRON__", json.dumps(a.test_due_cron))
            .replace("__HOSTCRON__", json.dumps(a.host_cron)).replace("__EXTRA__", "\n".join(extra)))
    marker = ("%s is FOLDED into %s (%s, FOLD-KIT-1, %s, owner standing grant OWNER-STANDING-GRANT-1 / charter decision rule 9).\n\n"
              "Its code runs unchanged as the member %s inside %s/worker.js (member version %s; it was %s as its own worker).\n"
              "GET https://%s.q08.workers.dev%s/health serves its health; service-binding callers reach it through %s with\n"
              "props.member = \"%s\" and a qnfo-* props.caller%s. Its job runs on %s's own trigger; its own crons (%s) are gone.\n%s\n"
              "Do not redeploy this directory: canonical-deploy skips a FOLDED directory (WORKER-FOLD-SKIP-1).\n"
              % (g, h, datetime.date.today().isoformat(), a.why, member_var, h, a.member_version, old_gv, h, a.prefix, h, g,
                 (" (or " + ", ".join(callers) + ")") if callers else "", h, ", ".join(dropped_crons) or "none",
                 ("Public routes: " + "; ".join(",".join(r["methods"]) + " https://" + h + ".q08.workers.dev" + a.prefix + r["path"] + ("*" if r["prefix"] else "") for r in routes) + ".\n") if routes else ""))

    binders = repoint_binders(root, g, h, not a.dry_run)
    if not a.dry_run:
        for p, s in ((os.path.join(h, "worker.js"), hsrc), (os.path.join(h, "deployed-current.worker.js"), hsrc),
                     (os.path.join(h, "wrangler.toml"), new_toml), (os.path.join(g, "FOLDED"), marker),
                     (os.path.join(h, g + "-fold.test.mjs"), test)):
            with open(os.path.join(root, p), "w", encoding="utf-8") as f:
                f.write(s)
    print(json.dumps({
        "folded": g, "host": h, "member": member_var, "member_version": a.member_version, "host_version": a.host_version,
        "host_imports": host_imports, "bindings_added": toml_notes, "guest_crons_dropped": dropped_crons,
        "binders_repointed": binders, "test": h + "/" + g + "-fold.test.mjs", "dry_run": a.dry_run,
        "after_merge": [
            "verify GET https://%s.q08.workers.dev/health reads %s and %s/health answers as %s" % (h, a.host_version, a.prefix, g),
            "verify the member's job on the host tick (its tables or fleet_heartbeat)",
        ] + ["cf-ops-actions unbind-service %s:<binding> (SERVICE-REPOINT-1), then canonical-deploy %s" % (b, b) for b in binders] + [
            "cf-ops-actions delete-worker %s (DELETE-AFTER-UNBIND-1 refuses while a live binder remains)" % g,
            "write worker_removals (action folded, target %s) and worker_output_contracts" % h,
            "remove %s from deploy-targets.txt, fleet-control PROBE_WORKERS and the dashboard registry if listed" % g,
            "UPDATE transformation_levers SET path = '%s/worker.js' WHERE path = '%s/worker.js' (levers follow the code)" % (h, g),
        ],
    }, indent=1))


if __name__ == "__main__":
    main()
