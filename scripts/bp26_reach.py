#!/usr/bin/env python3
"""BP26-REACH-1 collectors (2026-10-26, charter pillar reach; agent_issues 1000347 BP26-EMAIL-AUTH-1, 1000340 BP26-SOCIAL-AUTOMATION-1; owner directive 2026-10-26).

The runner half of five BP26 metrics, run by scripts/bp26_producers.py from the remediation-consumer job. Every value is measured from the real thing; a collector that cannot
measure returns None and writes nothing. No address, post text or message is stored or printed: only counts and per-domain, per-source or per-platform verdicts.

  collect_dmarc          dmarc_aligned_pass_rate
        The DMARC aggregate reports that arrive daily at the fleet's rua mailbox (google.com, lolipop.jp, ...) are stored as raw MIME in qnfo-audit.email_raw_archive. This parses the
        zip or gzip XML attachment of every report whose date range ended in the last 7 days; a message passes DMARC when its dkim OR spf result in policy_evaluated is pass (those
        fields are the ALIGNED results). value = passing messages / messages from the fleet's own senders across every reporting domain, weighted by the report's count. BP26-DMARC-FOREIGN-1
        (2026-11-05): a record leaves the denominator only when it is provably a stranger forging the domain AND the published policy stopped it (is_foreign_source: failed both
        aligned checks, rejected or quarantined by the receiver, no DKIM signature at all, SPF of the header_from domain itself negative). On 2026-11-04 the 7-day window held 9 messages:
        the fleet's Cloudflare sender passed DKIM and SPF 6 of 6, and 3 from one foreign address were rejected under p=reject, which read 0.667 and could never recover while any forger
        exists. A forgery that was delivered, a signed message that fails, and an SPF pass for a foreign bounce domain stay counted as failures; the raw rate stays in the note.
        Rows: one per (domain, reporter) with counts.
        The same run reads the sending domains' SPF, the Cloudflare DKIM selector and the DMARC policy through DNS-over-HTTPS and keeps them in bp26_dns_email_auth (a collector
        reads DNS, it never writes it). Limits: a domain without a rua tag (q08.org on 2026-10-26) sends no reports, so its mail is unmeasured and the note names it.
  collect_rfc8058        rfc8058_headers_present
        A code-state check, because the mail log does not carry headers: for each path that sends LIST mail (a digest or newsletter to a standing subscriber list) the worker source
        must set both List-Unsubscribe and List-Unsubscribe-Post (List-Unsubscribe=One-Click), print an unsubscribe link in the body, and serve a /unsubscribe route. value = paths that
        satisfy all four / list-mail paths. One-to-one mail (outreach, errata, owner notices) is not list mail and is not counted.
  collect_unsubscribe    unsubscribe_honoured_48h
        Opt-outs of the last 30 days: qnfo-audit.subscribers rows that are unsubscribed, and email_suppression rows with reason unsubscribe or reply-stop. An opt-out is honoured when it
        was processed within 48 h of the request (the request time is the newest inbound mail from that address before the suppression, or the click itself for a link handler, which is
        synchronous) AND nothing was sent to the address more than 48 h after (outreach_log, subscribers.last_digest_at). The queries run inside D1; no address leaves it.
  collect_social_labels  social_bot_label_enabled
        Automated social accounts whose platform bot or automated label is verifiably on / all automated accounts. Bluesky: the public AppView profile (labels); Mastodon: the public
        accounts/lookup `bot` field. X and LinkedIn cannot be read without credentials: they count as NOT verified-enabled and are listed as unverifiable until the owner card
        bp26-social-bot-labels closes.
  collect_social_mentions social_unsolicited_mentions
        Automated posts of the last 7 days that carry an @mention of an account that is not the fleet's own, from the post text that exists: social_threads.posts (Bluesky threads, full
        text), social_media_posts.content_preview and dissemination_tracker.post_text_snippet (the first 200 characters or so of Buffer posts). The fleet has no code path that replies to
        a third party (the only reply object in qnfo-social/worker.js continues its own thread); the scan counts those sites as a tripwire. Every mention found is counted as unsolicited,
        because the tables hold no link from a mention to a user interaction. The note states how many posts had text.

Usage:
  python3 scripts/bp26_reach.py --selftest      offline suite (no network, no secrets)
  CF_ACCOUNT_ID=<id> python3 scripts/bp26_producers.py --dry --only collect_dmarc     live read-only run through the framework
"""
import calendar
import email
import email.policy
import gzip
import io
import json
import os
import re
import sys
import time
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bp26_producers import Collector, Result  # noqa: E402

DMARC_WINDOW_DAYS = 7
DMARC_DOMAINS = ("qnfo.org", "q08.org", "qwav.org", "qwav.tech")  # the zones that send or receive fleet mail (docs/DOMAINS.md); the rua tag decides which report
DKIM_SELECTOR = "cf2024-1"  # Cloudflare Email Service's selector, present on qnfo.org and q08.org on 2026-10-26
MAX_XML = 2 * 1024 * 1024
DOH = "https://cloudflare-dns.com/dns-query?name=%s&type=TXT"
OPT_OUT_DAYS = 30
OPT_OUT_H = 48
MENTION_DAYS = 7
# Paths that send LIST mail: (id, source file, the route a one-click POST must reach).
LIST_MAIL_PATHS = (
    ("qnfo-subscribers weekly digest", "qnfo-subscribers/worker.js"),
    ("q08-signal-engine daily digest", "q08-signal-engine/worker.js"),
    ("personal-companion reading digest", "personal-companion/worker.js"),
)
# The fleet's own handles: a mention of them is not a mention of a third party.
SELF_HANDLES = frozenset(["qnfo", "qnfo.org", "q08", "q08.org", "qwav", "qwav.org", "qwav.tech", "ipatent", "ipatent.qnfo.org"])
BSKY_PROFILE = "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=%s"
MASTODON_LOOKUP = "https://%s/api/v1/accounts/lookup?acct=%s"
MASTODON_HOST = "mstdn.science"  # qnfo-social MASTODON_HOST default; the account is the one linked from qnfo.org (mstdn.science/@QNFO)
MASTODON_ACCT = "QNFO"
BOT_LABELS = frozenset(["bot", "automated"])
MENTION_RX = re.compile(r"(?<![\w@/.+-])@([A-Za-z0-9_](?:[A-Za-z0-9_.-]{0,60}[A-Za-z0-9_])?)(?:@[A-Za-z0-9.-]+\.[A-Za-z]{2,})?")
REPLY_OBJ_RX = re.compile(r"\{\s*root\s*:\s*\w+\s*,\s*parent\s*:\s*\w+\s*\}")
# qnfo-social/worker.js builds a reply object in two places on main (2026-10-26), both continuing the fleet's OWN thread (post i > 0 of a curated thread, line 630, and of the
# paper roll-up thread, line 2238). A third site would be a new reply path and must be reviewed, so it is counted as unsolicited until it is read.
REPLY_SITES_BASELINE = 2


