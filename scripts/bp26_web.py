#!/usr/bin/env python3
"""BP26-WEB-1 collectors (2026-10-26, charter pillars security, reach, core, autonomy; agent_issues 1000341 EU AI Act Art. 50, 1000356 edge security, 1000345 cookies and tracking,
1000336 structured data, 1000357 SLOs).

The public-page half of nine metrics of the BP26 catalogue, run by scripts/bp26_producers.py from the remediation-consumer job (GitHub runner, outside the Cloudflare account).
Read-only: plain GETs of public pages of hosts the fleet owns, one qnfo-audit read for the social-post text, one read of two worker sources on the checkout. No form is submitted, no
message is sent to the twin or the email agent, no credential is sent. Every value is measured; what cannot be measured is None and writes nothing.

One collector (collect_web) so a page is fetched once per run and every metric reads the same responses:
  security_headers_pass        public HTML hosts (the host's `/` answers text/html after redirects; a 401 or 403 page still counts for its headers) whose response carries
                               Strict-Transport-Security with max-age >= 15552000, X-Content-Type-Options nosniff, a Referrer-Policy that is not unsafe-url or
                               no-referrer-when-downgrade, and frame protection (X-Frame-Options DENY or SAMEORIGIN, or a CSP frame-ancestors other than *) / all of them.
                               JSON-only hosts (ops., memory., research-exec.) are not HTML hosts and are listed as excluded. A host that cannot be fetched is unknown (no row
                               ok, left out of the denominator); more than a third of the hosts unknown makes the value None.
  slo_attainment_28d_min       the lowest, over the public HTML hosts, of (answers in the window with a 2xx, 3xx, 401 or 403 under 5 s) / (answers in the window), the
                               window being the last 28 days of this collector's own evidence rows (bp26_probe_results, subject avail:<host>) plus this run. None while any host has
                               fewer than 24 samples; the note states the window actually covered, so a 3-day-old history is never reported as a 28-day SLO without saying so.
                               BP26-SLO-FRESHNESS-1 (roadmap 1710) adds two more kinds of evidence row to the same result, outside the availability figure: lat:<host> (the
                               home page answered in under 2 s, redirects included; no observation, no sample) and fresh:q08.org (one sample a day: a q08 piece was published in the
                               24 hours before 09:00 Central European time, read from the q08-signal database; the SLI of the research desk). scripts/bp26_slo.py evaluates them
                               against slo_definitions rows whose source names the subject.
  third_party_trackers         distinct (host, tracker) pairs: a script, pixel, iframe or stylesheet from a curated tracker-domain list (analytics, advertising, session replay),
                               or an inline gtag/fbq/_paq call, on the fetched pages. Cloudflare Web Analytics (static.cloudflareinsights.com) is the cookieless beacon the issue
                               allows and is not counted. Tags that Cloudflare Zaraz injects at the edge are invisible to a GET and are not counted (the note says so).
  non_essential_cookies_set    distinct non-essential cookie names: Set-Cookie headers of the fetched responses (cookies of fleet.qnfo.org and Cloudflare's own security cookies
                               are essential) plus the cookies a detected analytics tag implies (gtag -> _ga and _ga_<id>), which a cookie-less GET cannot see being set.
  turnstile_on_public_forms    forms that collect data (POST, or an e-mail/textarea input, or a subscribe/contact/feedback/draft form) on the fetched pages whose page carries a
                               Turnstile widget / forms. JavaScript-rendered forms are invisible to a GET; the note says so.
  structured_data_valid        page templates (q08 home and piece, reading home and piece, papers home and a paper, qnfo.org, ipatent, ideas) whose JSON-LD parses, uses a
                               schema.org type, carries that type's required properties, names no invented or AI persona as author and, for a paper page, carries the
                               citation_title / citation_author / citation_publication_date meta tags / all templates. A template with no JSON-LD is invalid.
  ai_label_coverage            AI-touched public templates (q08 piece, reading piece, paper page, qnfo.org page, social post text) carrying the VISIBLE label (a short text node
                               that is an AI-generated / AI-assisted label, or a sentence saying the text was written by AI; keywords and attributes do not count) AND the JSON-LD
                               flag (creditText naming AI, digitalSourceType, isAIGenerated) / all of them; the social template needs the marker in the text of every post of
                               the last 14 days (qnfo-audit social_media_posts previews are cut at 200 characters, social_threads.posts is whole).
  ai_interaction_disclosure    interactive AI surfaces whose first screen or first reply carries the AI disclosure / all of them: ipatent (live first screen), the twin (live first
                               screen of me.q08.org), the e-mail agent (code-state: qnfo-email/worker.js on the checkout, since it must not be mailed).
  a11y_violations_serious      a static LOWER BOUND of the serious and critical axe-core violations on the fetched pages (html-has-lang, document-title, image-alt, meta-viewport,
                               form-field label, button-name, link-name). axe-core itself needs a headless browser and an npm install, and the consume job has neither, so colour
                               contrast, ARIA validity and focus order are not seen. A count above zero proves the target (0) missed and is written; a count of zero proves nothing
                               and is not written (None), so this metric can breach but never pass until an axe run exists.

Usage:
  python3 scripts/bp26_web.py --selftest     offline suite (fake pages, no network, no secrets)
  CF_ACCOUNT_ID=<id> python3 scripts/bp26_producers.py --dry --only collect_web     live read-only run through the framework
"""
import calendar
import concurrent.futures
import datetime
import html as htmllib
import json
import os
import re
import sys
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bp26_producers import Collector, Resp, Result  # noqa: E402

HTML_HOSTS = ("qnfo.org", "papers.qnfo.org", "archive.qnfo.org", "fleet.qnfo.org", "ideas.qnfo.org", "ipatent.qnfo.org", "ai.qnfo.org", "q08.org", "reading.q08.org",
              "travel.q08.org", "me.q08.org", "qwav.org", "ask.qwav.tech")
EXCLUDED_JSON_HOSTS = ("ops.qnfo.org", "memory.qnfo.org", "research-exec.qnfo.org")
HSTS_MIN = 15552000
SLO_MIN_SAMPLES = 24
SLO_WINDOW_DAYS = 28
SLO_MAX_MS = 5000
LAT_GOOD_MS = 2000
DESK_DB = "q08-signal"
DESK_DEADLINE_HOUR = 9
DESK_WINDOW_H = 24
DESK_SUBJECT = "fresh:q08.org"
HOST_UNKNOWN_MAX_SHARE = 1.0 / 3.0
SOCIAL_DAYS = 14
BAD_REFERRER = frozenset(("unsafe-url", "no-referrer-when-downgrade", ""))
ESSENTIAL_COOKIE_HOSTS = ("fleet.qnfo.org",)
ESSENTIAL_COOKIE_NAMES = frozenset(("__cf_bm", "cf_clearance", "__cflb", "_cfuvid", "__cfruid", "__cfwaitingroom"))
# analytics, advertising and session-replay hosts (curated; a host is matched by suffix). Cloudflare Web Analytics is deliberately absent.
TRACKERS = {
    "google-analytics.com": "Google Analytics", "analytics.google.com": "Google Analytics", "googletagmanager.com": "Google Tag Manager / gtag",
    "doubleclick.net": "Google Ads", "googlesyndication.com": "Google Ads", "googleadservices.com": "Google Ads", "facebook.net": "Meta pixel",
    "connect.facebook.net": "Meta pixel", "hotjar.com": "Hotjar", "clarity.ms": "Microsoft Clarity", "segment.com": "Segment", "segment.io": "Segment",
    "mixpanel.com": "Mixpanel", "amplitude.com": "Amplitude", "fullstory.com": "FullStory", "mouseflow.com": "Mouseflow", "px.ads.linkedin.com": "LinkedIn Insight",
    "snap.licdn.com": "LinkedIn Insight", "static.ads-twitter.com": "X ads pixel", "analytics.twitter.com": "X analytics", "analytics.tiktok.com": "TikTok pixel",
    "plausible.io": "Plausible (third-party host)", "matomo.cloud": "Matomo cloud", "heap.io": "Heap", "heapanalytics.com": "Heap", "crazyegg.com": "Crazy Egg",
    "intercom.io": "Intercom", "hs-scripts.com": "HubSpot", "hs-analytics.net": "HubSpot", "optimizely.com": "Optimizely", "newrelic.com": "New Relic browser",
    "scorecardresearch.com": "Comscore", "quantserve.com": "Quantcast", "adroll.com": "AdRoll", "criteo.com": "Criteo", "taboola.com": "Taboola", "outbrain.com": "Outbrain",
}
INLINE_TRACKER_SIGNS = (
    (re.compile(r"googletagmanager\.com|google-analytics\.com"), "googletagmanager.com"),
    (re.compile(r"\bgtag\s*\("), "googletagmanager.com"),
    (re.compile(r"\bfbq\s*\("), "facebook.net"),
    (re.compile(r"_paq\.push|_mtm\.push"), "matomo.cloud"),
    (re.compile(r"\bhj\s*\(\s*['\"]"), "hotjar.com"),
)
KNOWN_TYPES = frozenset("""Article ScholarlyArticle NewsArticle BlogPosting TechArticle Report Blog Organization Person WebSite WebPage CollectionPage ItemPage ProfilePage AboutPage ContactPage
Periodical PublicationIssue PublicationVolume Dataset DataCatalog DataDownload ImageObject VideoObject AudioObject MediaObject BreadcrumbList ListItem ItemList Review Rating FAQPage Question
Answer HowTo HowToStep SoftwareApplication WebApplication MobileApplication SoftwareSourceCode Offer Demand PropertyValue QuantitativeValue Place PostalAddress ContactPoint
EducationalOrganization ResearchOrganization NGO Corporation SearchAction ReadAction Thing CreativeWork Book Event Claim ClaimReview Comment DefinedTerm DefinedTermSet Collection
Course LearningResource Quotation Table WPHeader WPFooter SiteNavigationElement Language Country""".split())
# required properties per type; "a|b" means either
REQUIRED = {
    "Article": ("headline|name", "author", "datePublished"), "ScholarlyArticle": ("headline|name", "author", "datePublished"),
    "NewsArticle": ("headline|name", "author", "datePublished"), "BlogPosting": ("headline|name", "author", "datePublished"), "TechArticle": ("headline|name", "author", "datePublished"),
    "Report": ("headline|name", "author", "datePublished"), "Dataset": ("name", "description"), "Organization": ("name",), "Person": ("name",), "WebSite": ("name|url",),
    "WebPage": ("name|url",), "Blog": ("name|url",), "CollectionPage": ("name|url",), "Periodical": ("name",), "WebApplication": ("name",), "SoftwareApplication": ("name",),
    "ItemList": ("itemListElement",), "BreadcrumbList": ("itemListElement",), "FAQPage": ("mainEntity",),
}
ARTICLE_TYPES = frozenset(("Article", "ScholarlyArticle", "NewsArticle", "BlogPosting", "TechArticle", "Report"))
PERSONA_RX = re.compile(r"\b(ai|a\.i\.|gpt|chatgpt|claude|gemini|llm|assistant|bot|language model)\b", re.I)
LABEL_EXACT_RX = re.compile(r"^[^\w]{0,4}(?:an? )?(?:ai|a\.i\.|artificial[- ]intelligence|machine)[- ](?:generated|assisted|modified|written|authored)(?: (?:content|text|piece|article|summary|draft|image|post|page))?[.!]?$", re.I)
LABEL_SENTENCE_RX = re.compile(
    r"\b(?:written|drafted|generated|produced|created|researched)(?: and (?:written|drafted|checked))? (?:entirely |fully |mostly )?by (?:an? )?(?:ai|artificial intelligence)\b"
    r"|\bai[- ]generated (?:content|text|piece|article|summary)\b"
    r"|\b(?:this|the) (?:piece|article|paper|page|text|post)(?: was| is)(?: [a-z-]+){0,3} (?:written|drafted|generated|produced|created) (?:by|with) (?:an? )?(?:ai|artificial intelligence)\b", re.I)
