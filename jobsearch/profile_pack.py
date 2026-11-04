"""PROFILE-PACK-1: build the owner's professional-profile pack from the claim ledger.

Run: python -I profile_pack.py [--out out_profile]   Test: python -I test_profile_pack.py

LinkedIn has no profile-write API and bans bots (User Agreement s8.2), so this emits paste-ready text for
LinkedIn / job boards plus a JSON-LD Person for owned surfaces. Every sentence is copied from facts.json;
nothing is invented. `drift()` compares a pasted copy of the live profile with the pack.
"""
import argparse, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
HEADLINE_MAX = 220  # LinkedIn headline limit
SKILLS_MAX = 50  # LinkedIn skills limit


def load(path=None):
    with open(path or os.path.join(HERE, "facts.json"), encoding="utf-8") as f:
        return json.load(f)


def _ledger_sentences(led):
    s = {f["text"] for f in led["facts"]} | {f.get("pitch", "") for f in led["facts"]}
    s |= {h["text"] for h in led["headlines"]}
    return {x for x in s if x}


def build(led):
    p = led["person"]
    headline = next(h["text"] for h in led["headlines"] if len(h["text"]) <= HEADLINE_MAX) if any(
        len(h["text"]) <= HEADLINE_MAX for h in led["headlines"]) else led["headlines"][0]["text"][:HEADLINE_MAX]
    by_job = {}
    for f in led["facts"]:
        by_job.setdefault((f["employer"], f["period"]), []).append(f["text"])
    experience = [{"employer": e, "period": per, "bullets": b} for (e, per), b in by_job.items()]
    about = [h["text"] for h in led["headlines"][1:3]] + [f.get("pitch") or f["text"] for f in led["facts"][:4]]
    return {
        "name": p["name"], "location": p["location"], "headline": headline,
        "about": "\n\n".join(about), "experience": experience,
        "skills": led["skills"][:SKILLS_MAX], "links": p["links"],
        "json_ld": {
            "@context": "https://schema.org", "@type": "Person", "name": p["name"],
            "alternateName": p.get("also_published_as"), "jobTitle": headline,
            "address": {"@type": "PostalAddress", "addressLocality": p["location"]},
            "url": p["links"]["site"], "sameAs": [v for k, v in p["links"].items() if k != "site"],
            "knowsAbout": led["skills"],
        },
    }


def verify(pack, led):
    """Return problems: any about/bullet/headline line that is not a ledger sentence."""
    ok = _ledger_sentences(led)
    lines = [pack["headline"]] + pack["about"].split("\n\n")
    for j in pack["experience"]:
        lines += j["bullets"]
    return [f"not in ledger: {l[:80]}" for l in lines if l not in ok]


def _norm(t):
    return re.sub(r"\s+", " ", t).strip().lower()


def drift(pack, live_text):
    """Compare pasted live-profile text with the pack: headline, each bullet and skill missing from it."""
    live, miss = _norm(live_text), []
    if _norm(pack["headline"]) not in live:
        miss.append("headline")
    miss += [f"bullet: {b[:60]}" for j in pack["experience"] for b in j["bullets"] if _norm(b) not in live]
    miss += [f"skill: {s}" for s in pack["skills"] if _norm(s) not in live]
    return miss


def json_resume(pack, led):
    """JSON Resume (jsonresume.org) document: imports into many job boards and resume sites."""
    p = led["person"]
    return {
        "basics": {"name": pack["name"], "label": pack["headline"], "email": p["email"], "url": p["links"]["site"],
                   "summary": pack["about"], "location": {"city": p["location"].split(",")[0]},
                   "profiles": [{"network": k, "url": v} for k, v in p["links"].items() if k != "site"]},
        "work": [{"name": j["employer"], "startDate": j["period"].split("-")[0], "highlights": j["bullets"]}
                 for j in pack["experience"]],
        "skills": [{"name": s} for s in pack["skills"]],
    }


def render_md(pack):
    out = [f"# {pack['name']}: profile pack", "", "## Headline", pack["headline"], "", "## About", pack["about"], "",
           "## Experience"]
    for j in pack["experience"]:
        out += [f"### {j['employer']} ({j['period']})"] + [f"- {b}" for b in j["bullets"]] + [""]
    out += ["## Skills", ", ".join(pack["skills"]), ""]
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="out_profile")
    ap.add_argument("--live", help="text file with the pasted live profile, to report drift")
    a = ap.parse_args()
    led = load()
    pack = build(led)
    bad = verify(pack, led)
    if bad:
        raise SystemExit("verify failed:\n" + "\n".join(bad))
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "profile.md"), "w", encoding="utf-8") as f:
        f.write(render_md(pack))
    with open(os.path.join(a.out, "person.jsonld"), "w", encoding="utf-8") as f:
        json.dump(pack["json_ld"], f, indent=2, ensure_ascii=False)
    with open(os.path.join(a.out, "resume.json"), "w", encoding="utf-8") as f:
        json.dump(json_resume(pack, led), f, indent=2, ensure_ascii=False)
    print(f"wrote {a.out}/profile.md, person.jsonld and resume.json ({len(pack['experience'])} roles, {len(pack['skills'])} skills)")
    if a.live:
        with open(a.live, encoding="utf-8") as f:
            miss = drift(pack, f.read())
        print(f"drift: {len(miss)} item(s) missing from live profile")
        for m in miss:
            print(" -", m)


if __name__ == "__main__":
    main()