def now_s(ctx):
    return int(getattr(ctx, "now", None) or time.time())


def iso_space(epoch):
    return time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(epoch))


# ---------------------------------------------------------------- DMARC aggregate reports
def _local(tag):
    return tag.rsplit("}", 1)[-1]


def _child_text(node, *path):
    cur = node
    for name in path:
        nxt = None
        for ch in list(cur):
            if _local(ch.tag) == name:
                nxt = ch
                break
        if nxt is None:
            return None
        cur = nxt
    return (cur.text or "").strip()


def _decode_attachment(data):
    """bytes of a zip, gzip or bare XML attachment -> XML bytes, or None. Refuses anything larger than MAX_XML when decompressed (zip bombs)."""
    if data[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            for info in z.infolist():
                if info.filename.lower().endswith(".xml") or not info.is_dir():
                    if info.file_size > MAX_XML:
                        return None
                    return z.read(info)
        return None
    if data[:2] == b"\x1f\x8b":
        out = gzip.GzipFile(fileobj=io.BytesIO(data)).read(MAX_XML + 1)
        return out if len(out) <= MAX_XML else None
    return data if len(data) <= MAX_XML else None


SPOOF_SPF_RESULTS = frozenset(["softfail", "fail", "none", "neutral"])


def is_foreign_source(dkim, spf, disposition, header_from, n_dkim_sigs, spf_auth):
    """BP26-DMARC-FOREIGN-1: True for a record that is a stranger forging the domain, not one of the fleet's senders. A record is foreign only when ALL hold:
    it failed both aligned checks, the receiver rejected or quarantined it under the published policy, it carries no DKIM signature at all, and the only SPF
    evaluation is of the header_from domain itself (MAIL FROM forged too) with a negative result, i.e. the source IP is not in the domain's published SPF.
    A legitimate third-party sender that is misconfigured always shows something else (a DKIM signature that fails, or an SPF pass for its own bounce domain,
    which is unaligned) and stays counted as a failure; so does a forged message the receiver DELIVERED, because that is the one that needs review."""
    if dkim == "pass" or spf == "pass" or disposition not in ("reject", "quarantine") or n_dkim_sigs or not header_from or not spf_auth:
        return False
    return all((d == header_from or d.endswith("." + header_from)) and res in SPOOF_SPF_RESULTS for d, res in spf_auth)


def parse_dmarc_report(raw_text):
    """Raw MIME text of a DMARC aggregate report mail -> {domain, org, end, p, records: [(count, dkim, spf, disposition)]} or None. Rejects any XML with a DTD or entity."""
    msg = email.message_from_string(raw_text, policy=email.policy.default)
    for part in msg.walk():
        if part.is_multipart():
            continue
        ctype = (part.get_content_type() or "").lower()
        fname = (part.get_filename() or "").lower()
        if not (ctype in ("application/zip", "application/gzip", "application/x-gzip", "application/x-zip-compressed", "application/xml", "text/xml", "application/octet-stream")
                or fname.endswith((".zip", ".gz", ".xml"))):
            continue
        try:
            payload = part.get_payload(decode=True)
            xml = _decode_attachment(payload) if payload else None
        except Exception:  # noqa: BLE001
            xml = None
        if not xml or b"<!DOCTYPE" in xml or b"<!ENTITY" in xml:
            continue
        try:
            root = ET.fromstring(xml)
        except ET.ParseError:
            continue
        if _local(root.tag) != "feedback":
            continue
        end = _child_text(root, "report_metadata", "date_range", "end")
        recs, foreign, foreign_ips = [], [], set()
        for rec in list(root):
            if _local(rec.tag) != "record":
                continue
            cnt = _child_text(rec, "row", "count")
            dk = (_child_text(rec, "row", "policy_evaluated", "dkim") or "").lower()
            sp = (_child_text(rec, "row", "policy_evaluated", "spf") or "").lower()
            disp = (_child_text(rec, "row", "policy_evaluated", "disposition") or "").lower()
            try:
                recs.append((int(cnt), dk, sp, disp))
            except (TypeError, ValueError):
                continue
            n_sigs, spf_auth = 0, []
            for ar in list(rec):
                if _local(ar.tag) != "auth_results":
                    continue
                for a in list(ar):
                    if _local(a.tag) == "dkim":
                        # RFC 7489 auth_results/dkim/result: "none" means the message carried no signature; every other value is a signature that was evaluated.
                        if (_child_text(a, "result") or "").lower() != "none":
                            n_sigs += 1
                    elif _local(a.tag) == "spf":
                        spf_auth.append(((_child_text(a, "domain") or "").lower(), (_child_text(a, "result") or "").lower()))
            is_foreign = is_foreign_source(dk, sp, disp, (_child_text(rec, "identifiers", "header_from") or "").lower(), n_sigs, spf_auth)
            foreign.append(is_foreign)
            if is_foreign:
                foreign_ips.add(_child_text(rec, "row", "source_ip") or "?")  # counted in memory only, never stored or printed
        try:
            end_i = int(end)
        except (TypeError, ValueError):
            end_i = None
        return {"domain": (_child_text(root, "policy_published", "domain") or "").lower(), "org": (_child_text(root, "report_metadata", "org_name") or "?").lower(),
                "end": end_i, "p": (_child_text(root, "policy_published", "p") or "").lower(), "records": recs, "foreign": foreign, "foreign_ips": foreign_ips}
    return None


def aggregate_dmarc(reports, since_epoch):
    """reports: parsed dicts -> (aligned, total, per (domain, org) {total, aligned, dkim, spf, reports})."""
    per, aligned, total = {}, 0, 0
    for r in reports:
        if r["end"] is None or r["end"] < since_epoch:
            continue
        key = (r["domain"], r["org"])
        b = per.setdefault(key, {"total": 0, "aligned": 0, "dkim": 0, "spf": 0, "reports": 0, "enforced": 0, "foreign": 0})
        b["reports"] += 1
        flags = r.get("foreign") or []
        for i, (cnt, dk, sp, disp) in enumerate(r["records"]):
            b["total"] += cnt
            total += cnt
            if i < len(flags) and flags[i]:
                b["foreign"] += cnt
            if dk == "pass":
                b["dkim"] += cnt
            if sp == "pass":
                b["spf"] += cnt
            if dk == "pass" or sp == "pass":
                b["aligned"] += cnt
                aligned += cnt
            elif disp in ("reject", "quarantine"):
                b["enforced"] += cnt
    return aligned, total, per


def txt_data(doh_json_text):
    """The TXT strings of a DoH JSON answer, quotes removed and split chunks joined."""
    try:
        d = json.loads(doh_json_text)
    except (TypeError, ValueError):
        return None
    out = []
    for a in d.get("Answer") or []:
        data = str(a.get("data") or "")
        chunks = re.findall(r'"((?:[^"\\]|\\.)*)"', data)
        out.append("".join(chunks) if chunks else data)
    return out


def parse_dmarc_record(txt):
    tags = {}
    for part in str(txt or "").split(";"):
        if "=" in part:
            k, _, v = part.strip().partition("=")
            tags[k.strip().lower()] = v.strip()
    return tags


def read_dns_state(ctx, domain):
    """{domain, spf, spf_ok, dkim, dmarc_p, dmarc_sp, rua, pct} from DoH; None values for a name that did not answer."""
    out = {"domain": domain, "spf": None, "spf_ok": None, "dkim": None, "dmarc_p": None, "dmarc_sp": None, "rua": None, "pct": None, "answered": 0}
    h = {"Accept": "application/dns-json"}
    r = ctx.http(DOH % urllib.parse.quote(domain), external=True, headers=h)
    t = txt_data(r.text) if r.status == 200 else None
    if t is not None:
        out["answered"] += 1
        spf = [x for x in t if x.lower().startswith("v=spf1")]
        out["spf"] = spf[0][:200] if spf else ""
        out["spf_ok"] = 1 if spf and "_spf.mx.cloudflare.net" in spf[0] else 0
    r = ctx.http(DOH % urllib.parse.quote("_dmarc." + domain), external=True, headers=h)
    t = txt_data(r.text) if r.status == 200 else None
    if t is not None:
        out["answered"] += 1
        dm = [x for x in t if x.lower().startswith("v=dmarc1")]
        tags = parse_dmarc_record(dm[0]) if dm else {}
        out["dmarc_p"] = tags.get("p", "") if dm else ""
        out["dmarc_sp"] = tags.get("sp", "")
        out["rua"] = 1 if tags.get("rua") else 0
        out["pct"] = tags.get("pct", "")
    r = ctx.http(DOH % urllib.parse.quote("%s._domainkey.%s" % (DKIM_SELECTOR, domain)), external=True, headers=h)
    t = txt_data(r.text) if r.status == 200 else None
    if t is not None:
        out["answered"] += 1
        out["dkim"] = 1 if any("v=dkim1" in x.lower() and "p=" in x.lower() for x in t) else 0
    return out


def collect_dmarc(ctx):
    since = now_s(ctx) - DMARC_WINDOW_DAYS * 86400
    cut = iso_space(since - 2 * 86400)
    rows_sql = ctx.d1("SELECT e.id AS id, r.raw_text AS raw FROM emails e JOIN email_raw_archive r ON r.email_id = e.id "
                      "WHERE e.subject LIKE 'report domain:%' AND replace(substr(e.received_at, 1, 19), 'T', ' ') >= ?1 ORDER BY e.id DESC LIMIT 80", [cut])
    reports, unparsed = [], 0
    for r in rows_sql:
        rep = parse_dmarc_report(r.get("raw") or "")
        if rep:
            reports.append(rep)
        else:
            unparsed += 1
    aligned, total, per = aggregate_dmarc(reports, since)
    rows = []
    for (dom, org), b in sorted(per.items()):
        legit_b = b["total"] - b["foreign"]
        rows.append(("dmarc:%s via %s" % (dom, org), 1 if b["aligned"] == legit_b else 0,
                     "messages=%d aligned_pass=%d dkim_pass=%d spf_pass=%d unaligned=%d of which rejected_or_quarantined_by_receiver=%d foreign_forgeries_blocked=%d reports=%d"
                     % (b["total"], b["aligned"], b["dkim"], b["spf"], b["total"] - b["aligned"], b["enforced"], b["foreign"], b["reports"])))
    dns = []
    for d in DMARC_DOMAINS:
        try:
            st = read_dns_state(ctx, d)
        except Exception as e:  # noqa: BLE001
            st = {"domain": d, "answered": 0}
            rows.append(("dns:" + d, None, "DoH read failed: " + str(e)[:80]))
            dns.append(st)
            continue
        dns.append(st)
        if st["answered"] == 0:
            rows.append(("dns:" + d, None, "DoH did not answer"))
            continue
        rows.append(("dns:" + d, 1 if st.get("spf_ok") and st.get("dkim") and st.get("dmarc_p") else 0,
                     "spf=%s dkim_%s=%s dmarc_p=%s dmarc_sp=%s rua=%s pct=%s" % (st.get("spf_ok"), DKIM_SELECTOR, st.get("dkim"), st.get("dmarc_p"), st.get("dmarc_sp"), st.get("rua"), st.get("pct") or "-")))
    if not getattr(ctx, "dry", False):
        stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now_s(ctx)))
        for st in dns:
            if not st.get("answered"):
                continue
            try:
                ctx.d1("INSERT OR REPLACE INTO bp26_dns_email_auth (domain, spf, spf_ok, dkim_cf_selector, dmarc_policy, dmarc_sp, dmarc_rua, dmarc_pct, checked_at) VALUES (?,?,?,?,?,?,?,?,?)",
                       [st["domain"], st.get("spf"), st.get("spf_ok"), st.get("dkim"), st.get("dmarc_p"), st.get("dmarc_sp"), st.get("rua"), st.get("pct"), stamp])
            except Exception as e:  # noqa: BLE001
                rows.append(("dns-table", None, "bp26_dns_email_auth not writable: " + str(e)[:80]))
                break
    no_rua = sorted(s["domain"] for s in dns if s.get("answered") and s.get("rua") == 0)
    silent = sorted(s["domain"] for s in dns if s.get("answered") and s.get("rua") == 1 and s["domain"] not in {d for d, _ in per})
    reporting = sorted({d for d, _ in per})
    if total == 0:
        return [Result("dmarc_aligned_pass_rate", None, "no parseable DMARC aggregate report ended in the last %d days (%d archived report mails, %d unparsed)" % (DMARC_WINDOW_DAYS, len(rows_sql), unparsed), rows)]
    enforced = sum(b["enforced"] for b in per.values())
    foreign = sum(b["foreign"] for b in per.values())
    foreign_ips = set()
    for r in reports:
        if r["end"] is not None and r["end"] >= since:
            foreign_ips |= set(r.get("foreign_ips") or ())
    legit = total - foreign
    unaligned = legit - aligned  # failures of senders that are not provably a stranger forging the domain
    # The reading of the failures is computed, never asserted: only a message the receiver rejected or quarantined is called stopped by the policy; any other unaligned message was
    # delivered despite failing both aligned checks and is named as such, because that is the one a sender fix would change.
    enforced_legit = enforced - foreign
    reading = ("no unaligned message from a sender that is not a forgery" if not unaligned else
               "all %d unaligned messages were rejected or quarantined by the receiver under the published policy" % unaligned if enforced_legit == unaligned else
               "%d of the %d unaligned messages were rejected or quarantined by the receiver under the published policy and %d were delivered despite failing both aligned checks (review those senders)" % (enforced_legit, unaligned, unaligned - enforced_legit))
    note = ("aligned pass (dkim or spf pass in policy_evaluated) %d of %d messages from the fleet's senders in %d reports of the last %d days; %s; "
            "%d further message(s) from %d source address(es) are excluded as forgeries of the domain stopped by the published policy (no DKIM signature, SPF of the domain itself negative, rejected or quarantined by the receiver; "
            "raw rate including them %d of %d = %s; a forgery the receiver DELIVERED is never excluded); "
            "domains reporting: %s; domains with no rua tag (unmeasured): %s; domains with a rua tag and no report in the window: %s; published policies: %s; %d archived report mails unparsed"
            % (aligned, legit, sum(b["reports"] for b in per.values()), DMARC_WINDOW_DAYS, reading, foreign, len(foreign_ips), aligned, total, round(aligned / float(total), 4),
               ",".join(reporting) or "-", ",".join(no_rua) or "none", ",".join(silent) or "none",
               ",".join("%s=%s" % (s["domain"], s.get("dmarc_p")) for s in dns if s.get("answered")) or "unread", unparsed))
    if legit <= 0:
        return [Result("dmarc_aligned_pass_rate", None, "no message from the fleet's own senders in the reports of the last %d days (all %d message(s) are forgeries stopped by the policy); the last value is kept; %s" % (DMARC_WINDOW_DAYS, total, note), rows)]
    return [Result("dmarc_aligned_pass_rate", aligned / float(legit), note, rows)]


