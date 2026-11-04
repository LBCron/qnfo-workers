#!/usr/bin/env python3
"""engagement_collect.py - QNFO social engagement collector (canonical).

Collects per-post engagement for QNFO social channels and writes time-series rows
into qnfo-audit.social_engagements (D1 via Cloudflare API).

Sources:
  - Bluesky (AT Protocol, live): likeCount / repostCount / replyCount per recent post.
  - Buffer (Mastodon / LinkedIn / X): interactions per sent update. Token-gated.
    On HTTP 401 the script writes a single 'auth' status row so the weekly
    scorecard surfaces "Buffer reconnect required" instead of silent zeroes.

Usage: python engagement_collect.py [--days 7]
Env: ~/.env keys CF CLOUDFLARE_API_TOKEN, BSKY_HANDLE, BSKY_APP_PASS, BUFFER_TOKEN.
"""
import os, sys, json, time, urllib.request, urllib.parse, hashlib

ACCOUNT = "edb167b78c9fb901ea5bca3ce58ccc4b"
AUDIT_DB = "35e2e573-92f3-46ac-83c6-22f6429fc5e5"
BSKY = "https://bsky.social/xrpc"
BUFFER = "https://api.bufferapp.com/1"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) qnfo-engagement-collect/1.0"


def load_env(path="~/.env"):
    env = {}
    with open(os.path.expanduser(path), encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def http(url, method="GET", body=None, token=None, ctype="application/json"):
    h = {"User-Agent": UA}
    if token:
        h["Authorization"] = "Bearer " + token
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        h["Content-Type"] = ctype
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    with urllib.request.urlopen(req, timeout=40) as r:
        raw = r.read().decode("utf-8", "replace")
        return r.status, json.loads(raw) if raw.strip() else {}


def d1_write(cf_token, sql, params=None):
    url = "https://api.cloudflare.com/client/v4/accounts/%s/d1/database/%s/query" % (ACCOUNT, AUDIT_DB)
    body = {"sql": sql}
    if params:
        body["params"] = params
    st, res = http(url, "POST", body, token=cf_token)
    if st != 200 or not res.get("success"):
        raise RuntimeError("d1 write failed: %s %s" % (st, str(res)[:200]))
    return res


def main():
    env = load_env()
    cf = env.get("CLOUDFLARE_API_TOKEN", "")
    if not cf:
        print(json.dumps({"error": "CLOUDFLARE_API_TOKEN missing from ~/.env"}))
        sys.exit(1)
    today = time.strftime("%Y-%m-%d", time.gmtime())
    summary = {"collected_at": today, "bluesky": None, "buffer": None}

    # ---- Bluesky ----
    if env.get("BSKY_HANDLE") and env.get("BSKY_APP_PASS"):
        try:
            st, sess = http(BSKY + "/com.atproto.server.createSession", "POST",
                            {"identifier": env["BSKY_HANDLE"], "password": env["BSKY_APP_PASS"]})
            jwt = sess.get("accessJwt", "")
            st, feed = http(BSKY + "/app.bsky.feed.getAuthorFeed?actor=" + urllib.parse.quote(sess["did"]) + "&limit=30",
                            token=jwt)
            uris = [f["post"]["uri"] for f in feed.get("feed", []) if f.get("post", {}).get("uri")]
            if uris:
                tot = {"likes": 0, "reposts": 0, "replies": 0}
                n = 0
                # app.bsky.feed.getPosts accepts at most 25 uris per call
                for i in range(0, len(uris), 25):
                    chunk = uris[i:i + 25]
                    st, posts = http(BSKY + "/app.bsky.feed.getPosts?" + "&".join("uris=" + urllib.parse.quote(u) for u in chunk),
                                     token=jwt)
                    for p in posts.get("posts", []):
                        vals = {"likes": p.get("likeCount", 0), "reposts": p.get("repostCount", 0), "replies": p.get("replyCount", 0)}
                        for metric, value in vals.items():
                            d1_write(cf, "INSERT INTO social_engagements (platform, post_id, metric, value, collected_at) VALUES (?,?,?,?,?) ON CONFLICT(platform, post_id, metric, collected_at) DO UPDATE SET value=excluded.value",
                                     ["bluesky", p["uri"], metric, value, today])
                            tot[metric] += int(value or 0)
                        n += 1
                summary["bluesky"] = {"posts": n, **tot}
                # Account-level growth metrics (G4 2026-09-03): per-post window misses
                # engagement on older posts; profile counts show true audience trend.
                try:
                    st, prof = http(BSKY + "/app.bsky.actor.getProfile?actor=" + urllib.parse.quote(sess["did"]), token=jwt)
                    pv = prof if isinstance(prof, dict) else {}
                    acct_vals = {"followers": pv.get("followersCount", 0), "follows": pv.get("followsCount", 0), "posts": pv.get("postsCount", 0)}
                    for metric, value in acct_vals.items():
                        d1_write(cf, "INSERT INTO social_engagements (platform, post_id, metric, value, collected_at) VALUES (?,?,?,?,?) ON CONFLICT(platform, post_id, metric, collected_at) DO UPDATE SET value=excluded.value",
                                 ["bluesky_account", "profile", metric, int(value or 0), today])
                    summary["bluesky_account"] = acct_vals
                except Exception as ae:
                    summary["bluesky_account"] = {"error": str(ae)[:150]}
        except Exception as e:
            summary["bluesky"] = {"error": str(e)[:200]}
    else:
        summary["bluesky"] = {"error": "BSKY credentials missing"}

    # ---- Buffer (graceful on 401) ----
    if env.get("BUFFER_TOKEN"):
        try:
            st, profiles = http(BUFFER + "/profiles.json?access_token=" + env["BUFFER_TOKEN"])
            if False and st == 401:
                pass
            else:
                tot = {"likes": 0, "comments": 0, "shares": 0, "reach": 0}
                counted = 0
                for prof in profiles[:4]:
                    try:
                        st, updates = http(BUFFER + "/profiles/%s/updates/sent.json?access_token=%s&count=10" % (prof["id"], env["BUFFER_TOKEN"]))
                        for u in updates:
                            st2, inter = http(BUFFER + "/updates/%s/interactions.json?access_token=%s" % (u["id"], env["BUFFER_TOKEN"]))
                            if st2 != 200:
                                continue
                            vals = {"likes": inter.get("favorites", 0), "comments": inter.get("comments", 0),
                                    "shares": (inter.get("retweets", 0) or 0) + (inter.get("shares", 0) or 0), "reach": inter.get("reach", 0)}
                            for metric, value in vals.items():
                                d1_write(cf, "INSERT INTO social_engagements (platform, post_id, metric, value, collected_at) VALUES (?,?,?,?,?) ON CONFLICT(platform, post_id, metric, collected_at) DO UPDATE SET value=excluded.value",
                                         ["buffer", str(u["id"]), metric, value, today])
                                tot[metric] += int(value or 0)
                            counted += 1
                    except Exception:
                        continue
                summary["buffer"] = {"updates": counted, **tot}
        except urllib.error.HTTPError as e:
            if e.code == 401:
                summary["buffer"] = "unauthorized (reconnect required)"
                d1_write(cf, "INSERT INTO social_engagements (platform, post_id, metric, value, note, collected_at) VALUES (?,?,?,?,?,?) ON CONFLICT(platform, post_id, metric, collected_at) DO UPDATE SET value=excluded.value, note=excluded.note",
                         ["buffer", "auth", "auth_status", 0, "401 unauthorized", today])
            else:
                summary["buffer"] = {"error": "HTTP " + str(e.code)}
        except Exception as e:
            summary["buffer"] = {"error": str(e)[:200]}
    else:
        summary["buffer"] = {"error": "BUFFER_TOKEN missing"}

    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