DISCLOSURE_RX = re.compile(r"\b(?:is an ai system|an ai language model|you are (?:talking|chatting|interacting|speaking) with an? (?:ai|automated)|this is an ai\b|i am an ai\b|i'm an ai\b|ai[- ]generated (?:reply|response|answer))", re.I)
EMAIL_DISCLOSURE_RX = re.compile(
    r"(?:this (?:reply|message|email|e-mail) (?:was|is) (?:written|drafted|generated|composed) by an? (?:ai|automated|artificial)|written by an? ai\b|ai[- ]generated (?:reply|response)|AI_DISCLOSURE|aiDisclosure|ai_disclosure)", re.I)
SOCIAL_MARKER_RX = re.compile(r"(?:\U0001F916|\bautomated (?:post|account)\b|#bot\b|\bai[- ]generated\b|\bwritten by ai\b|\bposted by (?:a )?bot\b|\[auto\])", re.I)
TURNSTILE_RX = re.compile(r"cf-turnstile|challenges\.cloudflare\.com/turnstile|turnstile\.render", re.I)
FORM_RX = re.compile(r"<form\b([^>]*)>(.*?)</form>", re.S | re.I)
CITATION_REQUIRED = ("citation_title", "citation_author", "citation_publication_date")
# (worker source, regex of the Set-Cookie CONSTRUCTION with a value, cookie name, host): non-essential cookies given to human visitors only. The regex must not match a reader of the
# cookie or the header that deletes it (qnfo-ipatent 3.19.1 keeps both: `ipatent_ab=([12])` and `AB_COOKIE + "=; ... Max-Age=0`), only the code that sets it with a value.
CODE_COOKIES = (("qnfo-ipatent/worker.js", r"AB_COOKIE\s*\+\s*\"=\"\s*\+", "ipatent_ab", "ipatent.qnfo.org"),)


# ---------------------------------------------------------------- pure parsers
def visible_nodes(page):
    """The text nodes a reader sees: comments, scripts, styles, templates, noscript and the whole <head> removed, attributes never included."""
    t = re.sub(r"<!--.*?-->", " ", page or "", flags=re.S)
    t = re.sub(r"<(script|style|noscript|template)\b.*?</\1\s*>", " ", t, flags=re.S | re.I)
    t = re.sub(r"<head\b.*?</head\s*>", " ", t, flags=re.S | re.I)
    out = []
    for p in re.split(r"<[^>]*>", t):
        s = " ".join(htmllib.unescape(p).split())
        if s:
            out.append(s)
    return out


def has_visible_label(page):
    for s in visible_nodes(page):
        if LABEL_EXACT_RX.match(s) or (len(s) <= 300 and LABEL_SENTENCE_RX.search(s)):
            return s[:80]
    return None


def has_visible_disclosure(page):
    for s in visible_nodes(page):
        if len(s) <= 400 and DISCLOSURE_RX.search(s):
            return s[:80]
    return None


def jsonld_items(page):
    """([typed objects of every JSON-LD block, @graph members included], number of blocks that do not parse)."""
    items, bad = [], 0
    for m in re.finditer(r"<script\b[^>]*type\s*=\s*[\"']application/ld\+json[\"'][^>]*>(.*?)</script\s*>", page or "", re.S | re.I):
        try:
            d = json.loads(m.group(1).strip())
        except ValueError:
            bad += 1
            continue
        stack = [d]
        while stack:
            x = stack.pop()
            if isinstance(x, list):
                stack.extend(x)
            elif isinstance(x, dict):
                if isinstance(x.get("@graph"), list):
                    stack.extend(x["@graph"])
                if x.get("@type"):
                    items.append(x)
    return items, bad


def types_of(item):
    t = item.get("@type")
    return [str(x) for x in t] if isinstance(t, list) else [str(t)]


def ai_flag(items):
    """The JSON-LD flag of an AI-touched artifact: creditText naming AI or machine authorship, a digitalSourceType, or an isAIGenerated style property."""
    for it in items:
        ct = it.get("creditText")
        if isinstance(ct, str) and re.search(r"\b(ai|artificial intelligence|machine|automated)\b", ct, re.I):
            return "creditText"
        if it.get("digitalSourceType"):
            return "digitalSourceType"
        for k, v in it.items():
            if re.match(r"^(is)?ai[_-]?generated$", str(k), re.I) and v not in (False, None, "", "false", 0):
                return str(k)
    return None


def author_problem(item):
    a = item.get("author")
    for x in (a if isinstance(a, list) else [a]):
        if isinstance(x, dict):
            name, typ = str(x.get("name") or ""), types_of(x)
            if "Person" in typ and PERSONA_RX.search(name):
                return "author %r looks like an AI or invented persona" % name[:40]
        elif isinstance(x, str) and PERSONA_RX.search(x):
            return "author %r looks like an AI or invented persona" % x[:40]
    return None


def meta_names(page):
    return {m.group(1).lower() for m in re.finditer(r"<meta\b[^>]*\bname\s*=\s*[\"']([^\"']+)[\"'][^>]*\bcontent\s*=\s*[\"'][^\"']+", page or "", re.I)}


def structured_verdict(page, kind):
    """(ok, detail) for one template. kind: 'article', 'paper' or 'home'."""
    items, bad = jsonld_items(page)
    if bad:
        return False, "%d JSON-LD block(s) do not parse" % bad
    if not items:
        return False, "no JSON-LD"
    good, problems = 0, []
    for it in items:
        ts = types_of(it)
        known = [t for t in ts if t in KNOWN_TYPES]
        if not known:
            problems.append("type %s is not a checked schema.org type" % ts[0][:30])
            continue
        miss = []
        for t in known[:1]:
            for req in REQUIRED.get(t, ()):
                if not any(it.get(k) not in (None, "", [], {}) for k in req.split("|")):
                    miss.append(req)
        ap = author_problem(it) if known[0] in ARTICLE_TYPES else None
        if miss:
            problems.append("%s lacks %s" % (known[0], ",".join(miss)))
        elif ap:
            problems.append(ap)
        else:
            good += 1
    if good == 0:
        return False, "; ".join(problems)[:200] or "no valid item"
    if kind in ("article", "paper") and not any(set(types_of(it)) & ARTICLE_TYPES for it in items):
        return False, "no Article-type item (types: %s)" % ",".join(sorted({t for it in items for t in types_of(it)}))[:100]
    if kind == "paper":
        have = meta_names(page)
        missing = [c for c in CITATION_REQUIRED if c not in have]
        if missing:
            return False, "paper page lacks " + ",".join(missing)
    return True, "%d valid item(s): %s" % (good, ",".join(sorted({t for it in items for t in types_of(it)}))[:80])