# ---------------------------------------------------------------- RFC 8058 static scan
RX_LU = re.compile(r"""["']List-Unsubscribe["']\s*:""")
RX_LUP = re.compile(r"""["']List-Unsubscribe-Post["']\s*:\s*["']List-Unsubscribe=One-Click["']""")
RX_FOOTER = re.compile(r"[Uu]nsubscribe\s*[:<]|unsubscribe\b[^\n]{0,60}(?:href|https?://)|/unsubscribe\?")
RX_ROUTE = re.compile(r"""["']/unsubscribe["']""")


def scan_list_mail_source(src):
    """-> (ok, detail) for one worker source."""
    has_lu, has_post = bool(RX_LU.search(src)), bool(RX_LUP.search(src))
    has_footer, has_route = bool(RX_FOOTER.search(src)), bool(RX_ROUTE.search(src))
    ok = has_lu and has_post and has_footer and has_route
    return ok, "List-Unsubscribe=%d List-Unsubscribe-Post=%d footer-link=%d /unsubscribe-route=%d" % (has_lu, has_post, has_footer, has_route)


def collect_rfc8058(ctx):
    rows, good = [], 0
    for pid, path in LIST_MAIL_PATHS:
        try:
            ok, detail = scan_list_mail_source(ctx.read(path))
        except OSError as e:
            rows.append((pid, None, "source unreadable: " + str(e)[:60]))
            continue
        rows.append((pid, 1 if ok else 0, path + ": " + detail))
        good += 1 if ok else 0
    scanned = [r for r in rows if r[1] is not None]
    if not scanned:
        return [Result("rfc8058_headers_present", None, "no list-mail source could be read", rows)]
    bad = [r[0] for r in scanned if not r[1]]
    return [Result("rfc8058_headers_present", good / float(len(scanned)),
                   "code-state check of %d list-mail send paths (the mail log carries no headers): %d set both headers, print an unsubscribe link and serve /unsubscribe; missing: %s. "
                   "One-to-one mail (outreach, errata, owner notices) is not list mail." % (len(scanned), good, ", ".join(bad) or "none"), rows)]


