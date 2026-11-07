"""Probe candidate ATS board slugs against the public Greenhouse, Lever and Ashby APIs; print the live ones with job counts."""
import json, sys, urllib.request, concurrent.futures as cf

SLUGS = """adyen mollie bunq picnic justeattakeaway messagebird bird wetransfer backbase mendix elastic datadog airbnb lyft doordash coinbase figma airtable asana okta twilio cloudflare canonical
hashicorp grafanalabs mapbox replicahq ridewithvia lime transit populus streetlightdata conveyal urbanfootprint swiftly deepmind perplexity scale mozilla wikimedia khanacademy codeforamerica givewell
openphilanthropy rethinkpriorities 80000hours dbtlabsinc carto safegraph dataiku fivetran snowflake nesta wri rand brookings urban gallup ipsos nielsen epsilon deloitte kpmg bcg mckinsey bain
ey accenture oliverwyman rolandberger dalberg mathematica abtassociates westat rti norc ideo palantir mistral huggingface stability runway midjourney character cohere anthropic openai notion ramp linear
vercel supabase planetscale posthog sentry pagerduty hubspot intercom miro canva booking tomtom here flixbus citymapper moovit uber waymo cruise aurora nuro zoox rivian
scaleai elevenlabs mongodb gitlab stripe databricks""".split()

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 qnfo-jobsearch-probe"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except Exception:
        return None

def probe(slug):
    out = []
    d = get(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs")
    if d and d.get("jobs"): out.append(("greenhouse", len(d["jobs"])))
    d = get(f"https://api.lever.co/v0/postings/{slug}?mode=json")
    if isinstance(d, list) and d: out.append(("lever", len(d)))
    d = get(f"https://api.ashbyhq.com/posting-api/job-board/{slug}")
    if d and d.get("jobs"): out.append(("ashby", len(d["jobs"])))
    return slug, out

with cf.ThreadPoolExecutor(12) as ex:
    for slug, out in ex.map(probe, dict.fromkeys(SLUGS)):
        if out: print(slug, out)
