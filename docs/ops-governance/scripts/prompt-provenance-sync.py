#!/usr/bin/env python3
"""prompt-provenance-sync.py - PROMPT-PROVENANCE-STALE-1 (issue 2808) remediation.

qnfo-audit.prompt_provenance was frozen on 2026-07-13: its system/default row held
4,731 chars while the live canonical prompt was 68,517 (a 14x gap). The 2026-10-17
fix loaded the row by hand; this script is the missing automation so it cannot
freeze again.

Writes (via the D1 REST API, UTF-8 bytes and bound parameters - a Latin-1 transport
silently ate every em-dash on the first manual attempt and stayed within 1 byte of
the intended character count, so verification here is byte-level, never char-count):
  prompt_provenance.id = 'system/default'                     <- canonical prompt file
  prompt_provenance.id = 'owner-standing-directives-2026-10-17' <- directive block file

Exit 0 = in sync (or synced), 1 = could not verify, 2 = error.
"""
import datetime
import hashlib
import json
import os
import sys
import urllib.request

CANON = r"C:\Users\LENOVO\.deepchat\system-prompt-v2.7.md"
DIRECTIVES = r"C:\Users\LENOVO\.deepchat\directives-2026-10-17.md"
ENV_FILE = os.path.join(os.path.expanduser("~"), ".env")
ACCOUNT = "edb167b78c9fb901ea5bca3ce58ccc4b"
DBID = "35e2e573-92f3-46ac-83c6-22f6429fc5e5"


def token():
    with open(ENV_FILE, encoding="utf-8", errors="ignore") as f:
        for line in f:
            if line.startswith("CLOUDFLARE_API_TOKEN="):
                return line.split("=", 1)[1].strip().strip('"')
    raise SystemExit("no CLOUDFLARE_API_TOKEN in %s" % ENV_FILE)


def d1(sql, params):
    body = json.dumps({"sql": sql, "params": params}).encode("utf-8")
    req = urllib.request.Request(
        "https://api.cloudflare.com/client/v4/accounts/%s/d1/database/%s/query" % (ACCOUNT, DBID),
        data=body,
        headers={"Authorization": "Bearer " + token(), "Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        payload = json.loads(r.read().decode("utf-8"))
    if not payload.get("success"):
        raise RuntimeError("D1 error: %s" % payload.get("errors"))
    return payload["result"]


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sync(row_id, text, source):
    res = d1(
        "UPDATE prompt_provenance SET content=?, content_length=?, content_hash=?, extraction_timestamp=?, source=? WHERE id=?",
        [text, str(len(text)), sha(text), datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), source, row_id],
    )
    return res[0].get("meta", {}).get("changes", 0)


def verify(row_id, expect):
    res = d1(
        "SELECT length(content) ch, length(CAST(content AS BLOB)) by, hex(substr(content,1,32)) h1, "
        "hex(substr(content,-32)) h2, content_hash FROM prompt_provenance WHERE id=?",
        [row_id],
    )
    row = res[0]["results"][0]
    eb = len(expect.encode("utf-8"))
    exp_h1 = expect[:32].encode("utf-8").hex().upper()
    exp_h2 = expect[-32:].encode("utf-8").hex().upper()
    ok = row["ch"] == len(expect) and row["by"] == eb and row["h1"] == exp_h1 and row["h2"] == exp_h2
    print("  %-42s chars=%s/%s bytes=%s/%s head=%s tail=%s -> %s" % (
        row_id, row["ch"], len(expect), row["by"], eb,
        "ok" if row["h1"] == exp_h1 else "MISMATCH",
        "ok" if row["h2"] == exp_h2 else "MISMATCH",
        "IN SYNC" if ok else "DRIFT"))
    return ok


def main():
    canon = open(CANON, encoding="utf-8").read()
    directives = open(DIRECTIVES, encoding="utf-8").read().strip()
    total = 0
    total += sync("system/default", canon, "prompt-provenance-sync")
    total += sync("owner-standing-directives-2026-10-17", directives, "prompt-provenance-sync")
    print("PROMPT-PROVENANCE-SYNC: wrote %d row(s)" % total)
    ok = verify("system/default", canon) and verify("owner-standing-directives-2026-10-17", directives)
    if not ok:
        print("PROMPT-PROVENANCE-SYNC: FAIL (byte-level verification did not match)")
        return 1
    print("PROMPT-PROVENANCE-SYNC: PASS (both rows byte-identical to the canonical files)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
