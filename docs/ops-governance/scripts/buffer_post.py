#!/usr/bin/env python3
"""buffer_post.py - QNFO canonical Buffer API tool (Mastodon / LinkedIn / X).

Usage:
  python buffer_post.py --list-channels
  python buffer_post.py --post <text-file> --platforms mastodon,linkedin,twitter
  python buffer_post.py --interactions <update_id>

Channel IDs are live-discovered (never hardcoded): they change on reconnect.
D7 copy rules: <=280 chars, contribution -> DOI, no exclamation marks, no hype.

Env: ~/.env key BUFFER_TOKEN. Exit code 2 = token unauthorized (reconnect at
https://buffer.com/ -> Settings -> Account -> regenerate access token, then
update ~/.env BUFFER_TOKEN).
"""
import os, sys, json, argparse, urllib.request

BUFFER = "https://api.bufferapp.com/1"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) qnfo-buffer-post/1.0"


def load_env(path="~/.env"):
    env = {}
    with open(os.path.expanduser(path), encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def api(path):
    tok = load_env().get("BUFFER_TOKEN", "")
    if not tok:
        print(json.dumps({"error": "BUFFER_TOKEN missing from ~/.env"}))
        sys.exit(1)
    req = urllib.request.Request(BUFFER + path + ("&" if "?" in path else "?") + "access_token=" + tok, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        if e.code == 401:
            print(json.dumps({"error": "HTTP 401 Unauthorized - Buffer token expired/revoked.", "action": "Reconnect at buffer.com, regenerate the access token, update ~/.env BUFFER_TOKEN."}))
            sys.exit(2)
        raise


def list_channels():
    profiles = api("/profiles.json")
    print(json.dumps([{"id": p.get("id"), "service": p.get("service"), "username": p.get("formatted_username")} for p in profiles], indent=2))


def post(text, platforms):
    profiles = api("/profiles.json")
    by_service = {p.get("service"): p for p in profiles}
    out = []
    for pf in platforms:
        prof = by_service.get(pf)
        if not prof:
            out.append({"platform": pf, "error": "no connected profile for service " + pf})
            continue
        body = json.dumps({"profile_ids": [prof["id"]], "text": {"text": text, "shortened": False}, "now": True}).encode()
        req = urllib.request.Request(BUFFER + "/updates/create.json?access_token=" + load_env()["BUFFER_TOKEN"], data=body,
                                     headers={"User-Agent": UA, "Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=30) as r:
            res = json.loads(r.read().decode("utf-8", "replace"))
        out.append({"platform": pf, "update_id": res.get("id"), "success": res.get("success")})
    print(json.dumps(out, indent=2))


def interactions(update_id):
    inter = api("/updates/%s/interactions.json" % update_id)
    print(json.dumps(inter, indent=2))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="QNFO Buffer API tool")
    ap.add_argument("--list-channels", action="store_true")
    ap.add_argument("--post", help="text file to post")
    ap.add_argument("--platforms", default="mastodon,linkedin,twitter", help="comma-separated service list")
    ap.add_argument("--interactions", help="update id to fetch interactions for")
    args = ap.parse_args()
    if args.list_channels:
        list_channels()
    elif args.interactions:
        interactions(args.interactions)
    elif args.post:
        with open(args.post, encoding="utf-8") as f:
            text = f.read().strip()
        post(text, [p.strip() for p in args.platforms.split(",") if p.strip()])
    else:
        ap.print_help()