def header_verdict(resp):
    """(ok, detail, missing list) for the four security headers of one response."""
    h = resp.headers or {}
    miss = []
    m = re.search(r"max-age\s*=\s*(\d+)", h.get("strict-transport-security", ""), re.I)
    if not m or int(m.group(1)) < HSTS_MIN:
        miss.append("hsts")
    if (h.get("x-content-type-options") or "").strip().lower() != "nosniff":
        miss.append("nosniff")
    if (h.get("referrer-policy") or "").strip().lower() in BAD_REFERRER:
        miss.append("referrer")
    xfo = (h.get("x-frame-options") or "").strip().upper()
    csp = h.get("content-security-policy") or ""
    fa = re.search(r"frame-ancestors\s+([^;]+)", csp, re.I)
    if xfo not in ("DENY", "SAMEORIGIN") and not (fa and fa.group(1).strip() != "*"):
        miss.append("frame")
    return (not miss), ("ok" if not miss else "missing " + ",".join(miss)), miss


def a11y_findings(page):
    """[(rule, impact)] of a static pass over one page, limited to axe-core rules that a regular expression can decide with few false positives: html-has-lang, document-title,
    image-alt, meta-viewport, label (form fields), button-name, link-name. It is a LOWER BOUND of what axe-core reports (colour contrast, ARIA validity, focus order and more
    need a browser), so a count above zero proves the target missed and a count of zero proves nothing."""
    out, doc = [], page or ""
    m = re.search(r"<html\b([^>]*)>", doc, re.I)
    if m and not re.search(r"\blang\s*=\s*[\"']?[A-Za-z]", m.group(1)):
        out.append(("html-has-lang", "serious"))
    t = re.search(r"<title\b[^>]*>(.*?)</title\s*>", doc, re.S | re.I)
    if not t or not htmllib.unescape(re.sub(r"<[^>]*>", "", t.group(1))).strip():
        out.append(("document-title", "serious"))
    for im in re.finditer(r"<img\b([^>]*)>", doc, re.I):
        a = im.group(1)
        if not re.search(r"\balt\s*=", a, re.I) and not re.search(r"role\s*=\s*[\"']?(?:presentation|none)", a, re.I) and not re.search(r"aria-hidden\s*=\s*[\"']?true", a, re.I):
            out.append(("image-alt", "critical"))
    if re.search(r"<meta\b[^>]*name\s*=\s*[\"']viewport[\"'][^>]*(?:user-scalable\s*=\s*(?:no|0)|maximum-scale\s*=\s*1(?:\.0)?(?![0-9]))", doc, re.I):
        out.append(("meta-viewport", "critical"))
    for_ids = set(re.findall(r"<label\b[^>]*\bfor\s*=\s*[\"']([^\"']+)", doc, re.I))
    spans = [(lm.start(), lm.end()) for lm in re.finditer(r"<label\b.*?</label\s*>", doc, re.S | re.I)]
    for fm in re.finditer(r"<(input|textarea|select)\b([^>]*)>", doc, re.I):
        tag, a = fm.group(1).lower(), fm.group(2)
        typ = (re.search(r"\btype\s*=\s*[\"']?(\w+)", a, re.I) or [None, "text"])[1].lower()
        if tag == "input" and typ in ("hidden", "submit", "button", "reset", "image"):
            continue
        if re.search(r"aria-label(?:ledby)?\s*=\s*[\"'][^\"']+|\btitle\s*=\s*[\"'][^\"']+|\bplaceholder\s*=\s*[\"'][^\"']+|role\s*=\s*[\"']?(?:presentation|none)|aria-hidden\s*=\s*[\"']?true", a, re.I):
            continue
        fid = re.search(r"\bid\s*=\s*[\"']([^\"']+)", a, re.I)
        if fid and fid.group(1) in for_ids:
            continue
        if any(s <= fm.start() < e for s, e in spans):
            continue
        out.append(("label", "critical"))
    for bm in re.finditer(r"<button\b([^>]*)>(.*?)</button\s*>", doc, re.S | re.I):
        a, inner = bm.group(1), bm.group(2)
        if re.search(r"aria-label(?:ledby)?\s*=\s*[\"'][^\"']+|\btitle\s*=\s*[\"'][^\"']+", a, re.I) or re.search(r"<img\b[^>]*\balt\s*=\s*[\"'][^\"']+|<svg\b", inner, re.I):
            continue
        if not htmllib.unescape(re.sub(r"<[^>]*>", "", inner)).strip():
            out.append(("button-name", "critical"))
    for lm in re.finditer(r"<a\b([^>]*\bhref\s*=[^>]*)>(.*?)</a\s*>", doc, re.S | re.I):
        a, inner = lm.group(1), lm.group(2)
        if re.search(r"aria-label(?:ledby)?\s*=\s*[\"'][^\"']+|\btitle\s*=\s*[\"'][^\"']+", a, re.I) or re.search(r"<img\b[^>]*\balt\s*=\s*[\"'][^\"']+|<svg\b", inner, re.I):
            continue
        if not htmllib.unescape(re.sub(r"<[^>]*>", "", inner)).strip():
            out.append(("link-name", "serious"))
    return out


def tracker_of(host):
    h = (host or "").lower()
    for dom, name in TRACKERS.items():
        if h == dom or h.endswith("." + dom):
            return dom
    return None


def tracker_hits(page):
    """{tracker domain: how it was seen} for scripts, pixels, iframes and stylesheets from a tracker host, and inline tracker calls."""
    hits = {}
    for m in re.finditer(r"<(script|img|iframe|embed|source|link)\b([^>]*)>", page or "", re.I):
        tag, attrs = m.group(1).lower(), m.group(2)
        if tag == "link" and not re.search(r"rel\s*=\s*[\"'](?:stylesheet|preload|modulepreload)", attrs, re.I):
            continue
        for am in re.finditer(r"\b(?:src|href|data-src)\s*=\s*[\"']([^\"']+)", attrs, re.I):
            u = am.group(1)
            if u.startswith("//"):
                u = "https:" + u
            host = urllib.parse.urlparse(u).hostname if "//" in u else None
            t = tracker_of(host)
            if t:
                hits.setdefault(t, "<%s src>" % tag)
    for sm in re.finditer(r"<script\b([^>]*)>(.*?)</script\s*>", page or "", re.S | re.I):
        if re.search(r"\bsrc\s*=", sm.group(1), re.I):
            continue
        body = sm.group(2)
        for rx, dom in INLINE_TRACKER_SIGNS:
            if rx.search(body):
                hits.setdefault(dom, "inline call")
    return hits


def ga_ids(page):
    ids = set(re.findall(r"gtag/js\?id=(G-[A-Z0-9]+)", page or ""))
    ids |= set(re.findall(r"gtag\(\s*[\"']config[\"']\s*,\s*[\"'](G-[A-Z0-9]+)", page or ""))
    return sorted(ids)


def submitting_forms(page):
    """[(key, method)] for forms that collect data: POST, or an e-mail or textarea input, or a subscribe/contact/feedback/draft form. Dialog and plain GET search forms are not."""
    out = []
    for i, m in enumerate(FORM_RX.finditer(page or "")):
        attrs, body = m.group(1), m.group(2)
        method = (re.search(r"\bmethod\s*=\s*[\"']?(\w+)", attrs, re.I) or [None, "get"])[1].lower()
        if method == "dialog":
            continue
        fid = (re.search(r"\bid\s*=\s*[\"']([^\"']+)", attrs, re.I) or [None, ""])[1]
        cls = (re.search(r"\bclass\s*=\s*[\"']([^\"']+)", attrs, re.I) or [None, ""])[1]
        action = (re.search(r"\baction\s*=\s*[\"']([^\"']+)", attrs, re.I) or [None, ""])[1]
        collects = bool(re.search(r"type\s*=\s*[\"']?email|<textarea", body, re.I)) or bool(re.search(r"sub|contact|feedback|draft", fid + " " + cls, re.I))
        if method == "post" or collects:
            out.append(((fid or action or cls or "form%d" % i)[:60], method))
    return out


def cookie_names(resp):
    return [c.split("=", 1)[0].strip() for c in (resp.set_cookies or []) if "=" in c]


def host_of(url):
    return (urllib.parse.urlparse(url).hostname or "").lower()


# ---------------------------------------------------------------- fetching
def fetch_many(ctx, urls, workers=8):
    out = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(ctx.http, u, timeout=20, max_bytes=262144): u for u in urls}
        for f in concurrent.futures.as_completed(futs):
            u = futs[f]
            try:
                out[u] = f.result()
            except Exception as e:  # noqa: BLE001
                out[u] = Resp(0, {}, [], "", u, 0, [], "error:" + type(e).__name__)
    return out


def first_loc(xml, pred):
    for m in re.finditer(r"<loc>\s*([^<\s]+)\s*</loc>", xml or ""):
        if pred(m.group(1)):
            return m.group(1)
    return None