# ---------------------------------------------------------------- opt-outs honoured within 48 h
def _hours(a, b):
    """hours from space-format timestamp a to b, or None."""
    try:
        return (calendar.timegm(time.strptime(b[:19], "%Y-%m-%d %H:%M:%S")) - calendar.timegm(time.strptime(a[:19], "%Y-%m-%d %H:%M:%S"))) / 3600.0
    except (TypeError, ValueError):
        return None


def judge_opt_out(requested_at, processed_at, sends_after_48h):
    """-> (honoured, latency hours or None). A missing request time means the handler ran at the request (a link click): latency 0."""
    lat = 0.0 if not requested_at else _hours(requested_at, processed_at)
    if lat is None:
        return None, None
    return (lat <= OPT_OUT_H and int(sends_after_48h or 0) == 0), lat


def collect_unsubscribe(ctx):
    cut = iso_space(now_s(ctx) - OPT_OUT_DAYS * 86400)
    sup = ctx.d1(
        "SELECT s.reason AS reason, s.source AS source, s.created_at AS processed_at, "
        "(SELECT MAX(replace(substr(m.received_at, 1, 19), 'T', ' ')) FROM emails m WHERE lower(m.sender) = lower(s.email) "
        "   AND replace(substr(m.received_at, 1, 19), 'T', ' ') <= s.created_at) AS requested_at, "
        "(SELECT COUNT(*) FROM outreach_log o WHERE lower(o.email) = lower(s.email) "
        "   AND replace(substr(o.sent_at, 1, 19), 'T', ' ') > datetime(s.created_at, '+48 hours')) AS sends_after_48h "
        "FROM email_suppression s WHERE (s.reason = 'reply-stop' OR s.reason LIKE 'unsubscribe%') AND s.created_at >= ?1", [cut])
    subs = ctx.d1("SELECT updated_at AS processed_at, CASE WHEN last_digest_at IS NOT NULL AND last_digest_at > datetime(updated_at, '+48 hours') THEN 1 ELSE 0 END AS sends_after_48h "
                  "FROM subscribers WHERE status = 'unsubscribed' AND updated_at >= ?1", [cut])
    per, total, honoured, unjudged = {}, 0, 0, 0
    for r in sup:
        ok, lat = judge_opt_out(r.get("requested_at"), r.get("processed_at"), r.get("sends_after_48h"))
        key = "%s via %s" % (r.get("reason") if str(r.get("reason")) in ("reply-stop",) else "unsubscribe", str(r.get("source") or "?")[:40])
        b = per.setdefault(key, {"n": 0, "ok": 0, "max_h": 0.0})
        if ok is None:
            unjudged += 1
            continue
        b["n"] += 1
        b["ok"] += 1 if ok else 0
        b["max_h"] = max(b["max_h"], lat or 0.0)
        total += 1
        honoured += 1 if ok else 0
    for r in subs:
        ok, lat = judge_opt_out(None, r.get("processed_at"), r.get("sends_after_48h"))
        b = per.setdefault("unsubscribe via qnfo-subscribers /unsubscribe", {"n": 0, "ok": 0, "max_h": 0.0})
        if ok is None:
            unjudged += 1
            continue
        b["n"] += 1
        b["ok"] += 1 if ok else 0
        total += 1
        honoured += 1 if ok else 0
    rows = [(k, 1 if b["n"] and b["ok"] == b["n"] else 0, "opt_outs=%d honoured=%d max_latency_h=%.1f" % (b["n"], b["ok"], b["max_h"])) for k, b in sorted(per.items()) if b["n"]]
    if total == 0:
        return [Result("unsubscribe_honoured_48h", None, "no opt-out in the last %d days could be judged (%d unjudged)" % (OPT_OUT_DAYS, unjudged), rows)]
    return [Result("unsubscribe_honoured_48h", honoured / float(total),
                   "%d of %d opt-outs of the last %d days honoured: processed within %d h of the request (newest inbound mail from the address before the suppression; a link click is synchronous) "
                   "and nothing sent to the address more than %d h later (outreach_log; subscribers.last_digest_at). q08-signal.subscribers and the companion list keep no opt-out time and are not counted; "
                   "%d unjudged" % (honoured, total, OPT_OUT_DAYS, OPT_OUT_H, OPT_OUT_H, unjudged), rows)]


