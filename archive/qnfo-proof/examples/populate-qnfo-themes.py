import json, urllib.request, urllib.error, sys, os

BASE = "https://qnfo-proof.q08.workers.dev"
TOKEN = open(os.path.expanduser("~/.deepchat/secrets/qnfo-proof-token.txt")).read().strip()
IDS = {}

def call(method, path, body=None, expect=200, label=None, auth=True):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, method=method, data=data)
    req.add_header("User-Agent", "Mozilla/5.0")
    req.add_header("Content-Type", "application/json")
    if auth:
        req.add_header("x-proof-token", TOKEN)
    try:
        r = urllib.request.urlopen(req, timeout=30)
        code, txt = r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        code, txt = e.code, e.read().decode()
    out = json.loads(txt) if txt.strip().startswith(("{", "[")) else txt
    if code != expect:
        print("FAIL", label or path, "->", code, txt[:200])
        sys.exit(1)
    return out

def init(conj, slug, doi, label):
    p = call("POST", "/proofs", {"conjecture": conj, "author": "rowan", "owner": "rowan", "paper_slug": slug, "paper_doi": doi}, label=label)
    return p["proof_id"]

def ref(pid, nid, children):
    return call("POST", "/proofs/%s/nodes/%s/refine" % (pid, nid), {"owner": "prover-001", "children": children})

def chal(pid, nid, reason, sev="major", aspect="inference"):
    return call("POST", "/proofs/%s/nodes/%s/challenge" % (pid, nid), {"owner": "verifier-001", "reason": reason, "severity": sev, "aspect": aspect})

def resolve(pid, nid, cid, resp):
    return call("POST", "/proofs/%s/nodes/%s/resolve-challenge" % (pid, nid), {"challenge_id": cid, "owner": "prover-001", "response": resp})

def acc(pid, nid):
    return call("POST", "/proofs/%s/nodes/%s/accept" % (pid, nid), {"owner": "verifier-001"})

def admit(pid, nid):
    return call("POST", "/proofs/%s/nodes/%s/admit" % (pid, nid), {"owner": "prover-001"})

# ---- 1. p-adic metric is an ultrametric (10.5281/x.21208346) ----
p1 = init("The p-adic metric d_p(x, z) = p^(-v_p(x-z)) is an ultrametric: d_p(x, z) <= max(d_p(x, y), d_p(y, z)) for all x, y, z",
          "the-ultrametric-foundation-a-unified-thesis-on-number-time-knowledge-and-computa", "10.5281/x.21208346", "init p-adic")
IDS["p-adic-ultrametric"] = p1
ref(p1, "1", ["The p-adic valuation satisfies v_p(a + b) >= min(v_p(a), v_p(b)) (non-Archimedean property)", "For distinct x, y: d_p(x, y) = p^(-v_p(x-y)) (definition)", "Apply the valuation property to (x-y) + (y-z)", "Monotonic inversion gives the strong triangle inequality", "Therefore d_p(x, z) <= max(d_p(x, y), d_p(y, z)). QED"])
ref(p1, "1.1", ["Write a = p^m u, b = p^n v with u, v p-adic units; WLOG m <= n", "Then a + b = p^m (u + p^(n-m) v), and u + p^(n-m) v is a p-adic integer", "Hence v_p(a + b) >= m = min(v_p(a), v_p(b))"])
c14 = chal(p1, "1.4", "Negating and inverting an inequality does not trivially flip min to max - justify the monotonicity step.")
ref(p1, "1.4", ["v_p(x-z) >= min(v_p(x-y), v_p(y-z)) implies -v_p(x-z) <= -min(...) = max(-v_p(x-y), -v_p(y-z))", "t -> p^(-t) is strictly decreasing for p > 1, so p^(-v_p(x-z)) <= max(p^(-v_p(x-y)), p^(-v_p(y-z)))"])
resolve(p1, "1.4", c14["challenge_id"], "Justified by 1.4.1-1.4.2: the decreasing map sends the reversed inequality to the max inequality.")
for nid in ["1.1.1", "1.1.2", "1.1.3", "1.2", "1.3", "1.4.1", "1.4.2", "1.5"]: acc(p1, nid)
acc(p1, "1.1"); acc(p1, "1.4"); acc(p1, "1")

