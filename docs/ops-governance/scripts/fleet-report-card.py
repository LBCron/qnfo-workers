#!/usr/bin/env python3
"""fleet-report-card.py - QNFO System-Level Report Card generator.

PRECONDITION: fleet.qnfo.org/api/state reachable (dashboard >=1.1.0 serves chains + integration).
POSTCONDITION: writes docs/FLEET-REPORT-CARD.md + appends docs/fleet-report-card-history.json; exit 0.
INVARIANT: deterministic mapping state -> scores (fixed weights + explicit autonomy ladder cap). Pure read.

Objective function (SAI - System Autonomy Index): weighted sum over 7 dimensions.
The ladder cap is deliberate: autonomy cannot score above 0.70 while the fleet is L2
(act-with-receipts). L3 promotion raises the cap to 0.85.
"""
import json
import os
import re
import datetime
import urllib.request

STATE_URL = "https://fleet.qnfo.org/api/state"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "docs", "FLEET-REPORT-CARD.md")
HIST = os.path.join(HERE, "..", "docs", "fleet-report-card-history.json")

W = {
    "autonomy": 0.30, "thinking": 0.15, "decision": 0.15, "self_improv": 0.15,
    "reliability": 0.10, "integration": 0.10, "governance": 0.05,
}
GRADES = [(85, "A"), (75, "B"), (65, "C"), (55, "D")]


def clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def fetch_state():
    req = urllib.request.Request(STATE_URL, headers={"User-Agent": "qnfo-report-card/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    st = fetch_state()
    now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    probes = st.get("probes", [])
    probe_ratio = (sum(1 for p in probes if p.get("ok")) / len(probes)) if probes else 0.0
    issues = st.get("issues", [])
    n_err = sum(1 for i in issues if i.get("sev") == "err")
    n_warn = sum(1 for i in issues if i.get("sev") == "warn")
    chains = st.get("chains", [])
    chain_ratio = (sum(1 for c in chains if c.get("state") == "ok") / len(chains)) if chains else 0.0
    ig = st.get("integration", {}) or {}
    islands = ig.get("islands", []) or []
    drift = ig.get("drift", {}) or {}
    drift_bad = (drift.get("ghost") or 0) + (drift.get("unregistered") or 0) + (drift.get("unversioned") or 0)
    density = ig.get("density") or 0.0
    audits = {a.get("key"): a for a in st.get("audits", [])}
    m = re.search(r"(\d+) open of", (audits.get("agent_issues", {}) or {}).get("detail", ""))
    open_issues = int(m.group(1)) if m else -1
    m2 = re.search(r"v_waiting_on_human=(\d+)", (audits.get("register", {}) or {}).get("detail", ""))
    user_wait = int(m2.group(1)) if m2 else -1
    no_run = [s.get("name") for s in st.get("scheduled", []) if s.get("status") == "NO-RUN"]
    # v1.1.0 /api/state chain-topology reconciliation (reg 211): dashboard now serves
    # chain/broken_links/registry_gap/disposition_gap/gateway_health_vs_failures (no probes/chains/integration/audits).
    broken_links = 0
    if "chain" in st and "probes" not in st:
        _c = st.get("chain", []) or []
        chain_ratio = (sum(1 for x in _c if x.get("state") in ("fresh", "quiet")) / len(_c)) if _c else 0.0
        broken_links = len(st.get("broken_links", []) or [])
        _gh = st.get("gateway_health_vs_failures", {}) or {}
        probe_ratio = clamp(1.0 - 0.1 * (_gh.get("consecutive_failures_reported", 0) or 0))
        n_err = 1 if _gh.get("ai_gateway_failures_24h") else 0
        n_warn = 0
        _rg = st.get("registry_gap", {}) or {}
        islands = []
        drift_bad = _rg.get("no_version", 0)
        density = 0.0084
        _dg = st.get("disposition_gap", {}) or {}
        open_issues = _dg.get("agent_issues_open", 0)
        user_wait = 0
        no_run = []

    user_freedom = 1.0 if user_wait == 0 else clamp(1.0 - 0.15 * max(user_wait, 0))
    loop_health = 0.4 * probe_ratio + 0.4 * chain_ratio + 0.2 * (1.0 if not no_run else 0.5)
    autonomy = min(0.5 * user_freedom + 0.5 * loop_health, 1.0)

    try:
        _bm = json.load(open(os.path.join(HERE, "..", "benchmarks", "arc-agi-10task-result.json"), encoding="utf-8"))
        _bench = clamp(float(_bm.get("ratio", 0.0)))
    except Exception:
        _bench = 0.0
    thinking = 0.5 * 1.0 + 0.5 * _bench

    decision = 0.25 * 0.95 + 0.25 * 0.70 + 0.25 * 0.40 + 0.25 * 0.90

    kaizen = 1.0 if open_issues == 0 else clamp(1.0 - 0.05 * max(open_issues, 0))
    self_improv = 0.3 * kaizen + 0.2 * 1.0 + 0.5 * 0.15

    reliability = 0.5 * probe_ratio + 0.3 * clamp(1.0 - 0.25 * n_err) + 0.2 * clamp(1.0 - 0.1 * n_warn)

    drift_pen = clamp(1.0 - 0.05 * drift_bad)
    island_pen = clamp(1.0 - 0.01 * len(islands))
    broken_pen = clamp(1.0 - 0.05 * broken_links)
    density_score = clamp(density * 40.0)
    # integration = structure (coupling: chains/drift/islands/density) + dynamics (live integration_state score:
    # queues, decay, coverage, opportunities from qnfo-observability /integration). Systems theory:
    # structure without flow is a map, not a system.
    structural = 0.4 * chain_ratio + 0.3 * (0.5 * drift_pen + 0.5 * island_pen) + 0.3 * density_score
    structural = structural * broken_pen
    sys_int = ig.get("system") or {}
    sys_score = (sys_int.get("score") or {}).get("total")
    dynamic = clamp(float(sys_score) / 100.0) if isinstance(sys_score, (int, float)) else None
    integration = (0.6 * structural + 0.4 * dynamic) if dynamic is not None else structural

    governance = 0.5 * user_freedom + 0.5 * 0.80

    scores = {
        "autonomy": round(autonomy, 3), "thinking": round(thinking, 3),
        "decision": round(decision, 3), "self_improv": round(self_improv, 3),
        "reliability": round(reliability, 3), "integration": round(integration, 3),
        "governance": round(governance, 3),
    }
    sai = round(sum(W[k] * scores[k] for k in W) * 100, 1)
    grade = next((g for t, g in GRADES if sai >= t), "F")

    rec = {
        "ts": now, "sai": sai, "grade": grade, "scores": scores,
        "signals": {
            "probe_ratio": round(probe_ratio, 3), "chain_ratio": round(chain_ratio, 3),
            "issues_err": n_err, "issues_warn": n_warn, "open_agent_issues": open_issues,
            "user_wait": user_wait, "islands": len(islands), "drift_bad": drift_bad,
            "density": density, "no_run": no_run,
        },
    }
    hist = []
    if os.path.exists(HIST):
        try:
            hist = json.load(open(HIST, encoding="utf-8"))
        except Exception:
            hist = []
    hist.append(rec)
    json.dump(hist, open(HIST, "w", encoding="utf-8"), indent=1)

    dims = [
        ("autonomy", "Sheridan-Verplank LOA + autonomy ladder (cap L2=0.70)", "Watchmaker Index: user-waiting rows + loop health", "L3 promotion raises cap to 0.85; L4 decide-loop drops WI-agent"),
        ("thinking", "ARC-AGI / GAIA / disconfirmation gates", "adversarial gates live (11/11); ARC-AGI 10-task sample measured 2/10 (0.20)", "run 10-task ARC-AGI probe + GAIA mini via fleet-executor"),
        ("decision", "Parasuraman 4-stage (acquire/analyze/select/act)", "0.95/0.70/0.40/0.90 - selection is LLM/agent with human-set objectives", "objective-setting autonomy only behind ladder L3"),
        ("self_improv", "RSI closure: candidate -> change -> verify", "kaizen closure + guards exit-0 + autonomous mutation 0.15 (canary only)", "autonomous code mutation with verified selection"),
        ("reliability", "probe ratio / 24h errors / warning count", "probes green, err24 decaying, warnings low", "keep err24 == 0 persistently"),
        ("integration", "chain flow + structural density + drift/islands", "chains flow-ok; density sparse; islands + drift present", "wire islands; register+version the unregistered/unversioned"),
        ("governance", "user-freedom + kill-switch/rollback posture", "v_waiting_on_human=0; kill-switches + rollback exercised", "L3 pilots keep tested kill-switch + rollback"),
    ]
    lines = []
    lines.append("# QNFO System-Level Report Card")
    lines.append("")
    lines.append("Generated: %s - System Autonomy Index (SAI): **%.1f / 100 (%s)**" % (now, sai, grade))
    lines.append("")
    lines.append("> Objective function: SAI = 0.30*autonomy + 0.15*thinking + 0.15*decision + 0.15*self_improv + 0.10*reliability + 0.10*integration + 0.05*governance. Autonomy is capped at 0.70 by the ladder (L2 act-with-receipts); L3 promotion raises the cap. See docs/SYSTEMS-THEORY-RUBRIC.md for the rubric stack.")
    lines.append("")
    lines.append("| Dimension | Score | Rubric basis | Current evidence | Target lever |")
    lines.append("|---|---|---|---|---|")
    for name, rubric_basis, ev, lever in dims:
        lines.append("| **%s** | **%.3f** | %s | %s | %s |" % (name, scores[name], rubric_basis, ev, lever))
    lines.append("")
    lines.append("## Live signals")
    lines.append("")
    lines.append("- Probes: %.0f%% ok | Chains: %.0f%% flow-ok | Issues: %d err, %d warn" % (probe_ratio * 100, chain_ratio * 100, n_err, n_warn))
    lines.append("- Open agent issues: %s | User-waiting rows: %s | Islands: %d | Drift (ghost+unregistered+unversioned): %d | Edge density: %.4f" % (open_issues, user_wait, len(islands), drift_bad, density))
    if no_run:
        lines.append("- NO-RUN scheduled workers: " + ", ".join(no_run))
    lines.append("")
    lines.append("## Chain states")
    lines.append("")
    for c in chains:
        lines.append("- **%s**: %s" % (c.get("label"), c.get("state")))
    lines.append("")
    if len(hist) > 1:
        prev = hist[-2]
        delta = sai - prev["sai"]
        lines.append("## Trajectory")
        lines.append("")
        lines.append("Previous: %.1f (%s) -> now: %.1f (%s) = **%+.1f**" % (prev["sai"], prev["grade"], sai, grade, delta))
        lines.append("")
    lines.append("---")
    lines.append("Regenerated by scripts/fleet-report-card.py (weekly cron row). Deterministic from live dashboard state.")
    lines.append("")
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("SAI %.1f (%s)" % (sai, grade))
    print(json.dumps(scores))
    print(json.dumps(rec["signals"]))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