# ---------------------------------------------------------------- social bot labels
def bsky_label_state(profile_json):
    """-> (enabled bool, labels list) from an AppView getProfile answer."""
    labels = [str(l.get("val")) for l in (profile_json.get("labels") or []) if isinstance(l, dict)]
    return any(v.lower() in BOT_LABELS for v in labels), labels


def collect_social_labels(ctx):
    accounts = []
    dids = ctx.d1("SELECT substr(post_uri, 6, instr(substr(post_uri, 6), '/') - 1) AS did, COUNT(*) AS n FROM social_threads "
                  "WHERE post_uri LIKE 'at://did:%' AND COALESCE(posted_at, created_at) >= datetime('now', '-60 days') GROUP BY 1 ORDER BY n DESC LIMIT 1")
    if dids and dids[0].get("did"):
        accounts.append(("bluesky", dids[0]["did"]))
    chans = {str(r.get("service")): int(r.get("connected") or 0) for r in ctx.d1("SELECT service, connected FROM social_channels")}
    if chans.get("mastodon"):
        accounts.append(("mastodon", MASTODON_ACCT + "@" + MASTODON_HOST))
    if chans.get("twitter"):
        accounts.append(("x", "connected via Buffer"))
    if chans.get("linkedin"):
        accounts.append(("linkedin", "connected via Buffer"))
    rows, enabled = [], 0
    for platform, ref in accounts:
        if platform == "bluesky":
            r = ctx.http(BSKY_PROFILE % urllib.parse.quote(ref), external=True)
            try:
                j = json.loads(r.text) if r.status == 200 else None
            except ValueError:
                j = None
            if not isinstance(j, dict):
                rows.append(("bluesky", None, "profile unreadable (http %s %s)" % (r.status, r.error or "")))
                continue
            on, labels = bsky_label_state(j)
            rows.append(("bluesky", 1 if on else 0, "bot label %s; labels on the profile: %s" % ("on" if on else "off", ",".join(labels) or "none")))
            enabled += 1 if on else 0
        elif platform == "mastodon":
            r = ctx.http(MASTODON_LOOKUP % (MASTODON_HOST, urllib.parse.quote(MASTODON_ACCT)), external=True)
            try:
                j = json.loads(r.text) if r.status == 200 else None
            except ValueError:
                j = None
            if not isinstance(j, dict) or "bot" not in j:
                rows.append(("mastodon", None, "account lookup unreadable (http %s %s)" % (r.status, r.error or "")))
                continue
            rows.append(("mastodon", 1 if j.get("bot") else 0, "bot flag %s" % ("on" if j.get("bot") else "off")))
            enabled += 1 if j.get("bot") else 0
        else:
            rows.append((platform, 0, "unverifiable without credentials: counted as not enabled until the owner card bp26-social-bot-labels closes"))
    if not accounts:
        return [Result("social_bot_label_enabled", None, "no automated social account found in social_threads or social_channels", rows)]
    unreadable = [r[0] for r in rows if r[1] is None]
    if unreadable:
        return [Result("social_bot_label_enabled", None, "an account profile could not be read this run (%s); the last value is kept" % ",".join(unreadable), rows)]
    return [Result("social_bot_label_enabled", enabled / float(len(accounts)),
                   "%d of %d automated accounts have the platform bot label verifiably on (Bluesky AppView labels, Mastodon bot flag); X and LinkedIn are unverifiable without credentials and count as not enabled"
                   % (enabled, len(accounts)), rows)]


# ---------------------------------------------------------------- unsolicited mentions
def post_texts(raw):
    """A social_threads.posts value (a JSON list of strings or objects, or plain text) -> list of strings."""
    try:
        j = json.loads(raw)
    except (TypeError, ValueError):
        return [str(raw)] if raw else []
    if isinstance(j, dict):
        j = j.get("posts") or [j]
    out = []
    for x in j if isinstance(j, list) else [j]:
        out.append(str(x.get("text") if isinstance(x, dict) else x))
    return out


def third_party_mentions(text):
    return [m.group(1) for m in MENTION_RX.finditer(text or "") if m.group(1).lower() not in SELF_HANDLES]