# ---- 2. hierarchy distance is an ultrametric (10.5281/x.22160404) ----
p2 = init("Hierarchy distance on the distinction tree is an ultrametric: with h(u, v) = depth of the deepest common ancestor, d(u, v) = c^(-h(u,v)) satisfies d(x, z) <= max(d(x, y), d(y, z))",
          "distinction-primitive-research-framework", "10.5281/x.22160404", "init hierarchy")
IDS["hierarchy-ultrametric"] = p2
ref(p2, "1", ["Both LCA(x, y) and LCA(y, z) lie on the root-y path, so one is an ancestor of the other; WLOG depth(LCA(x, y)) <= depth(LCA(y, z))", "Then LCA(x, y) is an ancestor of LCA(y, z), hence an ancestor of z, and of x by definition: a common ancestor of x and z", "Therefore LCA(x, z) is a descendant of (or equal to) LCA(x, y), so h(x, z) >= min(h(x, y), h(y, z))", "Inverting with the decreasing map t -> c^(-t) yields the strong triangle inequality d(x, z) <= max(d(x, y), d(y, z))", "Hence hierarchy distance is an ultrametric. QED"])
c24 = chal(p2, "1.4", "The step from h(x,z) >= min(h(x,y), h(y,z)) to the c^(-t) inequality needs the monotonicity argument spelled out.")
ref(p2, "1.4", ["h(x, z) >= min(h(x, y), h(y, z)) implies -h(x, z) <= max(-h(x, y), -h(y, z))", "c > 1 makes t -> c^(-t) strictly decreasing, so c^(-h(x,z)) <= max(c^(-h(x,y)), c^(-h(y,z))) = max(d(x, y), d(y, z))"])
resolve(p2, "1.4", c24["challenge_id"], "Justified by 1.4.1-1.4.2.")
for nid in ["1.1", "1.2", "1.3", "1.4.1", "1.4.2", "1.5"]: acc(p2, nid)
acc(p2, "1.4"); acc(p2, "1")

# ---- 3. math is not physics (10.5281/x.21645350) - admitted premises -> tainted ----
p3 = init("Mathematical consistency does not imply physical realizability: there exist mathematically well-defined structures no finite measurement procedure can distinguish",
          "measurable-vs-imaginable", "10.5281/x.21645350", "init math-not-physics")
IDS["math-is-not-physics"] = p3
ref(p3, "1", ["Every experiment reduces to a finite act of distinction (this reading, not that)", "The real field R is uncountable and contains non-computable elements", "Therefore there exist mathematically consistent structures that no finite measurement procedure can distinguish", "Hence consistency (syntax) and physical content (finite distinguishability) are distinct: math is not physics. QED"])
c31 = chal(p3, "1.1", "Premise 1.1 is an empirical stance, not a theorem - it must be admitted or justified.", "critical", "scope")
admit(p3, "1.1")
resolve(p3, "1.1", c31["challenge_id"], "Premise 1.1 admitted as stated: the operational core of physics per the source record.")
c33 = chal(p3, "1.3", "Non-computable structures could in principle be measurable if physics admitted non-effective procedures - the step needs the physical Church-Turing thesis.", "critical", "inference")
ref(p3, "1.2", ["The physical Church-Turing thesis: every physically realizable measurement procedure is effectively computable"])
admit(p3, "1.2.1")
resolve(p3, "1.3", c33["challenge_id"], "Justified by admitted premise 1.2.1 (physical Church-Turing thesis): effective measurability bounds physical distinguishability by computability.")
acc(p3, "1.2"); acc(p3, "1.3"); acc(p3, "1.4"); acc(p3, "1")

expected_taint = {"p-adic-ultrametric": "clean", "hierarchy-ultrametric": "clean", "math-is-not-physics": "tainted"}
for name, pid in IDS.items():
    st = call("GET", "/proofs/%s/status" % pid, auth=False)
    assert st["root_state"] == "validated", name
    assert st["root_taint"] == expected_taint[name], name + " " + st["root_taint"]
    print("RESULT", name, "->", st["root_state"] + "/" + st["root_taint"], "nodes:", st["node_count"], "doi:", st["proof"]["paper_doi"])

print("ALL POPULATE CHECKS PASSED")
print("IDS " + json.dumps(IDS))