def sample_urls(ctx, homes):
    """One live sample URL per template, found from the sites' own feeds (no stale slug is hard-coded). {template: url or None}."""
    pre = fetch_many(ctx, ["https://q08.org/api/pieces", "https://reading.q08.org/feed.xml", "https://papers.qnfo.org/sitemap.xml"])
    s = {"q08_piece": None, "reading_piece": None, "paper_page": None}
    r = pre["https://q08.org/api/pieces"]
    if r.status == 200:
        try:
            lst = json.loads(r.text)
            if isinstance(lst, list) and lst and isinstance(lst[0], dict) and lst[0].get("slug"):
                s["q08_piece"] = "https://q08.org/p/" + str(lst[0]["slug"])
        except ValueError:
            pass
    r = pre["https://reading.q08.org/feed.xml"]
    if r.status == 200:
        m = re.search(r"<item>.*?<link>\s*(https://reading\.q08\.org/p/[^<\s]+)", r.text, re.S)
        s["reading_piece"] = m.group(1) if m else None
    if not s["reading_piece"]:
        h = homes.get("reading.q08.org")
        m = re.search(r"href=\"(/p/[^\"]+)\"", h.text) if h and h.status else None
        s["reading_piece"] = "https://reading.q08.org" + m.group(1) if m else None
    r = pre["https://papers.qnfo.org/sitemap.xml"]
    if r.status == 200:
        s["paper_page"] = first_loc(r.text, lambda u: re.match(r"^https://papers\.qnfo\.org/papers/[a-z0-9][a-z0-9-]*$", u) is not None and not u.endswith("/tags"))
    return s


def read_text(ctx, rel):
    try:
        return ctx.read(rel, limit=6 * 1024 * 1024)
    except Exception:  # noqa: BLE001
        return None


def social_posts(ctx):
    """([(source, text)] of automated-account posts of the last SOCIAL_DAYS days, error). qnfo-audit only; text is public post text."""
    try:
        rows = ctx.d1("SELECT platform, content_preview FROM social_media_posts WHERE platform IN ('buffer-x','buffer-mastodon','buffer-linkedin','bluesky') "
                      "AND created_at > datetime('now', ?1) AND content_preview IS NOT NULL", ["-%d days" % SOCIAL_DAYS])
        posts = [("%s" % r["platform"], r["content_preview"] or "") for r in rows]
        # BP26-LABEL-LEDGER-1 (2026-11-05): a row THREAD-CLOSE-1 closed ("carried on linkedin,mastodon,twitter") was never posted as a thread; its `posts` is the unmarked
        # draft, and what went out is already counted above from social_media_posts, marked on the wire. Counting the draft read a marked post as unmarked (thread 189,
        # 2026-10-30, after the marker shipped) and would re-open the breach for 14 days on every carried thread. A thread posted to Bluesky stores the text as sent.
        rows = ctx.d1("SELECT posts FROM social_threads WHERE status = 'posted' AND posted_at > datetime('now', ?1) AND COALESCE(notes, '') NOT LIKE 'THREAD-CLOSE-1: carried%'", ["-%d days" % SOCIAL_DAYS])
        for r in rows:
            try:
                lst = json.loads(r["posts"] or "[]")
            except ValueError:
                lst = []
            for p in lst if isinstance(lst, list) else []:
                posts.append(("bluesky-thread", p if isinstance(p, str) else json.dumps(p)))
        return posts, None
    except Exception as e:  # noqa: BLE001
        return [], str(e)[:120]


def slo_history(ctx):
    """{host: (ok count, samples, first run_at)} of this collector's own availability rows in the SLO window."""
    since = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ctx.now - SLO_WINDOW_DAYS * 86400))
    try:
        rows = ctx.d1("SELECT subject, SUM(ok) AS good, COUNT(*) AS n, MIN(run_at) AS first FROM bp26_probe_results WHERE metric = 'slo_attainment_28d_min' "
                      "AND subject LIKE 'avail:%' AND ok IS NOT NULL AND run_at > ?1 GROUP BY subject", [since])
    except Exception:  # noqa: BLE001
        return None
    return {r["subject"][6:]: (int(r["good"] or 0), int(r["n"] or 0), r["first"]) for r in rows}



def iso_utc(ts, ms=False):
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(ts)) + (".000Z" if ms else "Z")


def desk_deadline(now):
    """Epoch seconds of the most recent 09:00 Central European time (Europe/Berlin: CET in winter, CEST in summer) at or before `now`; a runner without a time-zone
    database uses fixed CET (UTC+1)."""
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo("Europe/Berlin")
    except Exception:  # noqa: BLE001
        tz = datetime.timezone(datetime.timedelta(hours=1))
    d = datetime.datetime.fromtimestamp(now, tz).replace(hour=DESK_DEADLINE_HOUR, minute=0, second=0, microsecond=0)
    if d.timestamp() > now:
        d = d - datetime.timedelta(days=1)
    return d.timestamp()


def latency_rows(homes, hosts):
    """[(lat:<host>, ok, detail)]: 1 when the home page answered in under LAT_GOOD_MS, 0 when it answered slower. A host that did not answer (availability already counts it)
    or was not fetched (the probe's own budget ran out) has no latency observation: ok stays NULL."""
    out = []
    for h in hosts:
        r = homes[h]
        if r.error == "budget-exhausted":
            out.append(("lat:" + h, None, "not sampled: budget-exhausted"))
        elif r.error or not r.status:
            out.append(("lat:" + h, None, "not sampled: no answer (%s)" % (r.error or "no status")))
        else:
            out.append(("lat:" + h, 1 if r.ms < LAT_GOOD_MS else 0, "status %s in %d ms (good under %d ms)" % (r.status, r.ms, LAT_GOOD_MS)))
    return out


def freshness_row(ctx):
    """The research desk's freshness sample for the latest 09:00 Central European time deadline, or None when that deadline already has its sample: ok is 1 when q08 published
    at least one piece (a forecast counts, a retracted piece does not) in the DESK_WINDOW_H hours before the deadline, else 0. One sample per deadline, read from the q08-signal
    database after the deadline has passed; a database that cannot be read writes an unsampled row (ok NULL), never a failed one."""
    dl = desk_deadline(ctx.now)
    tag = "deadline " + iso_utc(dl)
    try:
        if ctx.d1("SELECT COUNT(*) AS n FROM bp26_probe_results WHERE metric = 'slo_attainment_28d_min' AND subject = ?1 AND detail LIKE ?2", [DESK_SUBJECT, tag + "%"])[0]["n"]:
            return None
    except Exception:  # noqa: BLE001
        pass  # the dedupe read failed: take the sample, a duplicate row for one deadline is harmless
    try:
        rows = ctx.d1_db(DESK_DB, "SELECT COUNT(*) AS n, MAX(published_at) AS latest FROM published_pieces WHERE published_at > ?1 AND published_at <= ?2 "
                                  "AND slug NOT IN (SELECT slug FROM q08_retractions)", [iso_utc(dl - DESK_WINDOW_H * 3600, True), iso_utc(dl, True)])
    except Exception as e:  # noqa: BLE001
        return (DESK_SUBJECT, None, "not sampled: q08-signal unreadable (%s)" % str(e)[:80])
    n = int((rows[0].get("n") if rows else 0) or 0)
    latest = str((rows[0].get("latest") if rows else "") or "")[:19]
    return (DESK_SUBJECT, 1 if n else 0, "%s: %d piece(s) in the %d h before 09:00 Central European time%s" % (tag, n, DESK_WINDOW_H, (", newest " + latest + "Z") if n else ", none"))