def collect_social_mentions(ctx):
    cut = iso_space(now_s(ctx) - MENTION_DAYS * 86400)
    sources = (
        ("social_threads.posts", "SELECT id, posts AS t FROM social_threads WHERE status = 'posted' AND COALESCE(posted_at, created_at) >= ?1", True),
        ("social_media_posts.content_preview", "SELECT id, content_preview AS t FROM social_media_posts WHERE status = 'published' AND created_at >= ?1", False),
        ("dissemination_tracker.post_text_snippet", "SELECT id, post_text_snippet AS t FROM dissemination_tracker WHERE action = 'posted' AND COALESCE(posted_at, created_at) >= ?1", False),
    )
    rows, flagged, scanned, with_text = [], 0, 0, 0
    for label, sql, is_json in sources:
        n = n_text = n_hit = 0
        for r in ctx.d1(sql, [cut]):
            n += 1
            texts = post_texts(r.get("t")) if is_json else ([str(r.get("t"))] if r.get("t") else [])
            if any(len(t) > 40 for t in texts):
                n_text += 1
            if any(third_party_mentions(t) for t in texts):
                n_hit += 1
        rows.append((label, 1 if n_hit == 0 else 0, "posts=%d with_text=%d with_third_party_mention=%d" % (n, n_text, n_hit)))
        scanned += n
        with_text += n_text
        flagged += n_hit
    reply_sites = None
    try:
        reply_sites = len(REPLY_OBJ_RX.findall(ctx.read("qnfo-social/worker.js")))
    except OSError:
        pass
    if reply_sites is not None:
        rows.append(("qnfo-social reply sites", 1 if reply_sites <= REPLY_SITES_BASELINE else 0,
                     "reply objects {root, parent} in worker.js: %d (baseline %d, both continue the fleet's own thread; more means a new reply path to review)" % (reply_sites, REPLY_SITES_BASELINE)))
    if with_text == 0:
        return [Result("social_unsolicited_mentions", None, "no post text with more than 40 characters in the last %d days (fields missing: social_media_posts holds a label, not the post)" % MENTION_DAYS, rows)]
    extra = 0 if reply_sites is None else max(0, reply_sites - REPLY_SITES_BASELINE)
    return [Result("social_unsolicited_mentions", flagged + extra,
                   "%d automated posts of the last %d days carry an @mention of a non-fleet account, out of %d posts (%d with usable text: full text for Bluesky threads, the first 200 characters for Buffer posts); "
                   "every mention counts as unsolicited because no table links a mention to a user interaction; reply sites beyond the two own-thread continuations: %s"
                   % (flagged, MENTION_DAYS, scanned, with_text, "unread" if reply_sites is None else str(extra)), rows)]


COLLECTORS = [
    Collector("collect_dmarc", collect_dmarc, ["dmarc_aligned_pass_rate"], 50),
    Collector("collect_rfc8058", collect_rfc8058, ["rfc8058_headers_present"], 50),
    Collector("collect_unsubscribe", collect_unsubscribe, ["unsubscribe_honoured_48h"], 50),
    Collector("collect_social_labels", collect_social_labels, ["social_bot_label_enabled"], 120),
    Collector("collect_social_mentions", collect_social_mentions, ["social_unsolicited_mentions"], 50),
]