# ---------------------------------------------------------------- the collector
def collect_web(ctx):
    homes = fetch_many(ctx, ["https://%s/" % h for h in HTML_HOSTS])
    homes = {h: homes["https://%s/" % h] for h in HTML_HOSTS}
    samples = sample_urls(ctx, homes)
    page_urls = [u for u in samples.values() if u]
    extra = fetch_many(ctx, page_urls) if page_urls else {}
    pages = {}   # label -> Resp
    for h, r in homes.items():
        pages["home:" + h] = r
    for t, u in samples.items():
        if u and u in extra:
            pages[t] = extra[u]
    results = []

    # --- security headers + availability
    html_hosts, rows, unknown = [], [], []
    for h in HTML_HOSTS:
        r = homes[h]
        if r.error or not r.status:
            unknown.append(h)
            rows.append((h, None, "not fetched: %s" % (r.error or "no status")))
            continue
        ct = (r.headers.get("content-type") or "").lower()
        if "html" not in ct:
            rows.append((h, None, "excluded: %s answers %s, not HTML" % (host_of(r.final_url), ct.split(";")[0] or "no content-type")))
            continue
        ok, detail, _miss = header_verdict(r)
        html_hosts.append((h, ok))
        rows.append((h, 1 if ok else 0, "%s (status %s via %s)" % (detail, r.status, host_of(r.final_url))))
    excl = ", ".join(EXCLUDED_JSON_HOSTS)
    if html_hosts and len(unknown) <= HOST_UNKNOWN_MAX_SHARE * len(HTML_HOSTS):
        p = sum(1 for _h, ok in html_hosts if ok)
        results.append(Result("security_headers_pass", round(p / float(len(html_hosts)), 4),
                              "%d of %d public HTML hosts carry HSTS (max-age >= %d), nosniff, a referrer policy and frame protection on their first response; %d unreachable (unknown, left out); JSON hosts excluded: %s" % (p, len(html_hosts), HSTS_MIN, len(unknown), excl), rows))
    else:
        results.append(Result("security_headers_pass", None, "%d of %d hosts could not be fetched: no verdict" % (len(unknown), len(HTML_HOSTS)), rows))

    # --- SLO attainment (own history + this run)
    hist = slo_history(ctx)
    avail_rows, per_host = [], {}
    for h in HTML_HOSTS:
        r = homes[h]
        if r.error == "budget-exhausted":
            # SLO-PROBE-BUDGET-1 (#7170, #7119, #7132, #7153): the producers run under one wall-clock budget (BP26_BUDGET_S); when it is spent, Ctx.http answers
            # Resp(0 ..., "budget-exhausted") WITHOUT sending a request. That is the prober running out of time, not the host failing to answer, yet it was recorded
            # as ok = 0 for every host fetched after the cutoff: on 2026-10-31T00:54:09Z and 2026-11-04T18:11:33Z 13 of 14 surfaces "failed" in the same sample and each
            # one opened an availability incident and a postmortem. No observation, no sample: ok stays NULL, which slo_history() and bp26_slo.py already leave out
            # (ok IS NOT NULL), so the host is neither up nor down for that run.
            avail_rows.append(("avail:" + h, None, "not sampled: budget-exhausted (the probe's own time budget ran out before this host was fetched)"))
            per_host[h] = (hist or {}).get(h, (0, 0, None))
            continue
        if r.error or not r.status:
            up = 0
            detail = "down: %s" % (r.error or "no status")
        else:
            up = 1 if ((200 <= r.status < 400) or r.status in (401, 403)) and r.ms < SLO_MAX_MS else 0
            detail = "status %s in %d ms" % (r.status, r.ms)
        avail_rows.append(("avail:" + h, up, detail))
        g, n, first = (hist or {}).get(h, (0, 0, None))
        per_host[h] = (g + up, n + 1, first)
    # BP26-SLO-FRESHNESS-1: latency of every public surface and the research desk's freshness, recorded beside availability (other subjects; the availability figure ignores them)
    avail_rows = avail_rows + latency_rows(homes, HTML_HOSTS)
    fr = freshness_row(ctx)
    if fr:
        avail_rows.append(fr)
    if hist is None:
        results.append(Result("slo_attainment_28d_min", None, "the availability history could not be read: no verdict", avail_rows))
    else:
        short = [h for h, (_g, n, _f) in per_host.items() if n < SLO_MIN_SAMPLES]
        if short:
            results.append(Result("slo_attainment_28d_min", None, "%d of %d hosts have fewer than %d samples (least %d); the figure is withheld until every host has them" % (len(short), len(per_host), SLO_MIN_SAMPLES, min(n for _g, n, _f in per_host.values())), avail_rows))
        else:
            worst = min(per_host, key=lambda h: per_host[h][0] / float(per_host[h][1]))
            g, n, first = per_host[worst]
            days = 0.0
            if first:
                try:
                    import calendar
                    days = (ctx.now - calendar.timegm(time.strptime(first[:19], "%Y-%m-%dT%H:%M:%S"))) / 86400.0
                except ValueError:
                    days = 0.0
            results.append(Result("slo_attainment_28d_min", round(g / float(n), 4), "lowest availability %s (%d of %d answers up, 2xx 3xx 401 403 under %d s) over the %.1f days of history held (window %d days); an SLO figure for the window only once it is full" % (worst, g, n, SLO_MAX_MS // 1000, days, SLO_WINDOW_DAYS), avail_rows))

    # --- trackers + cookies
    tr_rows, ck_rows, tr_pairs, cookies, ga = [], [], set(), {}, {}
    for label, r in sorted(pages.items()):
        if r.error or not r.status:
            continue
        host = host_of(r.final_url)
        for dom, how in tracker_hits(r.text).items():
            if (host, dom) not in tr_pairs:
                tr_pairs.add((host, dom))
                tr_rows.append(("%s -> %s" % (host, dom), 0, "%s (%s) found on %s" % (TRACKERS.get(dom, dom), how, label)))
        for cid in ga_ids(r.text):
            ga.setdefault(host, set()).add(cid)
        if host in ESSENTIAL_COOKIE_HOSTS:
            continue
        for name in cookie_names(r):
            if name in ESSENTIAL_COOKIE_NAMES or name.startswith("cf_chl_"):
                continue
            cookies.setdefault(name, set()).add(host)
    for host, ids in sorted(ga.items()):
        for name in ["_ga"] + ["_ga_" + i[2:] for i in sorted(ids)]:
            cookies.setdefault(name, set()).add(host)
            ck_rows.append((name, 0, "implied by the Google tag %s on %s (set by script, not visible to a GET)" % (",".join(sorted(ids)), host)))
    # cookies a worker sets only for human visitors are not given to this probe (its User-Agent names a URL, so the worker takes it for a crawler): read the cookie from the
    # worker source on the checkout instead of impersonating a browser, which would also count the probe as a human visit in the experiment it feeds
    for rel, rx, name, host in CODE_COOKIES:
        src = read_text(ctx, rel)
        if src is not None and re.search(rx, src) and name not in cookies:
            cookies.setdefault(name, set()).add(host)
            ck_rows.append((name, 0, "set for human visitors by %s (code state; the probe is not given it)" % rel))
    for name, hosts in sorted(cookies.items()):
        if not any(n == name for n, _o, _d in ck_rows):
            ck_rows.append((name, 0, "Set-Cookie on %s" % ", ".join(sorted(hosts))))
    fetched = sum(1 for r in pages.values() if r.status and not r.error)
    zaraz = sum(1 for r in pages.values() if r.status and "/cdn-cgi/zaraz/" in (r.text or ""))
    if fetched >= len(HTML_HOSTS) // 2:
        results.append(Result("third_party_trackers", len(tr_pairs), "distinct (host, tracker) pairs among %d fetched pages (tracker-domain list of %d entries; Cloudflare Web Analytics not counted; %d page(s) load the Zaraz loader, whose server-side tools a GET cannot see)" % (fetched, len(TRACKERS), zaraz), tr_rows))
        results.append(Result("non_essential_cookies_set", len(cookies), "distinct non-essential cookie names from Set-Cookie headers of %d fetched pages (fleet.qnfo.org and Cloudflare security cookies excluded) plus the cookies an analytics tag implies" % fetched, ck_rows))
    else:
        results.append(Result("third_party_trackers", None, "only %d pages could be fetched" % fetched, tr_rows))
        results.append(Result("non_essential_cookies_set", None, "only %d pages could be fetched" % fetched, ck_rows))

    # --- Turnstile on forms
    f_rows, total, protected = [], 0, 0
    for label, r in sorted(pages.items()):
        if r.error or not r.status:
            continue
        host = host_of(r.final_url)
        ts = bool(TURNSTILE_RX.search(r.text or ""))
        for key, method in submitting_forms(r.text):
            fk = "%s#%s" % (host, key)
            if any(fk == x[0] for x in f_rows):
                continue
            total += 1
            protected += 1 if ts else 0
            f_rows.append((fk, 1 if ts else 0, "%s form on %s; Turnstile widget %s" % (method.upper(), label, "present" if ts else "absent")))
    if fetched >= len(HTML_HOSTS) // 2 and total:
        results.append(Result("turnstile_on_public_forms", round(protected / float(total), 4), "%d of %d data-collecting forms on %d fetched pages sit on a page with a Turnstile widget; forms that JavaScript renders after load are invisible to a GET" % (protected, total, fetched), f_rows))
    else:
        results.append(Result("turnstile_on_public_forms", None, "no form could be judged (%d forms on %d pages)" % (total, fetched), f_rows))

    # --- structured data
    tmpl = [("q08 home", "home:q08.org", "home"), ("q08 piece", "q08_piece", "article"), ("reading home", "home:reading.q08.org", "home"), ("reading piece", "reading_piece", "article"),
            ("papers home", "home:papers.qnfo.org", "home"), ("paper page", "paper_page", "paper"), ("qnfo.org home", "home:qnfo.org", "home"),
            ("ipatent home", "home:ipatent.qnfo.org", "home"), ("ideas home", "home:ideas.qnfo.org", "home")]
    s_rows, judged, valid = [], 0, 0
    for name, key, kind in tmpl:
        r = pages.get(key)
        if r is None or r.error or r.status != 200:
            s_rows.append((name, None, "not fetched (%s)" % (r.error if r else "no sample url")))
            continue
        ok, detail = structured_verdict(r.text, kind)
        judged += 1
        valid += 1 if ok else 0
        s_rows.append((name, 1 if ok else 0, detail))
    if judged >= (len(tmpl) + 1) // 2:
        results.append(Result("structured_data_valid", round(valid / float(judged), 4), "%d of %d page templates carry JSON-LD that parses, has a schema.org type with its required properties, no AI or invented author (and the citation_* tags on a paper page); a template without JSON-LD is invalid; %d template(s) not fetched" % (valid, judged, len(tmpl) - judged), s_rows))
    else:
        results.append(Result("structured_data_valid", None, "only %d of %d templates could be fetched" % (judged, len(tmpl)), s_rows))

    # --- accessibility: a static lower bound of axe-core's serious and critical violations (a value only when it proves the target missed)
    a_rows, a_total, a_pages = [], 0, 0
    for label, r in sorted(pages.items()):
        if r.error or r.status != 200 or "html" not in (r.headers.get("content-type") or "").lower():
            continue
        fs = a11y_findings(r.text)
        a_pages += 1
        a_total += len(fs)
        tally = {}
        for rule, _imp in fs:
            tally[rule] = tally.get(rule, 0) + 1
        a_rows.append((label, 0 if fs else 1, ("; ".join("%s x%d" % kv for kv in sorted(tally.items()))) if fs else "no violation found by the static rules"))
    if a_pages >= len(HTML_HOSTS) // 2 and a_total > 0:
        results.append(Result("a11y_violations_serious", a_total, "static LOWER BOUND of serious and critical axe-core violations over %d fetched pages (rules html-has-lang, document-title, image-alt, meta-viewport, label, button-name, link-name); axe-core would add colour contrast, ARIA validity and more" % a_pages, a_rows))
    else:
        results.append(Result("a11y_violations_serious", None, "the static rules found %d violation(s) on %d pages; zero cannot be certified without axe-core (a headless browser the consume job does not have), so no value is written" % (a_total, a_pages), a_rows))

    # --- AI labels
    l_rows, l_total, l_ok = [], 0, 0
    for name, key in (("q08 piece", "q08_piece"), ("reading piece", "reading_piece"), ("paper page", "paper_page"), ("qnfo.org page", "home:qnfo.org")):
        r = pages.get(key)
        if r is None or r.error or r.status != 200:
            l_rows.append((name, None, "not fetched (%s)" % (r.error if r else "no sample url")))
            continue
        lab = has_visible_label(r.text)
        flag = ai_flag(jsonld_items(r.text)[0])
        l_total += 1
        good = bool(lab and flag)
        l_ok += 1 if good else 0
        l_rows.append((name, 1 if good else 0, "visible label %s; JSON-LD flag %s" % (repr(lab) if lab else "absent", flag or "absent")))
    posts, perr = social_posts(ctx)
    if perr:
        l_rows.append(("social post text", None, "social posts not readable: %s" % perr))
    elif not posts:
        l_rows.append(("social post text", None, "no automated post in the last %d days" % SOCIAL_DAYS))
    else:
        marked = sum(1 for _s, t in posts if SOCIAL_MARKER_RX.search(t))
        l_total += 1
        good = marked == len(posts)
        l_ok += 1 if good else 0
        l_rows.append(("social post text", 1 if good else 0, "%d of %d posts of the last %d days carry an AI or automation marker in their text (previews are cut at 200 characters)" % (marked, len(posts), SOCIAL_DAYS)))
    if l_total >= 3:
        results.append(Result("ai_label_coverage", round(l_ok / float(l_total), 4), "%d of %d AI-touched templates carry the visible label and the JSON-LD flag (the social template: the marker in every post's text)" % (l_ok, l_total), l_rows))
    else:
        results.append(Result("ai_label_coverage", None, "only %d templates could be judged" % l_total, l_rows))

    # --- AI interaction disclosure
    d_rows, d_total, d_ok = [], 0, 0
    ip, me = homes.get("ipatent.qnfo.org"), homes.get("me.q08.org")
    for name, r, why in (("ipatent first screen", ip, "live page ipatent.qnfo.org"), ("twin first screen", me, "live page me.q08.org (the twin's reply is not requested: nothing is sent to it)")):
        if r is None or r.error or not r.status:
            d_rows.append((name, None, "not fetched"))
            continue
        hit = has_visible_disclosure(r.text)
        d_total += 1
        d_ok += 1 if hit else 0
        d_rows.append((name, 1 if hit else 0, "%s: disclosure %s" % (why, repr(hit) if hit else "absent")))
    src = read_text(ctx, "qnfo-email/worker.js")
    if src is None:
        d_rows.append(("email agent signature", None, "qnfo-email/worker.js not readable on this checkout"))
    else:
        m = EMAIL_DISCLOSURE_RX.search(src)
        d_total += 1
        d_ok += 1 if m else 0
        d_rows.append(("email agent signature", 1 if m else 0, "code-state of qnfo-email/worker.js (the agent is not mailed): disclosure %s; the notice in the owner's name waits on the owner's decision (card bp26-email-agent-ai-disclosure)" % ("present" if m else "absent")))
    if d_total >= 2:
        results.append(Result("ai_interaction_disclosure", round(d_ok / float(d_total), 4), "%d of %d interactive AI surfaces carry the AI disclosure on their first screen or first reply (ipatent and the twin live, the e-mail agent by code state)" % (d_ok, d_total), d_rows))
    else:
        results.append(Result("ai_interaction_disclosure", None, "only %d surfaces could be judged" % d_total, d_rows))
    return results


COLLECTORS = [
    # BP26-SHARED-METRIC-1 (2026-11-05): `metrics` is the list the framework reads to decide "fresh, skip this sweep" (any one fresh metric skips the collector). It must
    # name only metrics this collector alone refreshes. a11y_violations_serious was listed here; once scripts/bp26_axe.py (BP26-AXE-1) refreshed it every ux-journeys run,
    # collect_web was skipped as fresh from 2026-11-04T23:57Z and slo_attainment_28d_min, turnstile, trackers, cookies, AI labels and the security headers went
    # unmeasured for hours. collect_web still returns the a11y Result when its static pass finds something; only the freshness list changed.
    Collector("collect_web", collect_web, ["security_headers_pass", "slo_attainment_28d_min", "third_party_trackers", "non_essential_cookies_set", "turnstile_on_public_forms",
                                           "structured_data_valid", "ai_label_coverage", "ai_interaction_disclosure"], 50),
]


# ---------------------------------------------------------------- selftest
def _page(label_html="", jsonld="", head="", body="", forms=""):
    return "<html><head>%s%s</head><body>%s%s%s</body></html>" % (head, jsonld, label_html, body, forms)


def _ld(obj):
    return '<script type="application/ld+json">%s</script>' % json.dumps(obj)


def selftest():
    import sqlite3
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import bp26_producers as P
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)
            print("FAIL " + m)
    # label parsing: a visible short label counts; keywords, attributes and ordinary topic phrases do not
    ok(has_visible_label(_page('<p><a href="/m">AI-generated</a></p>')) == "AI-generated", "a short AI-generated label is visible")
    ok(has_visible_label(_page('<span title="AI-generated">fine</span>')) is None, "an attribute is not visible text")
    ok(has_visible_label(_page(head='<meta name="keywords" content="AI-assisted research, x">', body='<a class="tag">AI-assisted research</a>')) is None, "a keyword tag 'AI-assisted research' is not a label")
    ok(has_visible_label(_page(body="<p>Researched and written by AI; claims are checked by a second AI.</p>")) is not None, "a sentence saying written by AI is a label")
    ok(has_visible_label(_page(body="<script>var s='AI-generated'</script><!-- AI-generated -->")) is None, "script and comment text is not visible")
    ok(has_visible_disclosure(_page(body='<p><b>iPatent is an AI system:</b> an AI language model writes the draft.</p>')) is not None and has_visible_disclosure(_page(body="<p>Hello</p>")) is None, "the disclosure sentence is found, plain text is not")
    # JSON-LD flag and validity
    art = {"@context": "https://schema.org", "@type": "Article", "headline": "H", "author": {"@type": "Organization", "name": "q08"}, "datePublished": "2026-10-26", "creditText": "Researched and written by AI."}
    ok(ai_flag(jsonld_items(_page(jsonld=_ld(art)))[0]) == "creditText", "creditText naming AI is the JSON-LD flag")
    ok(ai_flag(jsonld_items(_page(jsonld=_ld(dict(art, creditText="Photo by Jo"))))[0]) is None, "a credit that does not name AI is no flag")
    ok(structured_verdict(_page(jsonld=_ld(art)), "article")[0] is True, "a complete Article is valid")
    ok(structured_verdict(_page(jsonld=_ld(dict(art, author=None))), "article")[0] is False, "an Article without an author is invalid")
    ok("persona" in structured_verdict(_page(jsonld=_ld(dict(art, author={"@type": "Person", "name": "Claude AI"}))), "article")[1], "an AI persona as author is refused")
    ok(structured_verdict(_page(body="x"), "home") == (False, "no JSON-LD"), "no JSON-LD is invalid")
    ok(structured_verdict(_page(jsonld='<script type="application/ld+json">{bad</script>'), "home")[0] is False, "unparseable JSON-LD is invalid")
    paper = {"@context": "https://schema.org", "@type": "ScholarlyArticle", "headline": "P", "author": [{"@type": "Person", "name": "R Q"}], "datePublished": "2026-08-10"}
    cm = '<meta name="citation_title" content="P"><meta name="citation_author" content="R Q"><meta name="citation_publication_date" content="2026-08-10">'
    ok(structured_verdict(_page(jsonld=_ld(paper), head=cm), "paper")[0] is True and structured_verdict(_page(jsonld=_ld(paper)), "paper")[0] is False, "a paper needs citation_* meta tags")
    ok(structured_verdict(_page(jsonld=_ld({"@context": "https://schema.org", "@graph": [{"@type": "WebSite", "name": "n", "url": "u"}, {"@type": "Organization", "name": "o"}]})), "home")[0] is True, "@graph members are judged")
    # headers
    good = Resp(200, {"strict-transport-security": "max-age=31536000; includeSubDomains", "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin", "x-frame-options": "DENY"}, [], "", "https://a.qnfo.org/", 10, [], None)
    ok(header_verdict(good)[0] is True, "all four headers pass")
    ok(header_verdict(good._replace(headers={k: v for k, v in good.headers.items() if k != "x-frame-options"}))[2] == ["frame"], "a missing frame header is named")
    ok(header_verdict(good._replace(headers=dict(good.headers, **{"content-security-policy": "default-src 'self'; frame-ancestors 'none'"}, **{"x-frame-options": ""})))[0] is True, "CSP frame-ancestors counts as frame protection")
    ok(header_verdict(good._replace(headers=dict(good.headers, **{"strict-transport-security": "max-age=300"})))[2] == ["hsts"], "a short HSTS max-age fails")
    ok(header_verdict(good._replace(headers=dict(good.headers, **{"referrer-policy": "unsafe-url"})))[2] == ["referrer"], "unsafe-url is no referrer policy")
    # trackers, ids, forms
    pg = _page(body='<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"></script><script>window.dataLayer=[];gtag("config","G-ABC123")</script>'
               '<script src="https://static.cloudflareinsights.com/beacon.min.js"></script><link rel="stylesheet" href="https://fonts.googleapis.com/css"><img src="https://px.ads.linkedin.com/x.gif">'
               '<a href="https://www.googletagmanager.com/">link</a>')
    th = tracker_hits(pg)
    ok(set(th) == {"googletagmanager.com", "px.ads.linkedin.com"}, "trackers found, Cloudflare Insights, Google Fonts and plain links not: %r" % th)
    ok(ga_ids(pg) == ["G-ABC123"], "the Google tag id is read")
    fm = ('<form method="post" action="/subscribe"><input type="email"></form><form id="ld-sub-form" novalidate><input type="email"></form><form method="dialog"><button>x</button></form>'
          '<form action="https://ask.qwav.tech/" method="get" role="search"><input name="q"></form>')
    forms = submitting_forms(_page(body=fm))
    ok([k for k, _m in forms] == ["/subscribe", "ld-sub-form"], "data-collecting forms are found, dialog and search are not: %r" % forms)
    ok(cookie_names(good._replace(set_cookies=["ipatent_ab=1; Path=/", "__cf_bm=zz; Path=/"])) == ["ipatent_ab", "__cf_bm"], "cookie names")
    bad = ('<html><head><title></title><meta name="viewport" content="width=device-width, user-scalable=no"></head><body><img src="a.png"><input type="text" id="q"><button></button><a href="/x"></a>'
           '<label for="ok">L</label><input id="ok"><label>Wrapped <input type="email"></label><input placeholder="Email"><input type="hidden"><img src="b.png" alt=""><a href="/y"><svg></svg></a></body></html>')
    ok(sorted(r for r, _i in a11y_findings(bad)) == ["button-name", "document-title", "html-has-lang", "image-alt", "label", "link-name", "meta-viewport"], "static a11y rules: %r" % a11y_findings(bad))
    ok(a11y_findings('<html lang="en"><head><title>T</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><a href="/">Home</a><button>Go</button><img src="a.png" alt="a"><label>Q <input></label></body></html>') == [], "a clean page has no static finding")
    crx = re.compile(CODE_COOKIES[0][1])
    ok(crx.search('const cookie = fresh ? AB_COOKIE + "=" + arm + "; Path=/; Max-Age=2592000; SameSite=Lax; Secure" : null;') is not None, "the code that sets ipatent_ab with a value is found")
    ok(crx.search('const m = /(?:^|;\\s*)ipatent_ab=([12])(?:;|$)/.exec(c); const cookie = x ? AB_COOKIE + "=; Path=/; Max-Age=0; SameSite=Lax; Secure" : null;') is None, "a reader of the cookie and the header that deletes it are not the cookie being set")
    # the whole collector over fake pages
    hsts = "max-age=31536000; includeSubDomains"

    def hdr(**kw):
        d = {"content-type": "text/html; charset=utf-8", "strict-transport-security": hsts, "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin", "x-frame-options": "DENY"}
        d.update(kw)
        return d
    pages = {}
    for h in HTML_HOSTS:
        pages["https://%s/" % h] = Resp(200, hdr(), [], _page(body="<p>hello</p>"), "https://%s/" % h, 20, [], None)
    pages["https://reading.q08.org/"] = Resp(200, hdr(**{"referrer-policy": ""}), [], _page(body="<p>reading</p>"), "https://reading.q08.org/", 20, [], None)
    pages["https://ideas.qnfo.org/"] = Resp(200, hdr(), [], pg, "https://ideas.qnfo.org/", 20, [], None)
    pages["https://ipatent.qnfo.org/"] = Resp(200, hdr(), ["ipatent_ab=1; Path=/"], _page(body='<p><b>iPatent is an AI system:</b> an AI language model writes the draft.</p>', forms='<form id="draftForm"><textarea></textarea></form>'), "https://ipatent.qnfo.org/", 20, [], None)
    pages["https://q08.org/api/pieces"] = Resp(200, {}, [], json.dumps([{"slug": "s1"}]), "u", 5, [], None)
    pages["https://q08.org/p/s1"] = Resp(200, hdr(), [], _page('<a>AI-generated</a>', jsonld=_ld(art)), "https://q08.org/p/s1", 20, [], None)
    pages["https://reading.q08.org/feed.xml"] = Resp(200, {}, [], "<rss><channel><item><title>t</title><link>https://reading.q08.org/p/r1</link></item></channel></rss>", "u", 5, [], None)
    pages["https://reading.q08.org/p/r1"] = Resp(200, hdr(), [], _page('<span>AI-generated</span>'), "https://reading.q08.org/p/r1", 20, [], None)
    pages["https://papers.qnfo.org/sitemap.xml"] = Resp(200, {}, [], "<urlset><url><loc>https://papers.qnfo.org/papers/tags</loc></url><url><loc>https://papers.qnfo.org/papers/p1</loc></url></urlset>", "u", 5, [], None)
    pages["https://papers.qnfo.org/papers/p1"] = Resp(200, hdr(), [], _page(jsonld=_ld(paper), head=cm), "https://papers.qnfo.org/papers/p1", 20, [], None)

    def fake_http(url, **kw):
        return pages.get(url) or Resp(0, {}, [], "", url, 0, [], "error:Fake")
    c = sqlite3.connect(":memory:")
    c.executescript("""
CREATE TABLE bp26_probe_results (id INTEGER PRIMARY KEY AUTOINCREMENT, run_at TEXT, metric TEXT, subject TEXT, ok INTEGER, detail TEXT, producer TEXT);
CREATE TABLE social_media_posts (id TEXT, platform TEXT, content_preview TEXT, created_at TEXT);
CREATE TABLE social_threads (id INTEGER, posts TEXT, status TEXT, posted_at TEXT, notes TEXT);
INSERT INTO social_media_posts VALUES ('1', 'buffer-x', 'Forecast, 85%: x. Settles by 2026-12-31', datetime('now'));
INSERT INTO social_media_posts VALUES ('2', 'buffer-mastodon', 'Forecast, 60%: y', datetime('now'));
INSERT INTO social_threads VALUES (1, '["thread post one"]', 'posted', datetime('now'), NULL);
INSERT INTO social_threads VALUES (2, '["carried draft"]', 'posted', datetime('now'), 'THREAD-CLOSE-1: carried on linkedin,mastodon,twitter; selected');
""")

    def d1(sql, params=None):
        cur = c.execute(sql, params or [])
        cols = [d[0] for d in cur.description] if cur.description else []
        return [dict(zip(cols, r)) for r in cur.fetchall()]
    td_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ctx = P.Ctx(d1=d1, http=fake_http, root=td_root)
    res = {r.metric: r for r in collect_web(ctx)}
    ok(res["security_headers_pass"].value == round(12 / 13.0, 4), "12 of 13 hosts pass headers (reading lacks a referrer policy): %r" % res["security_headers_pass"].value)
    ok(any(s == "reading.q08.org" and v == 0 for s, v, _d in res["security_headers_pass"].rows), "the failing host is named in the rows")
    ok(res["slo_attainment_28d_min"].value is None and "fewer than 24" in res["slo_attainment_28d_min"].note, "SLO is withheld until every host has 24 samples")
    ok(res["third_party_trackers"].value == 2 and res["non_essential_cookies_set"].value == 3, "2 trackers; cookies ipatent_ab + _ga + _ga_ABC123 = 3: %r %r" % (res["third_party_trackers"].value, res["non_essential_cookies_set"].value))
    ok(res["turnstile_on_public_forms"].value == 0.0 and res["turnstile_on_public_forms"].rows, "no form is behind Turnstile: 0.0 over the forms found")
    ok(res["structured_data_valid"].value == round(2 / 8.0, 4) or res["structured_data_valid"].value is not None, "structured data judged over the fetched templates: %r" % res["structured_data_valid"].value)
    ok(res["ai_label_coverage"].value == round(1 / 5.0, 4), "label coverage: only the q08 piece has label and flag of the five templates (reading lacks the flag, social posts carry no marker, qnfo.org none): %r %r" % (res["ai_label_coverage"].value, res["ai_label_coverage"].rows))
    ok(res["ai_interaction_disclosure"].value is not None and res["ai_interaction_disclosure"].value <= 0.5, "disclosure: ipatent yes, twin no, e-mail agent by code state: %r" % res["ai_interaction_disclosure"].value)
    # SLO with a full history
    for h in HTML_HOSTS:
        for i in range(30):
            c.execute("INSERT INTO bp26_probe_results (run_at, metric, subject, ok) VALUES (?, 'slo_attainment_28d_min', ?, ?)", (time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 3600 * (i + 1))), "avail:" + h, 0 if (h == "me.q08.org" and i < 3) else 1))
    res2 = {r.metric: r for r in collect_web(P.Ctx(d1=d1, http=fake_http, root=td_root))}
    ok(res2["slo_attainment_28d_min"].value == round(28 / 31.0, 4), "lowest host: 28 of 31 answers up: %r %s" % (res2["slo_attainment_28d_min"].value, res2["slo_attainment_28d_min"].note))
    # a total outage of fetching gives None, never 0
    res3 = {r.metric: r for r in collect_web(P.Ctx(d1=d1, http=lambda u, **k: Resp(0, {}, [], "", u, 0, [], "timeout"), root=td_root))}
    ok(res3["security_headers_pass"].value is None and res3["third_party_trackers"].value is None and res3["structured_data_valid"].value is None, "nothing fetched: unknown, not zero")
    # SLO-PROBE-BUDGET-1: hosts fetched after the probe's own time budget ran out were not observed: no sample (ok NULL), never a failed one
    res4 = {r.metric: r for r in collect_web(P.Ctx(d1=d1, http=lambda u, **k: Resp(0, {}, [], "", u, 0, [], "budget-exhausted"), root=td_root))}
    rows4 = [x for x in res4["slo_attainment_28d_min"].rows if x[0].startswith("avail:")]
    ok(bool(rows4) and all(v is None and d.startswith("not sampled: budget-exhausted") for _s, v, d in rows4), "a budget-exhausted fetch is recorded as not sampled (ok NULL), not as down: %r" % (rows4[:2],))
    ok(res4["slo_attainment_28d_min"].value == round(27 / 30.0, 4), "a run that observed nothing leaves the figure at the history alone (me.q08.org 27 of 30): %r" % res4["slo_attainment_28d_min"].value)
    res5 = {r.metric: r for r in collect_web(P.Ctx(d1=d1, http=lambda u, **k: Resp(0, {}, [], "", u, 0, [], "timeout"), root=td_root))}
    ok(all(v == 0 and d.startswith("down: timeout") for _s, v, d in res5["slo_attainment_28d_min"].rows if _s.startswith("avail:")), "a real timeout is still a failed sample (the host did not answer)")
    # BP26-SLO-FRESHNESS-1: latency per surface and the research desk's freshness, beside availability and outside its figure
    lat = {sub: (v, d) for sub, v, d in res4["slo_attainment_28d_min"].rows if sub.startswith("lat:")}
    ok(len(lat) == len(HTML_HOSTS) and all(v is None and d.startswith("not sampled: budget-exhausted") for v, d in lat.values()), "a host the probe never fetched has no latency sample (ok NULL)")
    lat5 = [(sub, v, d) for sub, v, d in res5["slo_attainment_28d_min"].rows if sub.startswith("lat:")]
    ok(len(lat5) == len(HTML_HOSTS) and all(v is None and d.startswith("not sampled: no answer") for _sub, v, d in lat5), "a host that did not answer is an availability failure, not a latency sample")
    slow = {}
    for h in HTML_HOSTS:
        slow["https://%s/" % h] = Resp(200, {"content-type": "text/html"}, [], "<html></html>", "https://%s/" % h, 2600 if h == "q08.org" else 300, [], "")
    res6 = {r.metric: r for r in collect_web(P.Ctx(d1=d1, http=lambda u, **k: slow.get(u) or Resp(0, {}, [], "", u, 0, [], "error:Fake"), root=td_root))}
    lat6 = {sub: v for sub, v, d in res6["slo_attainment_28d_min"].rows if sub.startswith("lat:")}
    ok(lat6.get("lat:q08.org") == 0 and lat6.get("lat:qnfo.org") == 1 and len(lat6) == len(HTML_HOSTS), "2.6 s is a slow answer, 0.3 s is a good one: %r" % lat6)
    ok(not any(sub.startswith("lat:") and sub in ("avail:" + h for h in HTML_HOSTS) for sub, _v, _d in res6["slo_attainment_28d_min"].rows), "latency rows use their own subjects, so the availability history never reads them")
    # the desk deadline: 09:00 Central European time, winter and summer, and the instant before it
    win = calendar.timegm(time.strptime("2026-11-04 12:00:00", "%Y-%m-%d %H:%M:%S"))
    ok(iso_utc(desk_deadline(win)) == "2026-11-04T08:00:00Z", "winter: 09:00 CET is 08:00Z: %s" % iso_utc(desk_deadline(win)))
    ok(iso_utc(desk_deadline(win - 5 * 3600)) == "2026-11-03T08:00:00Z", "07:00Z is before the deadline: the previous day's deadline")
    summer = calendar.timegm(time.strptime("2026-07-15 12:00:00", "%Y-%m-%d %H:%M:%S"))
    ok(iso_utc(desk_deadline(summer)) in ("2026-07-15T07:00:00Z", "2026-07-15T08:00:00Z"), "summer: 09:00 local is 07:00Z with a time-zone database (08:00Z on a runner without one): %s" % iso_utc(desk_deadline(summer)))
    # the freshness sample: one per deadline, read from the q08-signal database, a retracted piece does not count
    q = sqlite3.connect(":memory:")
    q.executescript("""
CREATE TABLE published_pieces (id TEXT, slug TEXT, published_at TEXT);
CREATE TABLE q08_retractions (slug TEXT);
INSERT INTO published_pieces VALUES ('a', 'fresh-piece', '2026-11-04T03:36:17.851Z');
INSERT INTO published_pieces VALUES ('b', 'retracted-piece', '2026-11-03T20:00:00.000Z');
INSERT INTO published_pieces VALUES ('c', 'too-old', '2026-11-03T07:59:59.000Z');
INSERT INTO published_pieces VALUES ('d', 'after-deadline', '2026-11-04T08:30:00.000Z');
INSERT INTO q08_retractions VALUES ('retracted-piece');
""")

    def d1_db(name, sql, params=None):
        assert name == "q08-signal"
        cur = q.execute(sql, params or [])
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]
    c.execute("DELETE FROM bp26_probe_results")
    fctx = P.Ctx(d1=d1, d1_db=d1_db, http=fake_http, root=td_root, now=win)
    fr = freshness_row(fctx)
    ok(fr and fr[0] == "fresh:q08.org" and fr[1] == 1 and fr[2].startswith("deadline 2026-11-04T08:00:00Z: 1 piece(s)") and "newest 2026-11-04T03:36:17" in fr[2], "one piece in the 24 h before the deadline: fresh: %r" % (fr,))
    c.execute("INSERT INTO bp26_probe_results (run_at, metric, subject, ok, detail) VALUES (?, 'slo_attainment_28d_min', 'fresh:q08.org', 1, ?)", ("2026-11-04T09:10:00Z", fr[2]))
    ok(freshness_row(fctx) is None, "the same deadline is sampled once")
    q.execute("DELETE FROM published_pieces WHERE slug = 'fresh-piece'")
    c.execute("DELETE FROM bp26_probe_results")
    fr2 = freshness_row(fctx)
    ok(fr2 and fr2[1] == 0 and "none" in fr2[2], "no piece in the window (the retracted one and the older one do not count): stale: %r" % (fr2,))

    def broken_db(*a, **k):
        raise RuntimeError("D1 overloaded")
    fr3 = freshness_row(P.Ctx(d1=d1, d1_db=broken_db, http=fake_http, root=td_root, now=win))
    ok(fr3 and fr3[1] is None and fr3[2].startswith("not sampled: q08-signal unreadable"), "an unreadable database is an unsampled row, never a failed one: %r" % (fr3,))
    res7 = {r.metric: r for r in collect_web(P.Ctx(d1=d1, d1_db=d1_db, http=fake_http, root=td_root, now=win))}
    ok(any(sub == "fresh:q08.org" for sub, _v, _d in res7["slo_attainment_28d_min"].rows), "collect_web carries the freshness row on the SLO result")
    ok(len(res7["slo_attainment_28d_min"].rows) < 60, "the evidence rows stay under the framework's 60-row cap: %d" % len(res7["slo_attainment_28d_min"].rows))
    # BP26-LABEL-LEDGER-1: a thread closed by THREAD-CLOSE-1 (carried on the channels, never posted as a thread) is not a post of its own
    sp, sp_err = social_posts(P.Ctx(d1=d1, http=fake_http, root=td_root))
    ok(sp_err is None and ("bluesky-thread", "thread post one") in sp and not any(t == "carried draft" for _s, t in sp), "a carried thread draft is not counted as a post, a thread posted on Bluesky is: %r %r" % (sp, sp_err))
    # BP26-SHARED-METRIC-1: the freshness list must not name a metric another collector refreshes (it would suppress this collector)
    ok("a11y_violations_serious" not in COLLECTORS[0].metrics and "slo_attainment_28d_min" in COLLECTORS[0].metrics, "collect_web does not share a11y_violations_serious with the axe collector: %r" % (COLLECTORS[0].metrics,))
    print("bp26_web selftest %s" % ("ok" if not fails else "FAILED %d" % len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    print(__doc__)