# ---------------------------------------------------------------- offline suite
def selftest():
    import base64
    import sqlite3
    import tempfile
    from bp26_producers import Resp
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)
            print("FAIL " + m)

    def xml_report(domain, org, end, recs, extra=""):
        rs = "".join("<record><row><source_ip>%s</source_ip><count>%d</count><policy_evaluated><disposition>%s</disposition><dkim>%s</dkim><spf>%s</spf></policy_evaluated></row>"
                     "<identifiers><header_from>%s</header_from></identifiers>%s</record>" % (r[5] if len(r) > 5 else "192.0.2.1", r[0], r[3] if len(r) > 3 else "none", r[1], r[2], domain, r[4] if len(r) > 4 else "") for r in recs)
        return ("<?xml version='1.0'?>%s<feedback><report_metadata><org_name>%s</org_name><date_range><begin>%d</begin><end>%d</end></date_range></report_metadata>"
                "<policy_published><domain>%s</domain><p>reject</p></policy_published>%s</feedback>" % (extra, org, end - 86400, end, domain, rs)).encode()

    def mime(attach, ctype, name):
        b64 = base64.encodebytes(attach).decode()
        return ("From: x@example.org\nTo: dmarc@example.org\nSubject: Report domain: x\nMIME-Version: 1.0\nContent-Type: multipart/mixed; boundary=B\n\n--B\nContent-Type: text/plain\n\nbody\n"
                "--B\nContent-Type: %s; name=\"%s\"\nContent-Transfer-Encoding: base64\nContent-Disposition: attachment; filename=\"%s\"\n\n%s--B--\n" % (ctype, name, name, b64))

    now = 1790000000
    zbuf = io.BytesIO()
    with zipfile.ZipFile(zbuf, "w") as z:
        z.writestr("r.xml", xml_report("qnfo.org", "google.com", now - 3600, [(10, "pass", "fail"), (3, "fail", "pass"), (2, "fail", "fail", "reject")]))
    r1 = parse_dmarc_report(mime(zbuf.getvalue(), "application/zip", "g.zip"))
    ok(r1 and r1["domain"] == "qnfo.org" and r1["org"] == "google.com" and len(r1["records"]) == 3, "a zip attachment is parsed: %r" % (r1,))
    r2 = parse_dmarc_report(mime(gzip.compress(xml_report("qwav.org", "lolipop.jp", now - 7200, [(5, "pass", "pass")])), "application/gzip", "l.xml.gz"))
    ok(r2 and r2["org"] == "lolipop.jp" and r2["records"] == [(5, "pass", "pass", "none")], "a gzip attachment is parsed")
    old = parse_dmarc_report(mime(xml_report("qnfo.org", "old.example", now - 30 * 86400, [(100, "fail", "fail")]), "text/xml", "o.xml"))
    al, tot, per = aggregate_dmarc([r1, r2, old], now - 7 * 86400)
    ok((al, tot) == (18, 20) and ("qnfo.org", "google.com") in per and ("qnfo.org", "old.example") not in per, "aligned = dkim or spf pass, weighted by count, old reports excluded: %r" % ((al, tot),))
    ok(per[("qnfo.org", "google.com")]["enforced"] == 2, "failing messages the receiver rejected are counted apart: %r" % (per[("qnfo.org", "google.com")],))
    ok(parse_dmarc_report(mime(xml_report("qnfo.org", "evil", now, [(1, "pass", "pass")], extra="<!DOCTYPE x [<!ENTITY a 'b'>]>"), "text/xml", "e.xml")) is None, "an XML with a DTD or entity is refused")
    ok(parse_dmarc_report("From: a\nSubject: Report domain: x\n\nno attachment\n") is None, "a mail without an attachment is not a report")
    ok(txt_data('{"Status":0,"Answer":[{"data":"\\"v=spf1 include:_spf.mx.cloudflare.net ~all\\""},{"data":"\\"abc\\" \\"def\\""}]}') == ["v=spf1 include:_spf.mx.cloudflare.net ~all", "abcdef"], "TXT chunks are joined")
    ok(parse_dmarc_record("v=DMARC1; p=reject; sp=reject; rua=mailto:dmarc@qnfo.org;") == {"v": "DMARC1", "p": "reject", "sp": "reject", "rua": "mailto:dmarc@qnfo.org"}, "a DMARC record is parsed")

    # fake context over an in-memory sqlite: qnfo-audit tables the collectors read
    c = sqlite3.connect(":memory:")
    c.executescript("""
CREATE TABLE emails (id INTEGER PRIMARY KEY, subject TEXT, sender TEXT, received_at TEXT);
CREATE TABLE email_raw_archive (email_id INTEGER, raw_text TEXT);
CREATE TABLE email_suppression (email TEXT PRIMARY KEY, reason TEXT, source TEXT, created_at TEXT);
CREATE TABLE outreach_log (id INTEGER PRIMARY KEY, email TEXT, sent_at TEXT, status TEXT);
CREATE TABLE subscribers (email TEXT PRIMARY KEY, status TEXT, updated_at TEXT, last_digest_at TEXT);
CREATE TABLE social_threads (id INTEGER PRIMARY KEY, posts TEXT, status TEXT, posted_at TEXT, created_at TEXT, post_uri TEXT);
CREATE TABLE social_media_posts (id TEXT PRIMARY KEY, content_preview TEXT, status TEXT, created_at TEXT);
CREATE TABLE dissemination_tracker (id TEXT PRIMARY KEY, post_text_snippet TEXT, action TEXT, posted_at TEXT, created_at TEXT);
CREATE TABLE social_channels (channel_id TEXT, service TEXT, connected INTEGER);
CREATE TABLE bp26_dns_email_auth (domain TEXT PRIMARY KEY, spf TEXT, spf_ok INTEGER, dkim_cf_selector INTEGER, dmarc_policy TEXT, dmarc_sp TEXT, dmarc_rua INTEGER, dmarc_pct TEXT, checked_at TEXT);
""")
    d1 = lambda sql, p=None: [dict(zip([d[0] for d in cur.description], row)) for cur in [c.execute(sql, p or [])] for row in cur.fetchall()]  # noqa: E731
    stamp = time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(now - 3600))
    c.execute("INSERT INTO emails VALUES (1, 'Report domain: qnfo.org Submitter: google.com', 'noreply-dmarc@google.com', ?)", [stamp.replace(" ", "T") + ".000Z"])
    c.execute("INSERT INTO email_raw_archive VALUES (1, ?)", [mime(zbuf.getvalue(), "application/zip", "g.zip")])
    c.execute("INSERT INTO emails VALUES (2, 'Report Domain: qwav.org Submitter: lolipop.jp', 'x', ?)", [stamp.replace(" ", "T") + ".000Z"])
    c.execute("INSERT INTO email_raw_archive VALUES (2, ?)", [mime(gzip.compress(xml_report("qwav.org", "lolipop.jp", now - 7200, [(5, "pass", "pass")])), "application/gzip", "l.xml.gz")])
    doh = {
        "qnfo.org": '{"Answer":[{"data":"\\"v=spf1 include:_spf.mx.cloudflare.net ~all\\""}]}',
        "_dmarc.qnfo.org": '{"Answer":[{"data":"\\"v=DMARC1; p=reject; sp=reject; rua=mailto:dmarc@qnfo.org;\\""}]}',
        "cf2024-1._domainkey.qnfo.org": '{"Answer":[{"data":"\\"v=DKIM1; h=sha256; k=rsa; p=AAAA\\""}]}',
        "_dmarc.q08.org": '{"Answer":[{"data":"\\"v=DMARC1; p=reject;\\""}]}',
    }

    def http(url, **kw):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
        if "dns-query" in url:
            body = doh.get(q["name"][0], '{"Status":0}')
            return Resp(200, {}, [], body, url, 1, [], None)
        if "bsky" in url:
            return Resp(200, {}, [], '{"handle":"qnfo.org","labels":[]}', url, 1, [], None)
        if "mstdn" in url:
            return Resp(200, {}, [], '{"acct":"QNFO","bot":false}', url, 1, [], None)
        return Resp(0, {}, [], "", url, 0, [], "unexpected")

    td = tempfile.mkdtemp()
    for rel, body in (("qnfo-subscribers/worker.js", 'return { "List-Unsubscribe": "<" + u + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }; "Unsubscribe: " + u; if (p === "/unsubscribe") {}'),
                      ("q08-signal-engine/worker.js", 'h = { "List-Unsubscribe": "<" + u + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }; "Unsubscribe: " + u; path === "/unsubscribe"'),
                      ("personal-companion/worker.js", 'send({ to, from, subject, text: body + "Unsubscribe: " + u }); p === "/unsubscribe"'),
                      ("qnfo-social/worker.js", 'const reply = i > 0 ? { root: root, parent: parent } : undefined;')):
        os.makedirs(os.path.join(td, os.path.dirname(rel)), exist_ok=True)
        with open(os.path.join(td, rel), "w", encoding="utf-8") as f:
            f.write(body)
    import types

    def read_file(rel):
        with open(os.path.join(td, rel), encoding="utf-8") as f:
            return f.read()
    cx = types.SimpleNamespace(dry=False, now=now, d1=d1, http=http, read=read_file, root=td)
    res = collect_dmarc(cx)[0]
    ok(res.metric == "dmarc_aligned_pass_rate" and abs(res.value - 18 / 20.0) < 1e-9, "dmarc value is 18/20 over both reports: %r" % (res.value,))
    ok("q08.org" in res.note and "no rua" in res.note, "the note names the domain without a rua tag: " + res.note)
    ok("all 2 unaligned messages were rejected or quarantined" in res.note, "the reading of the failures is computed: " + res.note)
    ok(c.execute("SELECT dmarc_policy, dmarc_rua, dkim_cf_selector FROM bp26_dns_email_auth WHERE domain = 'qnfo.org'").fetchone() == ("reject", 1, 1), "the DNS state is kept in bp26_dns_email_auth")
    # BP26-DMARC-FOREIGN-1: forgeries of the domain that the policy stopped are not the fleet's senders
    forged = "<auth_results><spf><domain>qnfo.org</domain><result>softfail</result></spf></auth_results>"
    other_bounce = "<auth_results><spf><domain>mail.third-party.example</domain><result>pass</result></spf></auth_results>"
    signed_bad = "<auth_results><dkim><domain>qnfo.org</domain><result>fail</result><selector>s1</selector></dkim><spf><domain>qnfo.org</domain><result>softfail</result></spf></auth_results>"
    dkim_none = "<auth_results><dkim><domain></domain><result>none</result></dkim><spf><domain>qnfo.org</domain><result>softfail</result></spf></auth_results>"
    fr = parse_dmarc_report(mime(xml_report("qnfo.org", "google.com", now - 3600, [
        (6, "pass", "pass", "none", ""),
        (3, "fail", "fail", "reject", forged, "198.51.100.7"),
        (1, "fail", "fail", "none", forged, "198.51.100.8"),
        (1, "fail", "fail", "reject", other_bounce, "198.51.100.9"),
        (1, "fail", "fail", "reject", signed_bad, "198.51.100.10"),
        (2, "fail", "fail", "reject", dkim_none, "198.51.100.11")]), "text/xml", "f.xml"))
    ok(fr["foreign"] == [False, True, False, False, False, True] and fr["foreign_ips"] == {"198.51.100.7", "198.51.100.11"},
       "the unsigned, SPF-negative, receiver-rejected forgeries are foreign, a reporter's dkim result none is no signature: %r" % (fr["foreign"],))
    ok(is_foreign_source("fail", "fail", "reject", "qnfo.org", 0, [("bounce.qnfo.org", "fail")]) and not is_foreign_source("fail", "fail", "reject", "qnfo.org", 0, []), "a subdomain SPF fail counts, no SPF evidence does not")
    c.execute("DELETE FROM email_raw_archive")
    c.execute("INSERT INTO email_raw_archive VALUES (1, ?)", [mime(xml_report("qnfo.org", "google.com", now - 3600, [
        (6, "pass", "pass", "none", ""), (3, "fail", "fail", "reject", forged, "198.51.100.7"), (1, "fail", "fail", "none", forged, "198.51.100.8"),
        (1, "fail", "fail", "reject", other_bounce, "198.51.100.9")]), "text/xml", "f.xml")])
    ff = collect_dmarc(cx)[0]
    ok(abs(ff.value - 6 / 8.0) < 1e-9 and "3 further message(s) from 1 source address(es)" in ff.note and "raw rate including them 6 of 11" in ff.note, "stopped forgeries leave the denominator, a delivered forgery and a misconfigured sender stay in it: %r %s" % (ff.value, ff.note))
    ok("198.51.100" not in ff.note and all("198.51.100" not in str(x) for x in ff.rows), "no source address in the note or the rows")
    ok("foreign_forgeries_blocked=3" in ff.rows[0][2], "the evidence row counts the blocked forgeries: %r" % (ff.rows[0],))
    c.execute("DELETE FROM email_raw_archive")
    c.execute("INSERT INTO email_raw_archive VALUES (1, ?)", [mime(xml_report("qnfo.org", "google.com", now - 3600, [(2, "fail", "fail", "reject", forged)]), "text/xml", "g.xml")])
    only = collect_dmarc(cx)[0]
    ok(only.value is None and "forgeries stopped by the policy" in only.note, "a window with only forgeries is unknown, never 1.0: %r" % (only.value,))
    c.execute("DELETE FROM email_raw_archive")
    ok(collect_dmarc(cx)[0].value is None, "no report in the archive: None, not zero")
    c.execute("INSERT INTO email_raw_archive VALUES (1, ?)", [mime(xml_report("qnfo.org", "google.com", now - 3600, [(4, "pass", "pass"), (1, "fail", "fail")]), "text/xml", "d.xml")])
    dd = collect_dmarc(cx)[0]
    ok(abs(dd.value - 0.8) < 1e-9 and "delivered despite failing both aligned checks" in dd.note, "an unaligned message that was delivered is named as such: " + dd.note)
    r = collect_rfc8058(cx)[0]
    ok(abs(r.value - 2 / 3.0) < 1e-9 and "personal-companion" in r.note, "two of three list-mail paths are compliant, the third is named: %r %s" % (r.value, r.note))
    ok(scan_list_mail_source("x")[0] is False, "an empty source is not compliant")

    # opt-outs
    old = time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(now - 5 * 86400))
    c.execute("INSERT INTO email_suppression VALUES ('a@x.org', 'reply-stop', 'reply-scan', ?)", [old])
    c.execute("INSERT INTO emails VALUES (10, 'Re: hello', 'a@x.org', ?)", [time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(now - 5 * 86400 - 3600))])
    c.execute("INSERT INTO email_suppression VALUES ('b@x.org', 'reply-stop', 'reply-scan', ?)", [old])
    c.execute("INSERT INTO emails VALUES (11, 'Re: hello', 'b@x.org', ?)", [time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(now - 5 * 86400 - 3 * 86400))])
    c.execute("INSERT INTO email_suppression VALUES ('c@x.org', 'unsubscribe', 'qnfo-email /email/unsubscribe', ?)", [old])
    c.execute("INSERT INTO outreach_log VALUES (1, 'c@x.org', ?, 'sent')", [time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(now - 86400))])
    c.execute("INSERT INTO email_suppression VALUES ('d@x.org', 'predatory solicitation', 'owner', ?)", [old])
    c.execute("INSERT INTO subscribers VALUES ('s@x.org', 'unsubscribed', ?, NULL)", [old])
    u = collect_unsubscribe(cx)[0]
    ok(u.value is not None and abs(u.value - 2 / 4.0) < 1e-9, "a (1 h) and the subscriber row are honoured, b (72 h late) and c (mailed after 48 h) are not: %r" % (u.value,))
    ok("@" not in u.note and all("@" not in str(x) for x in u.rows), "no address in the note or the rows")
    c.execute("DELETE FROM email_suppression")
    c.execute("DELETE FROM subscribers")
    ok(collect_unsubscribe(cx)[0].value is None, "no opt-out in the window: None")

    # social labels and mentions
    c.execute("INSERT INTO social_threads VALUES (1, ?, 'posted', ?, ?, 'at://did:plc:abc123/app.bsky.feed.post/3k')", [json.dumps(["A thread about q08 with @someone.bsky.social and a long enough text to count", "second post"]), old, old])
    c.execute("INSERT INTO social_channels VALUES ('1', 'mastodon', 1)")
    c.execute("INSERT INTO social_channels VALUES ('2', 'twitter', 1)")
    c.execute("INSERT INTO social_channels VALUES ('3', 'linkedin', 1)")
    lab = collect_social_labels(cx)[0]
    ok(lab.value == 0.0 and len(lab.rows) == 4 and any(x[0] == "x" and "unverifiable" in x[2] for x in lab.rows), "no verified bot label on four automated accounts: 0 of 4, X and LinkedIn unverifiable: %r" % (lab.value,))
    ok(bsky_label_state({"labels": [{"val": "bot"}]})[0] and not bsky_label_state({"labels": [{"val": "porn"}]})[0], "the bot label is recognised")
    c.execute("INSERT INTO social_media_posts VALUES ('p1', 'plain preview with no mention at all of any other account here', 'published', ?)", [old])
    men = collect_social_mentions(cx)[0]
    ok(men.value == 1, "one thread carries a third-party mention: %r %s" % (men.value, men.note))
    ok(third_party_mentions("thanks @QNFO and mail a@b.org or https://x.com/@foo") == [], "self handles, e-mail addresses and URL paths are not mentions")
    ok(third_party_mentions("cc @alice and @bob@mstdn.social") == ["alice", "bob"], "Bluesky and Mastodon mentions are found")
    print("bp26_reach selftest %s" % ("ok" if not fails else "FAILED %d" % len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    print(__doc__)
