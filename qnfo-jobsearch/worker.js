// qnfo-jobsearch: verified-claims job matcher (JOBSEARCH-1). Charter pillar: personal.
// Hourly cron fetches public ATS feeds (Greenhouse, Lever, Ashby) plus Remotive and Arbeitnow, gates and scores each posting
// against the owner's claim ledger, assembles a tailored resume and note ONLY from ledger sentences, re-verifies every output
// line, and stores the result in D1 (jobsearch_matches). Nothing is ever sent: status moves pending_owner_approval -> approved/rejected/applied
// by the owner (POST needs x-loop-token). No LinkedIn/Indeed scraping (LinkedIn User Agreement s8.2).
// JOBSEARCH-OPS-1 (1.1.0): e-mailed-code owner sign-in via qnfo-email (no secret to manage), feed health and retry, self-healing runs, posting lifecycle (expired), dedupe, retention, GET /api/ops self-report.
// JOBSEARCH-OUTCOME-1 (1.2.0): append-only status events, outcome funnel (applied, replies, interviews, offers), reply rate of applications older than 21 days, metrics jobsearch_reply_rate_90d / jobsearch_interview_rate_90d / jobsearch_applied_30d written each run, no_reply after 21 days.
// JOBSEARCH-PROFILE-1 (1.3.0): yes/no search survey, role families drawn from the whole record (policy, transport and planning, data, product, program, research, consulting, nonprofit, GIS, contracts, social policy), location gates from the owner answers (Netherlands and remote by default, US and other on-site only when selected), likes and dislikes teach the search, rejected matches stay hidden, "check a job" analysis of a pasted link or text.
// Routes: GET / (web UI) | GET /api | GET /api/matches | GET /api/matches/:id | GET /api/runs | GET /api/ledger | POST /api/run | POST /api/matches/:id/status | GET /health
// Port of the jobsearch/ Python modules (tests: jobsearch/test_jobsearch.py, qnfo-jobsearch/worker.test.mjs).
var VERSION = "1.4.2";
const WORKER = "qnfo-jobsearch";
const LEDGER = {
 "ledger_verified_on": "2026-10-01",
 "_note": "Claim ledger. Source: Documents/Rowan Brad Quni-Gudzinas - CV (verified, corrected).md (2026-10-01). Every sentence the tool emits must equal a 'text' or 'pitch' here. Edit this file, never the generated output.",
 "person": {
  "name": "Rowan Brad Quni-Gudzinas",
  "also_published_as": "Brad Gudzinas",
  "location": "Amsterdam, Netherlands",
  "email": "rowan.quni@qnfo.org",
  "sign_in_email": "rwnquni@outlook.com",
  "links": {
   "site": "https://qnfo.org",
   "papers": "https://papers.qnfo.org",
   "linkedin": "https://www.linkedin.com/in/rowan-quni/",
   "orcid": "https://orcid.org/0009-0002-4317-5604"
  },
  "career_start": 2004
 },
 "unverified_needs_owner": [
  "US citizenship vs. work-authorization basis (stated only: authorized in US)",
  "basis of NL authorization (permit type; whether it extends to other EU states)"
 ],
 "facts": [
  {
   "id": "F01",
   "cluster": [
    "research_mgmt",
    "federal",
    "contracting",
    "program_mgmt"
   ],
   "employer": "U.S. DOT, Federal Highway Administration",
   "period": "2011-2015",
   "text": "Managed a $1.5M+ federal research portfolio as a certified Contracting Officer's Representative: technical oversight, budgets, milestones, and acceptance of contractor deliverables.",
   "pitch": "At the Federal Highway Administration I managed a $1.5M+ federal research portfolio as a certified Contracting Officer's Representative."
  },
  {
   "id": "F02",
   "cluster": [
    "transport_modeling",
    "federal",
    "data_product",
    "urban_planning",
    "survey_methods"
   ],
   "employer": "U.S. DOT, Federal Highway Administration",
   "period": "2011-2015",
   "text": "Led technical components of the national Tour-Based Model System for long-distance passenger travel forecasting.",
   "pitch": "I led technical components of the national Tour-Based Model System for long-distance passenger travel forecasting."
  },
  {
   "id": "F03",
   "cluster": [
    "policy_research",
    "data_product",
    "social_policy",
    "survey_methods",
    "gis"
   ],
   "employer": "AARP Public Policy Institute",
   "period": "2016-2021",
   "text": "Led the AARP Livability Index: 50+ data sources across 7 domains, scoring U.S. neighborhoods nationwide, across multiple public releases.",
   "pitch": "At AARP I led the Livability Index: 50+ data sources across 7 domains, scoring U.S. neighborhoods nationwide."
  },
  {
   "id": "F04",
   "cluster": [
    "policy_research",
    "social_policy"
   ],
   "employer": "AARP Public Policy Institute",
   "period": "2016-2021",
   "text": "The Index and its method are cited in 20+ academic and policy studies.",
   "pitch": "The Livability Index and its method are cited in 20+ academic and policy studies."
  },
  {
   "id": "F05",
   "cluster": [
    "policy_research",
    "social_policy"
   ],
   "employer": "AARP Public Policy Institute",
   "period": "2016-2021",
   "text": "Co-authored the Livability Index 2018 report and AARP policy work on housing affordability, including the 2016 analysis of Low-Income Housing Tax Credits.",
   "pitch": "I co-authored the Livability Index 2018 report and AARP policy work on housing affordability."
  },
  {
   "id": "F06",
   "cluster": [
    "ai_systems",
    "research_integrity",
    "research_mgmt"
   ],
   "employer": "QNFO",
   "period": "2024-present",
   "text": "Built and run an autonomous research system on Cloudflare (44+ live workers) that drafts, referees, revises, versions, publishes, and corrects papers.",
   "pitch": "I built and run an autonomous research system on Cloudflare (44+ live workers) that drafts, referees, revises, versions, publishes, and corrects papers."
  },
  {
   "id": "F07",
   "cluster": [
    "research_integrity",
    "ai_systems"
   ],
   "employer": "QNFO",
   "period": "2024-present",
   "text": "Designed the audit method: The Universal Ignorance Audit and Epistemic Legibility in AI-Assisted Science.",
   "pitch": "I designed a published audit method for AI-assisted research: The Universal Ignorance Audit and Epistemic Legibility in AI-Assisted Science."
  },
  {
   "id": "F08",
   "cluster": [
    "ai_systems",
    "quantum_energy"
   ],
   "employer": "QNFO",
   "period": "2024-present",
   "text": "Proposed JPCUB, a whole-system energy benchmark for computing (joules per correct answer), with a measurement protocol, estimates for 17 quantum platforms, and an extension to LLM inference.",
   "pitch": "I proposed JPCUB, a whole-system energy benchmark for computing (joules per correct answer), with estimates for 17 quantum platforms and an extension to LLM inference."
  },
  {
   "id": "F09",
   "cluster": [
    "research_integrity"
   ],
   "employer": "QNFO",
   "period": "2024-present",
   "text": "Publish an open library of preprints with DOIs and a queryable knowledge graph.",
   "pitch": "I publish an open library of preprints with DOIs and a queryable knowledge graph."
  },
  {
   "id": "F10",
   "cluster": [
    "ai_systems",
    "nonprofit"
   ],
   "employer": "Empowering Change",
   "period": "2023-2024",
   "text": "Built an LLM legal-navigation tool for self-represented litigants: document drafting, procedural guidance, and plain-language translation of legal terms.",
   "pitch": "I built an LLM legal-navigation tool for self-represented litigants: document drafting, procedural guidance, and plain-language translation of legal terms."
  },
  {
   "id": "F11",
   "cluster": [
    "nonprofit",
    "leadership",
    "program_mgmt"
   ],
   "employer": "Empowering Change",
   "period": "2023-2024",
   "text": "Took the nonprofit from incorporation to public launch.",
   "pitch": "As Executive Director and Founder of Empowering Change I took the nonprofit from incorporation to public launch."
  },
  {
   "id": "F12",
   "cluster": [
    "data_science",
    "federal",
    "consulting"
   ],
   "employer": "Deloitte Consulting LLP",
   "period": "2015-2016",
   "text": "Delivered analytics and machine-learning engagements for federal and public-sector clients.",
   "pitch": "At Deloitte I delivered analytics and machine-learning engagements for federal and public-sector clients."
  },
  {
   "id": "F13",
   "cluster": [
    "transport_modeling",
    "policy_research",
    "survey_methods",
    "urban_planning"
   ],
   "employer": "Deloitte Consulting LLP",
   "period": "2015-2016",
   "text": "Co-authored a 2016 Transportation Research Board paper on updating the National Household Travel Survey with American Community Survey data.",
   "pitch": "I co-authored a 2016 Transportation Research Board paper on updating the National Household Travel Survey with American Community Survey data."
  },
  {
   "id": "F14",
   "cluster": [
    "transport_modeling",
    "policy_research",
    "urban_planning"
   ],
   "employer": "U.S. DOT, Federal Highway Administration",
   "period": "2011-2015",
   "text": "Presented national long-distance travel data needs at the 2011 TRB National Household Travel Survey workshop.",
   "pitch": "I presented national long-distance travel data needs at the 2011 TRB National Household Travel Survey workshop."
  },
  {
   "id": "F15",
   "cluster": [
    "product",
    "data_product"
   ],
   "employer": "iManage; Epsilon (Publicis Groupe); AARP",
   "period": "2016-2023",
   "text": "Product management roles: Platform Data Product Manager at iManage (2022 to 2023), Senior Product Manager at Epsilon (2021 to 2022), Product Manager and Senior Methods Advisor at AARP Public Policy Institute (2016 to 2021).",
   "pitch": "I have held product roles at iManage (Platform Data Product Manager), Epsilon (Senior Product Manager), and AARP (Product Manager and Senior Methods Advisor)."
  },
  {
   "id": "F16",
   "cluster": [
    "credentials"
   ],
   "employer": "",
   "period": "",
   "text": "Certifications: Project Management Professional (PMP, 2016), Contracting Officer's Representative (COR, 2011), American Institute of Certified Planners (AICP, 2009).",
   "pitch": "I hold PMP, COR, and AICP certifications."
  },
  {
   "id": "F17",
   "cluster": [
    "credentials"
   ],
   "employer": "Rutgers University",
   "period": "2004-2008",
   "text": "Education: M.S., City and Regional Studies, Rutgers University (2008); B.A., Urban Studies and Community Planning, Rutgers University-Camden (2004).",
   "pitch": "I hold an M.S. in City and Regional Studies from Rutgers University."
  }
 ],
 "skills": [
  "research program management",
  "federal contract oversight",
  "product management",
  "statistical modeling",
  "travel-demand modeling",
  "gis",
  "llm agent systems",
  "cloudflare workers",
  "d1",
  "r2",
  "vectorize",
  "python",
  "javascript",
  "sql",
  "machine learning",
  "data science"
 ],
 "headlines": [
  {
   "id": "H1",
   "cluster": [
    "research_mgmt"
   ],
   "text": "Research program leader: 15 years running national research programs and data products at the U.S. Federal Highway Administration and AARP."
  },
  {
   "id": "H2",
   "cluster": [
    "ai_systems",
    "research_integrity"
   ],
   "text": "Research systems builder: founder of QNFO, an independent research imprint with an AI-assisted pipeline, a published audit method, and a public correction trail."
  },
  {
   "id": "H3",
   "cluster": [
    "data_product",
    "product",
    "data_science",
    "survey_methods"
   ],
   "text": "Data and product leader: 15 years running national research programs and data products at the U.S. Federal Highway Administration and AARP; later product roles at Epsilon and iManage."
  }
 ],
 "closing": "Full CV, papers, and contact: qnfo.org",
 "owner_stated": {
  "stated": "2026-10-27",
  "work_authorization": [
   "NL",
   "US"
  ],
  "salary_floor": "varies by role type and location; no filter applied",
  "employment_types": [
   "full-time",
   "contract"
  ],
  "languages": [
   "English"
  ],
  "relocation": "anywhere, no boundary (stated 2026-10-27)"
 }
};

// ------------------------------------------------------------------ operations layer (JOBSEARCH-OPS-1)
const OWNER_EMAIL = LEDGER.person.sign_in_email || LEDGER.person.email;
const LEDGER_VERIFIED_ON = LEDGER.ledger_verified_on || "2026-10-01";
const SESSION_MS = 12 * 3600 * 1000, CODE_MS = 15 * 60 * 1000, CODE_MAX_PER_HOUR = 6, CODE_MIN_GAP_MS = 60 * 1000, CODE_MAX_TRIES = 5;
const DDL = [
  "CREATE TABLE IF NOT EXISTS jobsearch_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, finished_at TEXT, feeds INTEGER, fetched INTEGER, passed INTEGER, stored INTEGER, blocked INTEGER, excluded_json TEXT, errors_json TEXT)",
  "CREATE TABLE IF NOT EXISTS jobsearch_matches (id TEXT PRIMARY KEY, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, run_id INTEGER, company TEXT, title TEXT, location TEXT, url TEXT, tier TEXT, score INTEGER, why_json TEXT, flags_json TEXT, verified INTEGER NOT NULL DEFAULT 0, blocked_reason TEXT, resume_md TEXT, note_md TEXT, status TEXT NOT NULL DEFAULT 'pending_owner_approval', decided_at TEXT)",
  "CREATE INDEX IF NOT EXISTS idx_jobsearch_matches_rank ON jobsearch_matches (score DESC, last_seen DESC)",
  "CREATE TABLE IF NOT EXISTS jobsearch_feeds (feed TEXT PRIMARY KEY, last_ok_at TEXT, last_count INTEGER, last_error TEXT, last_error_at TEXT, consecutive_fail INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS jobsearch_meta (k TEXT PRIMARY KEY, v TEXT, updated_at TEXT)",
  "CREATE TABLE IF NOT EXISTS jobsearch_codes (id INTEGER PRIMARY KEY AUTOINCREMENT, code_hash TEXT NOT NULL, salt TEXT NOT NULL, created_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, used INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS jobsearch_sessions (token_hash TEXT PRIMARY KEY, created_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS jobsearch_events (id INTEGER PRIMARY KEY AUTOINCREMENT, match_id TEXT NOT NULL, event TEXT NOT NULL, ts TEXT NOT NULL, note TEXT)",
  "CREATE INDEX IF NOT EXISTS idx_jobsearch_events_match ON jobsearch_events (match_id, ts)",
  "CREATE TABLE IF NOT EXISTS jobsearch_prefs (k TEXT PRIMARY KEY, v TEXT, updated_at TEXT)",
  "CREATE TABLE IF NOT EXISTS jobsearch_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, title TEXT, company TEXT, verdict TEXT NOT NULL, source TEXT)",
];
let ensured = false;
async function ensure(env) {
  if (ensured) return;
  for (const q of DDL) await env.JOBS_DB.prepare(q).run();
  ensured = true;
}
const iso = (ms) => new Date(ms).toISOString();
const log = (event, o) => console.log(JSON.stringify({ worker: WORKER, event, ...o }));
const logErr = (event, e) => console.error(JSON.stringify({ worker: WORKER, event, error: String((e && e.message) || e) }));
async function sha256hex(x) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(x)));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function constEq(a, b) {
  a = String(a); b = String(b);
  let r = a.length === b.length ? 0 : 1;
  const n = Math.max(a.length, b.length, 1);
  for (let i = 0; i < n; i++) r |= (a.charCodeAt(i % (a.length || 1)) ^ b.charCodeAt(i % (b.length || 1))) | 0;
  return r === 0;
}
const randHex = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
const maskedOwner = () => OWNER_EMAIL.replace(/^(.).*(@.*)$/, "$1***$2");
async function setMeta(env, k, v) {
  await env.JOBS_DB.prepare("INSERT INTO jobsearch_meta (k, v, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET v=?2, updated_at=?3").bind(k, String(v), new Date().toISOString()).run();
}
// feed key -> id prefix of the postings it produced (a feed that failed this run never expires anything)
function feedPrefix(feed) {
  const [kind, arg] = feed.split(":");
  return { greenhouse: `gh:${arg}:`, lever: `lv:${arg}:`, ashby: `ab:${arg}:`, remotive: "rm:", muse: "mu:", jobicy: "jb:", arbeitnow: "an:", publicsector: `ps:${arg}:` }[kind];
}
const dedupeKey = (j) => `${j.company}|${j.title}|${j.location}`.toLowerCase().replace(/\s+/g, " ").trim();

// ------------------------------------------------------------------ feeds
// JOBSEARCH-SOURCES-1 (2026-10-28; tier B from 35 so data-product roles at Amsterdam employers surface, legal titles excluded outright): boards chosen for the owner's record (policy and research management, data products, transport and mobility, AI) and for
// Amsterdam and EU employers; each slug was probed live against the public API before it was added. A board that fails 3 runs in a row shows in /api/ops.
const BOARDS = {
  greenhouse: ["anthropic", "scaleai", "mongodb", "elastic", "gitlab", "databricks", "stripe", "adyen", "bird", "datadog", "cloudflare", "canonical", "grafanalabs", "mozilla", "wikimedia", "khanacademy",
    "codeforamerica", "givewell", "dataiku", "fivetran", "nesta", "gallup", "rti", "ideo", "waymo", "nuro", "lyft"],
  lever: ["palantir", "mistral", "mendix", "brookings", "oliverwyman", "zoox"],
  ashby: ["openai", "cohere", "notion", "elevenlabs", "mollie", "mapbox", "perplexity", "snowflake"],
  remotive: ["data", "product", "all-others"],
  muse: ["Amsterdam, Netherlands|", "Amsterdam, Netherlands|Data and Analytics", "Amsterdam, Netherlands|Project & Product Management", "Amsterdam, Netherlands|Management", "Flexible / Remote|Data and Analytics", "Flexible / Remote|Project & Product Management", "Flexible / Remote|Management", "Flexible / Remote|Consulting"],
  jobicy: ["netherlands", "europe", "emea"],
  arbeitnow: true,
  publicsector: ["werkenvoornederland", "academictransfer", "euraxess"],
};
const ACTIVE_FEEDS = new Set(Object.entries(BOARDS).flatMap(([kind, args]) =>
  kind === "arbeitnow" ? ["arbeitnow"] : args.map((arg) => `${kind}:${arg}`)
));
const DISPLAY = { openai: "OpenAI", scaleai: "Scale AI", gitlab: "GitLab", mongodb: "MongoDB", anthropic: "Anthropic", databricks: "Databricks", elastic: "Elastic", stripe: "Stripe", palantir: "Palantir", mistral: "Mistral", cohere: "Cohere", notion: "Notion", elevenlabs: "ElevenLabs", adyen: "Adyen", bird: "Bird", datadog: "Datadog", cloudflare: "Cloudflare", canonical: "Canonical", grafanalabs: "Grafana Labs", mozilla: "Mozilla", wikimedia: "Wikimedia Foundation", khanacademy: "Khan Academy", codeforamerica: "Code for America", givewell: "GiveWell", dataiku: "Dataiku", fivetran: "Fivetran", nesta: "Nesta", gallup: "Gallup", rti: "RTI International", ideo: "IDEO", waymo: "Waymo", nuro: "Nuro", lyft: "Lyft", mendix: "Mendix", brookings: "Brookings Institution", oliverwyman: "Oliver Wyman", zoox: "Zoox", mollie: "Mollie", mapbox: "Mapbox", perplexity: "Perplexity", snowflake: "Snowflake",
    deepmind: "DeepMind", tno: "TNO", cwi: "CWI", "european-commission": "European Commission", nwo: "NWO", "university-of-amsterdam": "University of Amsterdam" };

function decodeEntities(s) {
  return String(s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
function stripHtml(s) {
  s = decodeEntities(s);
  s = s.replace(/<(br|\/p|\/li|\/h\d)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  return s.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
async function getJson(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 25000);
  try {
   const r = await fetch(url, { headers: { "user-agent": "qnfo-jobsearch/1.0 (+https://qnfo.org)" }, signal: ac.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
async function getHtml(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 25000);
  try {
    const r = await fetch(url, { headers: { "user-agent": "qnfo-jobsearch/1.0 (+https://qnfo.org; contact via https://qnfo.org)", "accept": "text/html" }, signal: ac.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}
const FETCHERS = {
  async greenhouse(slug) {
    const d = await getJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`);
    return (d.jobs || []).map((j) => ({ id: `gh:${slug}:${j.id}`, source: "greenhouse", company: slug, title: j.title || "", location: (j.location || {}).name || "", url: j.absolute_url || "", desc: stripHtml(j.content || "") }));
  },
  async lever(slug) {
    const d = await getJson(`https://api.lever.co/v0/postings/${slug}?mode=json`);
    return d.map((j) => ({ id: `lv:${slug}:${j.id}`, source: "lever", company: slug, title: j.text || "", location: (j.categories || {}).location || "", url: j.hostedUrl || "", desc: (j.descriptionPlain || "") + "\n" + (j.additionalPlain || "") }));
  },
  async ashby(slug) {
    const d = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
    return (d.jobs || []).filter((j) => j.isListed !== false).map((j) => ({ id: `ab:${slug}:${j.id}`, source: "ashby", company: slug, title: j.title || "", location: (j.location || "") + (j.isRemote ? " (Remote)" : ""), url: j.jobUrl || "", desc: j.descriptionPlain || stripHtml(j.descriptionHtml || "") }));
  },
  async remotive(cat) {
    const d = await getJson(`https://remotive.com/api/remote-jobs?category=${cat}`);
    return (d.jobs || []).map((j) => ({ id: `rm:${j.id}`, source: "remotive", company: j.company_name || "", title: j.title || "", location: "Remote - " + (j.candidate_required_location || ""), url: j.url || "", desc: stripHtml(j.description || "") }));
  },
  // The Muse: all industries (consulting, public sector, nonprofits, product, data); arg is "location|category", 3 pages of 20
  async muse(arg) {
    const [loc, cat] = arg.split("|"), out = [];
    for (let p = 1; p <= 3; p++) {
      const d = await getJson(`https://www.themuse.com/api/public/jobs?page=${p}&location=${encodeURIComponent(loc)}${cat ? "&category=" + encodeURIComponent(cat) : ""}`);
      for (const j of d.results || []) out.push({ id: `mu:${j.id}`, source: "muse", company: (j.company && j.company.name) || "", title: j.name || "", location: (j.locations || []).map((l) => l.name).join(" | "), url: (j.refs && j.refs.landing_page) || "", desc: stripHtml(j.contents || "") });
      if (p >= (d.page_count || 1)) break;
    }
    return out;
  },
  // Jobicy: remote roles by region
  async jobicy(geo) {
    const d = await getJson(`https://jobicy.com/api/v2/remote-jobs?count=100&geo=${geo}`);
    return (d.jobs || []).map((j) => ({ id: `jb:${j.id}`, source: "jobicy", company: j.companyName || "", title: j.jobTitle || "", location: "Remote - " + (Array.isArray(j.jobGeo) ? j.jobGeo.join(", ") : j.jobGeo || ""), url: j.url || "", desc: stripHtml(j.jobDescription || j.jobExcerpt || "") }));
  },
  async arbeitnow() {
    const out = [];
    for (let p = 1; p <= 3; p++) {
      const d = await getJson(`https://www.arbeitnow.com/api/job-board-api?page=${p}`);
      for (const j of d.data || []) out.push({ id: `an:${j.slug}`, source: "arbeitnow", company: j.company_name || "", title: j.title || "", location: (j.location || "") + (j.remote ? " (Remote)" : ""), url: j.url || "", desc: stripHtml(j.description || "") });
    }
    return out;
  },
  // Public-sector boards with no open RSS/API feed (issue #1000643): we read the public listing HTML pages
  // (robots.txt and site terms were read first; only public listing pages are fetched, one page per board per run,
  // a 25s timeout, and the site's own job URLs are passed through unchanged). Every arg was probed live before adding.
  async publicsector(arg) {
    const sources = {
      werkenvoornederland: { url: "https://www.werkenvoornederland.nl/vacatures", base: "https://www.werkenvoornederland.nl", company: "Werken voor Nederland (Rijksoverheid)" },
      academictransfer: { url: "https://www.academictransfer.com/en/jobs/", base: "https://www.academictransfer.com", company: "Academic Transfer (Dutch universities)" },
      euraxess: { url: "https://euraxess.ec.europa.eu/jobs/search", base: "https://euraxess.ec.europa.eu", company: "EURAXESS (EU research careers)" },
    };
    const s = sources[arg];
    if (!s) return [];
    const html = await getHtml(s.url);
    const out = [];
    const seen = new Set();
    // listing pages expose each posting as an <a> whose href carries the job path; we keep anchors with a
    // job-like href and a text length typical of a title, and skip navigation/cookie/script links.
    const re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html))) {
      let href = decodeEntities(m[1]);
      const text = stripHtml(m[2]);
      if (!/\/(vacature|vacatures|job|jobs|vacancy|vacancies|position)\b/i.test(href)) continue;
      if (!/^https?:/.test(href)) href = s.base + (href.startsWith("/") ? href : "/" + href);
      if (!href.startsWith(s.base)) continue;
      if (text.length < 5 || text.length > 200) continue;
      const key = (s.company + "|" + text).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: `ps:${arg}:${await sha256hex(href).then((h) => h.slice(0, 16))}`, source: "publicsector", company: s.company, title: text, location: arg === "werkenvoornederland" ? "Netherlands" : (arg === "academictransfer" ? "Netherlands" : "EU"), url: href, desc: "" });
    }
    return out;
  },
};

// ------------------------------------------------------------------ matching (port of match.py)
// ------------------------------------------------------------------ search profile (JOBSEARCH-PROFILE-1)
// The owner answers yes/no questions (survey); answers and the likes and dislikes he gives drive the gates, so the search is his, not a fixed AI-lab filter.
// [id, group, question, default]; default null = unanswered (no effect beyond a small ranking nudge)
const SURVEY = [
  ["loc_nl", "Where", "Roles in Amsterdam or elsewhere in the Netherlands (on-site or hybrid)?", true],
  ["loc_remote", "Where", "Fully remote roles open to Europe or worldwide?", true],
  ["loc_eu", "Where", "Roles on-site in another EU country or the UK (you would move)?", false],
  ["loc_us", "Where", "Roles on-site in the United States (you would move)?", false],
  ["loc_world", "Where", "Roles on-site anywhere else in the world (you would move)?", false],
  ["fam_policy", "Work", "Public policy research and advisory (policy analyst, advisor, officer, head of policy)?", true],
  ["fam_transport", "Work", "Transport, mobility, urban and regional planning?", true],
  ["fam_data", "Work", "Data science and analytics leadership (head of data, analytics manager, lead data scientist)?", true],
  ["fam_product", "Work", "Product management, especially data and platform products?", true],
  ["fam_program", "Work", "Program, project and portfolio management (you hold the PMP)?", true],
  ["fam_research", "Work", "Research management: research director, grants, research operations, senior researcher?", true],
  ["fam_consult", "Work", "Consulting and advisory (consultant, principal, engagement manager)?", true],
  ["fam_nonprofit", "Work", "Nonprofit, foundation and NGO leadership (executive director, program director)?", true],
  ["fam_gis", "Work", "GIS and geospatial analysis?", true],
  ["fam_contract", "Work", "Contracts and procurement oversight (you were a certified contracting officer representative)?", true],
  ["fam_social", "Work", "Housing, ageing, community and social policy?", true],
  ["fam_climate", "Work", "Sustainability, climate and energy-transition roles?", null],
  ["fam_ai", "Work", "AI and machine-learning product, governance or safety roles?", true],
  ["fam_quantum", "Work", "Quantum, deep-tech and research-integrity roles?", null],
  ["fam_edu", "Work", "Teaching, training and academic roles?", null],
  ["lvl_manage", "Level", "Roles that manage people?", null],
  ["lvl_mid", "Level", "Roles below senior level (no senior, lead, head, principal or director in the title)?", null],
  ["type_contract", "Contract", "Contract, freelance or interim engagements?", true],
];
const SURVEY_IDS = new Set(SURVEY.map((q) => q[0]));
// role families: title terms (a hit means the title is in your lane) and the survey question that switches the family on or off
const FAMILIES = {
  fam_policy: ["policy analyst", "policy advisor", "policy adviser", "policy officer", "policy manager", "policy lead", "head of policy", "director of policy", "public policy", "policy researcher", "senior policy", "policy and research", "science policy", "policy specialist", "policy director"],
  fam_transport: ["transport", "mobility", "urban planner", "urban planning", "regional planning", "spatial planning", "transport planner", "city planner", "land use", "transport model", "smart city", "traffic", "infrastructure planning", "urban development"],
  fam_data: ["data scientist", "head of data", "director of data", "analytics manager", "analytics lead", "director of analytics", "head of analytics", "head of insights", "data science manager", "chief data", "data strategy", "insights manager", "data analytics manager", "lead data", "principal data", "data product", "data lead"],
  fam_product: ["product manager", "product owner", "head of product", "group product", "product lead", "director of product", "principal product", "product management"],
  fam_program: ["program manager", "programme manager", "project manager", "portfolio manager", "pmo", "delivery manager", "head of programs", "head of programmes", "director of programs", "programme director", "program director", "program lead", "programme lead"],
  fam_research: ["research manager", "research director", "research program", "research programme", "head of research", "director of research", "research operations", "research lead", "grants manager", "research coordinator", "research partnerships", "research strategy", "senior researcher", "principal researcher", "research advisor", "research adviser", "research fellow", "evaluation manager", "monitoring and evaluation"],
  fam_consult: ["consultant", "engagement manager", "advisory", "associate partner", "management consult*", "strategy consult*"],
  fam_nonprofit: ["executive director", "managing director", "country director", "chief of staff", "director of operations", "foundation"],
  fam_gis: ["gis", "geospatial", "geographic information", "spatial data", "spatial analyst"],
  fam_contract: ["contracting officer", "contract manager", "contracts manager", "procurement manager", "vendor manager", "sourcing manager"],
  fam_social: ["housing", "social policy", "community development", "ageing", "aging", "livability", "affordable"],
  fam_climate: ["sustainability", "climate", "energy transition", "esg", "net zero", "decarbon"],
  fam_ai: ["ai governance", "ai policy", "applied ai", "ai product", "ml product", "responsible ai", "ai safety", "trust and safety", "ai evaluation", "ai ethics", "ai strategy", "ai program", "ai programme"],
  fam_quantum: ["quantum", "research integrity", "scientific integrity", "open science"],
  fam_edu: ["lecturer", "professor", "teaching fellow", "instructor", "trainer", "education manager", "learning manager", "curriculum"],
};
const CLUSTER_KW = {
  research_mgmt: ["research program", "research portfolio", "research operations", "research management", "program management", "research strategy", "head of research", "research lead", "grant", "wetenschappelijk", "onderzoek"],
  federal: ["federal government", "federal agenc*", "government agenc*", "public sector", "public administration", "government", "ministry", "municipal", "european commission"],
  transport_modeling: ["transportation", "travel demand", "mobility", "transit", "forecasting", "traffic", "infrastructure"],
  urban_planning: ["urban planning", "regional planning", "land use", "spatial planning", "urban development", "city planning", "smart city"],
  gis: ["gis", "geospatial", "arcgis", "qgis", "spatial analysis", "geographic information"],
  policy_research: ["public policy", "policy research", "survey", "social science", "evidence-based", "policy analysis", "stakeholder"],
  social_policy: ["housing", "affordab*", "ageing", "aging", "older adults", "livability", "community development", "social policy"],
  survey_methods: ["statistical", "econometric", "survey methodology", "statistics", "modelling", "modeling", "quantitative"],
  ai_systems: ["llm", "large language model", "ai agent", "agentic", "generative ai", "applied ai", "machine learning", "ai evaluation", "evals", "rag "],
  research_integrity: ["research integrity", "reproducib*", "peer review", "scientific integrity", "open science", "provenance", "responsible ai", "ai governance", "ai safety", "audit", "trustworthy"],
  data_product: ["data product", "data platform", "analytics", "dashboard", "data strategy", "data governance"],
  quantum_energy: ["quantum", "energy efficiency", "benchmark"],
  nonprofit: ["nonprofit", "non-profit", "civil society", "ngo", "foundation", "philanthrop*"],
  product: ["product manager", "product management", "roadmap", "product strategy", "stakeholder"],
  data_science: ["data science", "data scientist", "machine learning", "predictive"],
  program_mgmt: ["program management", "programme management", "project management", "portfolio", "pmo", "delivery", "milestone", "budget"],
  contracting: ["contracting officer", "procurement", "vendor management", "contract management", "deliverables", "tender"],
  consulting: ["consulting", "advisory", "client engagement", "clients"],
  climate: ["sustainab*", "climate", "energy transition", "net zero", "decarbon*"],
};
const TITLE_MEDIUM = ["product manager", "program manager", "programme manager", "principal", "director", "head of", "lead", "strategist", "manager", "analyst", "advisor", "adviser", "consultant", "researcher", "specialist", "policy", "research"];
const SENIOR_RE = /\b(senior|sr\.?|lead|head|director|principal|chief|vp|vice president|staff|manager|partner|executive)\b/i;
const MANAGE_RE = /\b(head of|director|manager|lead|chief|vp|vice president)\b/i;
// hard noise: never your lane, whatever else the title says
const ABSOLUTE_EXCLUDE = ["intern", "junior", "entry", "graduate", "new grad", "apprentice", "trainee", "engineer", "architect", "counsel", "attorney", "lawyer", "paralegal", "legal", "marketing", "forward deployed", "deployment strategist",
  "sales", "account executive", "account manager", "business development", "recruit", "talent", "payroll", "accountant", "accounting", "treasury", "fp&a", "tax ", "facilities", "warehouse", "driver", "nurse", "technician",
  "customer success", "customer support", "customer service", "support specialist", "financial", "webinar", "solutions", "devops", "site reliability", "designer", "finance", "people partner", "hr ", "receptionist", "assistant"];
const TITLE_EXCLUDE_SOFT = ["scientist"];
const LOC_BAD_REMOTE = ["us only", "united states only", "us-only", "usa only", "canada only", "uk only", "india only", "latam", "apac only"];
const HOME = ["amsterdam", "netherlands", "nederland", "rotterdam", "utrecht", "eindhoven", "the hague", "den haag", "delft", "leiden", "groningen", "haarlem", "almere", "amersfoort"];
const REGION_WIDE = ["europe", "emea", "european", "eu ", "eu-", "worldwide", "anywhere", "global"];
const EUROPE_OTHER = ["germany", "berlin", "munich", "france", "paris", "london", "uk", "united kingdom", "ireland", "dublin", "spain", "madrid", "barcelona", "portugal", "lisbon", "italy", "belgium", "brussels", "denmark", "copenhagen", "sweden", "stockholm", "norway", "oslo", "finland", "helsinki", "austria", "vienna", "switzerland", "zurich", "poland", "warsaw", "czech", "prague", "luxembourg", "estonia", "latvia", "lithuania", "hungary", "romania", "greece", "croatia", "slovenia", "slovakia", "bulgaria", "malta", "cyprus"];
const US_RE = /\b(us|usa|united states|san francisco|new york|seattle|washington|boston|austin|chicago|los angeles|palo alto|mountain view|menlo park|sf|nyc|dc)\b|, (ca|ny|wa|ma|tx|il|dc)\b/;
const CORE = new Set(["federal", "policy_research", "transport_modeling", "research_mgmt", "urban_planning", "social_policy", "contracting"]);
const FRONTIER = new Set(["ai_systems", "research_integrity"]);
const DATA_SIDE = new Set(["data_product", "data_science", "survey_methods", "ai_systems", "gis"]);
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Keywords match whole words; a trailing * allows an intentional stem to continue to the word end.
const KW_RE = new Map();
const kwRe = (k) => { let r = KW_RE.get(k); if (!r) { const stem = k.endsWith("*"); const term = stem ? k.slice(0, -1) : k; r = new RegExp("(?<![a-z])" + escRe(term) + (stem ? "[a-z]*" : "(?![a-z])")); KW_RE.set(k, r); } return r; };
const has = (text, kws) => kws.filter((k) => kwRe(k).test(text));
const STOP_TOKENS = new Set(["senior", "lead", "head", "manager", "director", "principal", "global", "europe", "remote", "team", "and", "for", "the", "with", "staff", "group", "associate"]);
const tokens = (title) => [...new Set(String(title || "").toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 4 && !STOP_TOKENS.has(t)))];

// ctx = what the owner told us. answers: {id: true|false|null}; learned: {boost:Set, block:Set} from likes and dislikes of real postings
function makeCtx(answers, feedback, outcomeWeights = {}) {
  const a = {};
  for (const [id, , , def] of SURVEY) a[id] = answers && Object.prototype.hasOwnProperty.call(answers, id) && answers[id] !== undefined ? answers[id] : def;
  const fam = new Set(Object.keys(FAMILIES).filter((k) => a[k] !== false));
  const like = {}, dis = {};
  for (const f of feedback || []) for (const t of tokens(f.title)) { const m = f.verdict === "like" ? like : dis; m[t] = (m[t] || 0) + 1; }
  const boost = new Set(Object.keys(like).filter((t) => !dis[t])), block = new Set(Object.keys(dis).filter((t) => dis[t] >= 2 && !like[t]));
  return { a, fam, learned: { boost, block }, outcomeWeights };
}
const DEFAULT_CTX = makeCtx({}, []);

function clustersIn(desc, title) {
  const t = desc.toLowerCase(), ti = (title || "").toLowerCase();
  const out = new Set();
  for (const [c, kws] of Object.entries(CLUSTER_KW)) if (has(t, kws).length >= 2 || has(ti, kws).length) out.add(c);
  return out;
}
const OUTCOME_FEATURES = new Set([
  ...Object.keys(FAMILIES).map((family) => `family:${family.replace(/^fam_/, "")}`),
  ...Object.keys(CLUSTER_KW).map((cluster) => `cluster:${cluster}`),
]);
function scoreFeatures(families, clusters) {
  return [...new Set([
    ...[...families].map((family) => `family:${family.replace(/^fam_/, "")}`),
    ...[...clusters].map((cluster) => `cluster:${cluster}`),
  ])].filter((feature) => OUTCOME_FEATURES.has(feature));
}
function featuresFromWhy(why) {
  const features = new Set();
  for (const line of Array.isArray(why) ? why : []) {
    let m = /^title in your lane: (.+)$/.exec(line);
    if (m) for (const family of m[1].split(",")) features.add(`family:${family.trim()}`);
    m = /^evidence in the posting: (.+)$/.exec(line);
    if (m) for (const cluster of m[1].split(",")) features.add(`cluster:${cluster.trim()}`);
  }
  return [...features].filter((feature) => OUTCOME_FEATURES.has(feature));
}
function applicationSnapshot(match) {
  let why = [];
  try { why = JSON.parse(match.why_json || "[]"); } catch (e) { logErr("application-snapshot", e); }
  return JSON.stringify({ version: 1, tier: match.tier, score: Number(match.score), features: featuresFromWhy(why) });
}
function parseApplicationSnapshot(note) {
  try {
    const snapshot = JSON.parse(note || "");
    if (snapshot.version !== 1 || !["A", "B", "C"].includes(snapshot.tier) || !Number.isFinite(snapshot.score) || !Array.isArray(snapshot.features)) return null;
    return { tier: snapshot.tier, score: snapshot.score, features: snapshot.features.filter((feature) => OUTCOME_FEATURES.has(feature)) };
  } catch (e) { return null; }
}
function outcomeScoreWeights(rows, now = Date.now()) {
  const lower = now - 90 * 86400000, upper = now - NO_REPLY_DAYS * 86400000;
  const mature = rows.filter((row) => row.applied_ms >= lower && row.applied_ms <= upper && Array.isArray(row.features));
  if (mature.length < MIN_N) return {};
  const featureStats = new Map();
  let replies = 0;
  for (const row of mature) {
    if (row.replied) replies++;
    for (const feature of new Set(row.features.filter((key) => OUTCOME_FEATURES.has(key)))) {
      const stat = featureStats.get(feature) || { count: 0, replies: 0 };
      stat.count++;
      if (row.replied) stat.replies++;
      featureStats.set(feature, stat);
    }
  }
  const weights = {};
  for (const [feature, stat] of featureStats) {
    const without = mature.length - stat.count, withoutReplies = replies - stat.replies;
    if (stat.count < 2 || without < 2) continue;
    const withRate = (stat.replies + 1) / (stat.count + 2);
    const withoutRate = (withoutReplies + 1) / (without + 2);
    const support = Math.min(stat.count / (stat.count + 4), without / (without + 4));
    const weight = Math.max(-8, Math.min(8, Math.round((withRate - withoutRate) * 24 * support)));
    if (weight) weights[feature] = weight;
  }
  return weights;
}
function locationGate(loc, descHead, ctx = DEFAULT_CTX) {
  const l = (loc || "").toLowerCase() + " ";
  const a = ctx.a;
  if (!l.trim()) return ["check", "location missing"];
  if (LOC_BAD_REMOTE.some((b) => l.includes(b))) return ["fail", `location restricted: ${loc}`];
  const home = HOME.some((k) => l.includes(k)), remote = l.includes("remote");
  const otherEu = EUROPE_OTHER.some((k) => new RegExp("\\b" + escRe(k) + "\\b").test(l)) || /\b(serbia|ukraine|turkey|albania|bosnia|montenegro|macedonia|moldova|georgia|armenia)\b/.test(l);
  // a region word ("Europe", "EMEA") counts as open to Europe only when no other country or city is named, or when the role is remote
  const wide = REGION_WIDE.some((k) => l.includes(k)) && (remote || (!otherEu && !US_RE.test(l)));
  if (home) return a.loc_nl === false ? ["fail", `Netherlands not selected: ${loc}`] : ["ok", loc];
  if (wide) return a.loc_remote === false && remote ? ["fail", `remote not selected: ${loc}`] : ["ok", loc];
  if (otherEu)
    return a.loc_eu ? ["check", `Europe outside NL: you would move; employer-of-record or permit unverified (${loc})`] : ["fail", `Europe outside NL not selected: ${loc}`];
  if (l.replace(/[^a-z]/g, "") === "remote" || l.replace(/[^a-z]/g, "") === "remoteremote") {
    if (/(must|should) (be )?(located|based|reside) in the (u\.?s|united states|uk|canada)/.test((descHead || "").toLowerCase())) return ["fail", "remote but posting requires US/UK/CA residence"];
    return a.loc_remote === false ? ["fail", "remote not selected"] : ["check", "remote, region unspecified"];
  }
  if (US_RE.test(l)) {
    // remote inside the US is still a US job (time zone, payroll): it needs the US answer, not the Europe-remote one
    return a.loc_us ? ["check", `US on-site/hybrid: you would move from Amsterdam (${loc})`] : ["fail", `US on-site not selected: ${loc}`];
  }
  return a.loc_world ? ["check", `Elsewhere: you would move; authorized only in NL/US, visa needed (${loc})`] : ["fail", `outside NL, EU and US, not selected: ${loc}`];
}
// score the posting against the profile. mode "analyze" never drops a posting: it reports the fit and what the gates would say
function scoreJob(job, ctx = DEFAULT_CTX, mode = "rank") {
  const title = (job.title || "").toLowerCase(), desc = job.desc || "";
  const why = [], flags = [], drops = [];
  let pen = 0;
  const drop = (reason) => { drops.push(reason); };
  if (ABSOLUTE_EXCLUDE.some((x) => title.includes(x))) drop("role family below target or not your lane");
  const famOn = [...ctx.fam].filter((k) => has(title, FAMILIES[k]).length);
  const famOff = Object.keys(FAMILIES).filter((k) => !ctx.fam.has(k) && has(title, FAMILIES[k]).length);
  const medium = has(title, TITLE_MEDIUM);
  const soft = TITLE_EXCLUDE_SOFT.some((x) => title.includes(x));
  if (soft && !famOn.length) drop("role family excluded by title");
  if (!famOn.length && famOff.length) drop("family switched off in your preferences: " + famOff[0].replace("fam_", ""));
  if (!famOn.length && !medium.length) drop("title not in your role families");
  const [gate, locNote] = locationGate(job.location, desc.slice(0, 3000), ctx);
  if (gate === "fail") drop(locNote);
  if (gate === "check" && locNote === "location missing" && mode !== "analyze") drop("no location in the posting; it cannot be placed against your preferences");
  else if (gate === "check") { flags.push("LOCATION: " + locNote); pen += /^(Elsewhere|Europe)/.test(locNote) ? 15 : 10; }
  const cl = clustersIn(desc, job.title);
  if (!famOn.length && cl.size < 2) drop("generic title and thin evidence in the posting");
  if (famOn.length && !cl.size) pen += 15;
  const tScore = famOn.length ? 40 : (medium.length >= 2 || medium.includes("research")) ? 20 : 12;
  const eScore = Math.min(45, 9 * cl.size);
  const uniqA = [...cl].some((c) => CORE.has(c)) && [...cl].some((c) => FRONTIER.has(c));
  const uniqB = [...cl].some((c) => CORE.has(c)) && [...cl].some((c) => DATA_SIDE.has(c));
  if (famOn.length) why.push("title in your lane: " + famOn.slice(0, 2).map((k) => k.replace("fam_", "")).join(", ")); else why.push("generic title: " + medium.slice(0, 2).join(", "));
  why.push(cl.size ? "evidence in the posting: " + [...cl].sort().join(", ") : "no matching evidence in the posting text");
  if (uniqA) why.push("uncommon intersection: research-program or policy-research management + AI or research-integrity systems");
  else if (uniqB) why.push("uncommon intersection: public-policy or planning expertise + data and analytics");
  let score = tScore + eScore + (uniqA || uniqB ? 15 : 0);
  const outcomeDelta = Math.max(-12, Math.min(12, scoreFeatures(famOn, cl).reduce((sum, feature) => {
    const weight = Number(ctx.outcomeWeights && ctx.outcomeWeights[feature]);
    return sum + (Number.isFinite(weight) ? weight : 0);
  }, 0)));
  score += outcomeDelta;
  if (outcomeDelta > 0) why.push("past application outcomes favor these posting signals");
  else if (outcomeDelta < 0) why.push("past application outcomes weigh these posting signals less");
  const senior = SENIOR_RE.test(job.title || "");
  if (!senior) { if (ctx.a.lvl_mid === false) drop("below senior level (preference)"); else if (ctx.a.lvl_mid !== true) { pen += 6; why.push("no seniority marker in the title"); } }
  if (ctx.a.lvl_manage === false && MANAGE_RE.test(job.title || "")) pen += 15;
  if (ctx.a.type_contract === false && /\b(contract|freelance|interim|temporary)\b/.test(title)) drop("contract work not selected");
  const tk = tokens(job.title);
  if (tk.some((t) => ctx.learned.boost.has(t))) { score += 10; why.push("looks like roles you liked: " + tk.filter((t) => ctx.learned.boost.has(t)).slice(0, 2).join(", ")); }
  if (tk.some((t) => ctx.learned.block.has(t))) { pen += 15; why.push("looks like roles you rejected: " + tk.filter((t) => ctx.learned.block.has(t)).slice(0, 2).join(", ")); }
  const low = desc.toLowerCase();
  if (/ph\.?d\.?[^.\n]{0,40}(required|must)|(required|must)[^.\n]{0,40}ph\.?d/.test(low)) { flags.push("DEGREE: PhD appears required; you hold an M.S."); score -= 20; }
  if (/security clearance|u\.?s\.? citizen/.test(low)) flags.push("AUTH: clearance/citizenship language present");
  if (/right to work|work authori[sz]ation|visa sponsorship|eligible to work/.test(low) && gate === "check" && !/^US/.test(locNote)) flags.push("AUTH: work-authorization language; you are authorized in NL and US only");
  const lang = [...low.matchAll(/(?:fluen\w*|proficien\w*|native)[^.\n]{0,30}\b(german|dutch|french|spanish|italian|japanese|korean|mandarin|portuguese|hindi)/g)].map((m) => m[1]);
  if (lang.length) flags.push("LANGUAGE: posting asks for " + [...new Set(lang)].sort().join(", ") + "; you list English only");
  const yrs = [...low.matchAll(/(\d{1,2})\+?\s*(?:or more )?years/g)].map((m) => +m[1]);
  if (yrs.length && Math.max(...yrs) > 22) flags.push(`YEARS: asks ${Math.max(...yrs)}+ years`);
  if (!famOn.length) score = Math.min(score, 49);   // a generic title never outranks a title in your lane
  const fit = score;
  score -= pen;
  const tier = score >= 70 && cl.size ? "A" : score >= 35 ? "B" : "C";
  return { fit, score, tier, clusters: [...cl].sort(), unique: uniqA || uniqB, why, flags, drops, gate, locNote, families: famOn };
}
function evaluate(job, ctx = DEFAULT_CTX) {
  const r = scoreJob(job, ctx);
  if (r.drops.length) return { status: "excluded", reason: r.drops[0] };
  return { status: "ok", score: r.score, tier: r.tier, clusters: r.clusters, unique: r.unique, why: r.why, flags: r.flags };
}
function rank(jobs, ctx = DEFAULT_CTX) {
  const ok = [], excl = {};
  for (const j of jobs) {
    const r = evaluate(j, ctx);
    if (r.status === "ok" && r.tier !== "C") ok.push({ ...j, match: r });
    else { const k = (r.reason || "score below threshold").replace(/:.*/, ""); excl[k] = (excl[k] || 0) + 1; }
  }
  ok.sort((a, b) => b.match.score - a.match.score);
  return [ok, excl];
}

// ------------------------------------------------------------------ tailoring + verification (port of tailor.py)
const FACTS = Object.fromEntries(LEDGER.facts.map((f) => [f.id, f]));
const HEADS = Object.fromEntries(LEDGER.headlines.map((h) => [h.id, h]));
const P = LEDGER.person;
const STATIC = new Set(["Hello,", "Best regards,", "## Experience highlights", "## Credentials", LEDGER.closing, P.name]);
const FORBIDDEN = ["kubernetes", "tensorflow", "pytorch", "java", "rust", "golang", "aws", "azure", "gcp", "spark", "docker", "react", "tableau", "power bi", "snowflake", "databricks", "scrum master", "six sigma", "cissp", "phd", "ph.d", "mba", "cfa", "security clearance", "fluent"];
const tag = (line, t) => `${line} <!--${t}-->`;

function pickFacts(clusters, k) {
  const cl = new Set(clusters), scored = [];
  LEDGER.facts.forEach((f, i) => {
    if (f.id === "F16" || f.id === "F17") return;
    const s = f.cluster.filter((c) => cl.has(c)).length;
    if (s) scored.push([-s, i, f]);
  });
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const picked = scored.slice(0, k).map((x) => x[2]);
  for (const id of ["F01", "F03", "F12", "F15", "F06", "F10"]) { if (picked.length >= k) break; if (!picked.some((f) => f.id === id)) picked.push(FACTS[id]); }   // postings outside the old clusters still get verified facts
  return picked;
}
function headline(clusters) {
  const cl = new Set(clusters);
  const a = ["research_mgmt"].filter((c) => cl.has(c)).length + ["federal", "policy_research", "transport_modeling"].filter((c) => cl.has(c)).length;
  const b = HEADS.H2.cluster.filter((c) => cl.has(c)).length;
  const c3 = HEADS.H3.cluster.filter((c) => cl.has(c)).length;
  if (c3 > a && c3 > b) return HEADS.H3;
  return a > b ? HEADS.H1 : HEADS.H2;
}
function jobTerms(job, clusters, n = 2) {
  const d = (job.desc + " " + job.title).toLowerCase(), out = [];
  for (const c of clusters) {
    for (const kw of CLUSTER_KW[c] || []) {
      const k = kw.trim();
      if (d.includes(k) && !out.includes(k) && k.length > 4) { out.push(k); break; }
    }
    if (out.length >= n) break;
  }
  return out;
}
function buildResume(job, m) {
  const facts = pickFacts(m.clusters, 5), h = headline(m.clusters);
  const L = [tag("# " + P.name, "P"), tag(`${P.location} | ${P.email} | ${P.links.site} | ${P.links.linkedin}`, "P"), tag(`Earlier work is published under ${P.also_published_as}.`, "P"), "", tag(h.text, "H:" + h.id), "", tag("## Experience highlights", "S")];
  for (const f of facts) L.push(tag("- " + f.text, "F:" + f.id));
  L.push("", tag("## Credentials", "S"), tag("- " + FACTS.F16.text, "F:F16"), tag("- " + FACTS.F17.text, "F:F17"));
  return L.join("\n") + "\n";
}
function buildNote(job, m) {
  const facts = pickFacts(m.clusters, 3), terms = jobTerms(job, m.clusters);
  const L = [tag("Hello,", "S"), "", tag(`I am applying for the ${job.title} role at ${job.company}.`, "J:title")];
  if (terms.length) L.push(tag("The posting mentions " + terms.map((t) => `"${t}"`).join(" and ") + ", which is the work I have done:", "J:terms:" + terms.join("|")));
  L.push("");
  for (const f of facts) L.push(tag(f.pitch, "F:" + f.id));
  L.push("", tag(LEDGER.closing, "S"), "", tag("Best regards,", "S"), tag(P.name, "S"));
  return L.join("\n") + "\n";
}
const nums = (s) => new Set(String(s).match(/\d[\d,.]*\+?/g) || []);
const LEDGER_LOW = JSON.stringify(LEDGER).toLowerCase();
function verify(doc, job) {
  const bad = [];
  const allowed = new Set();
  const addAll = (set) => set.forEach((x) => allowed.add(x));
  for (const f of LEDGER.facts) { addAll(nums(f.text)); addAll(nums(f.pitch)); }
  for (const h of LEDGER.headlines) addAll(nums(h.text));
  addAll(nums(JSON.stringify(P))); addAll(nums(job.title)); addAll(nums(job.company));
  const allowedTrim = new Set([...allowed].map((x) => x.replace(/[.,]+$/, "")));
  const jd = (job.desc + " " + job.title).toLowerCase();
  doc.split("\n").forEach((raw, i) => {
    const n = i + 1;
    if (!raw.trim()) return;
    const m = raw.match(/^(.*?) <!--(.+)-->$/);
    if (!m) { bad.push(`L${n}: untagged line: ${raw.slice(0, 60)}`); return; }
    const text = m[1], t = m[2], kind = t.split(":")[0];
    if (kind === "F") {
      const f = FACTS[t.split(":")[1]], body = text.startsWith("- ") ? text.slice(2) : text;
      if (!f || (body !== f.text && body !== f.pitch)) bad.push(`L${n}: text does not equal ledger fact ${t}`);
    } else if (kind === "H") {
      const h = HEADS[t.split(":")[1]];
      if (!h || text !== h.text) bad.push(`L${n}: headline differs from ledger ${t}`);
    } else if (kind === "S") {
      if (!STATIC.has(text)) bad.push(`L${n}: static line not allowlisted: ${text.slice(0, 60)}`);
    } else if (kind === "P") {
      if (!(text.startsWith("# " + P.name) || text.includes(P.email) || text.startsWith("Earlier work is published under"))) bad.push(`L${n}: person line not from ledger`);
    } else if (kind === "J") {
      if (t === "J:title") { if (text !== `I am applying for the ${job.title} role at ${job.company}.`) bad.push(`L${n}: job line altered`); }
      else for (const q of text.matchAll(/"([^"]+)"/g)) if (!jd.includes(q[1].toLowerCase())) bad.push(`L${n}: quoted term not in posting: ${q[1]}`);
    } else bad.push(`L${n}: unknown tag ${t}`);
  });
  const low = doc.toLowerCase(), ct = (job.company + " " + job.title).toLowerCase();
  for (const term of FORBIDDEN) {
    if (new RegExp("\\b" + escRe(term) + "\\b").test(low) && !ct.includes(term) && !LEDGER_LOW.includes(term)) bad.push(`forbidden unclaimed term in output: ${term}`);
  }
  for (const num of nums(doc.replace(/<!--.*?-->/g, ""))) if (!allowed.has(num) && !allowedTrim.has(num.replace(/[.,]+$/, ""))) bad.push(`number not in ledger: ${num}`);
  return bad;
}
const stripTags = (s) => s.replace(/ <!--.*?-->$/gm, "");

// ------------------------------------------------------------------ pipeline
async function pool(tasks, n) {
  const res = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < tasks.length) { const k = i++; res[k] = await tasks[k](); } }));
  return res;
}
async function collectAndRank(ctx, onlyGroups) {
  const tasks = [], feedsList = [];
  for (const [kind, args] of Object.entries(BOARDS)) {
    if (onlyGroups && !onlyGroups.includes(kind)) continue;
    for (const a of kind === "arbeitnow" ? [true] : args) {
      const feed = kind === "arbeitnow" ? "arbeitnow" : `${kind}:${a}`;
      feedsList.push(feed);
      tasks.push(async () => {
        for (let attempt = 1; attempt <= 2; attempt++) {
          try { return { feed, jobs: await FETCHERS[kind](a) }; }
          catch (e) { if (attempt === 2) return { feed, err: `${feed}: ${e.message}` }; await new Promise((r) => setTimeout(r, 1500)); }
        }
      });
    }
  }
  const kept = [], errors = [], excl = {}, feedResults = [];
  let fetched = 0;
  // each feed is ranked as soon as it is parsed so only passing jobs stay in memory
  await pool(tasks.map((t) => async () => {
    const r = await t();
    if (r.err) { errors.push(r.err); feedResults.push({ feed: r.feed, ok: false, error: r.err }); return; }
    for (const jb of r.jobs) jb.company = DISPLAY[jb.company] || jb.company;
    fetched += r.jobs.length;
    feedResults.push({ feed: r.feed, ok: true, count: r.jobs.length });
    const [ok, ex] = rank(r.jobs, ctx);
    for (const [k, v] of Object.entries(ex)) excl[k] = (excl[k] || 0) + v;
    kept.push(...ok);
  }), 3);
  kept.sort((a, b) => b.match.score - a.match.score);
  return { kept, errors, excl, fetched, feeds: feedsList.length, feedResults };
}
// JOBSEARCH-LLM-RERANK-1: reorder-only re-rank of the top passing postings.
// The model may only reorder and add one sentence of reason per posting; it never writes resume or note text
// (drafts are still assembled from the ledger afterwards and re-verified). A failed, malformed or empty answer
// leaves the deterministic order untouched. The call goes through the qnfo-ai service binding with caller
// qnfo-jobsearch, and is skipped when it would cost more than the cheapest Workers AI model (BUDGET-SOFT-ROUTE-1).
async function llmRerank(env, kept) {
  try {
    if (!env.AI || !kept.length) return kept;          // no binding: keep deterministic order
    const top = kept.slice(0, 25), rest = kept.slice(25);
    const items = top.map((j, i) => ({ index: i, id: j.id, title: j.title, company: j.company, location: j.location || "", score: j.match.score, reasons: (j.match.why || []).slice(0, 5) }));
    const r = await env.AI.fetch("https://qnfo-ai/infer", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        caller: "qnfo-jobsearch",
        task: "rerank",
        model: "cheapest",                              // BUDGET-SOFT-ROUTE-1: never costlier than the cheapest Workers AI model
        budget_guard: "skip this call if it would cost more than the cheapest Workers AI model",
        prompt: "Order the following job postings by fit to the candidate's claim ledger. You may ONLY reorder these postings and give one short sentence of reason per posting. Do not write, rewrite or suggest any resume, cover letter or note text. Answer as JSON: {\"order\":[ids in best-first order],\"reasons\":{\"<id>\":\"one sentence\"}}.",
        items,
      }),
    });
    if (!r.ok) return kept;                             // binding error: keep deterministic order
    const out = await r.json();
    if (!out || out.skipped_for_budget || !Array.isArray(out.order) || !out.order.length) return kept;
    const by = new Map(top.map((j) => [String(j.id), j]));
    const seen = new Set(), next = [];
    for (const id of out.order) {
      const j = by.get(String(id));
      if (j && !seen.has(j.id)) { seen.add(j.id); next.push(j); }
    }
    if (next.length !== top.length) return kept;        // incomplete/unknown ids: do not trust the reorder
    for (const j of next) {                             // annotate only; reasons land in why_json prefixed LLM:
      const rsn = out.reasons && out.reasons[j.id];
      if (typeof rsn === "string" && rsn.trim()) j.match.why = (j.match.why || []).concat(["LLM: " + rsn.trim().replace(/\s+/g, " ").slice(0, 300)]);
    }
    return next.concat(rest);
  } catch (e) { logErr("llm-rerank", e); return kept; } // any failure: deterministic order stands
}
function artifactsFor(j) {
  const res = buildResume(j, j.match), note = buildNote(j, j.match);
  const v = verify(res, j).concat(verify(note, j));
  return v.length ? { verified: 0, blocked: v.join("; "), resume: null, note: null } : { verified: 1, blocked: null, resume: stripTags(res), note: stripTags(note) };
}
// ------------------------------------------------------------------ preferences, feedback, "check a job" (JOBSEARCH-PROFILE-1)
async function loadCtx(env) {
  await ensure(env);
  let answers = {};
  const row = await env.JOBS_DB.prepare("SELECT v FROM jobsearch_prefs WHERE k='survey'").first();
  if (row) { try { answers = JSON.parse(row.v) || {}; } catch (e) { logErr("prefs-parse", e); } }
  const fb = (await env.JOBS_DB.prepare("SELECT title, verdict FROM jobsearch_feedback ORDER BY id DESC LIMIT 500").all()).results;
  const applied = (await env.JOBS_DB.prepare(
    `SELECT m.tier, m.score, e.ts AS applied_at, e.note,
       EXISTS (SELECT 1 FROM jobsearch_events r WHERE r.match_id=e.match_id AND r.event IN ('replied','interview','offer') AND r.ts >= e.ts) AS replied
     FROM jobsearch_events e
     JOIN jobsearch_matches m ON m.id=e.match_id
     WHERE e.event='applied'
       AND e.id=(SELECT a.id FROM jobsearch_events a WHERE a.match_id=e.match_id AND a.event='applied' ORDER BY a.ts, a.id LIMIT 1)`
  ).all()).results;
  const outcomeRows = applied.flatMap((application) => {
    const snapshot = parseApplicationSnapshot(application.note);
    return snapshot ? [{ features: snapshot.features, applied_ms: Date.parse(application.applied_at), replied: !!application.replied }] : [];
  });
  return makeCtx(answers, fb, outcomeScoreWeights(outcomeRows));
}
async function getMeta(env, k) { const r = await env.JOBS_DB.prepare("SELECT v FROM jobsearch_meta WHERE k=?").bind(k).first(); return r ? r.v : null; }
async function addFeedback(env, title, company, verdict, source) {
  await env.JOBS_DB.prepare("INSERT INTO jobsearch_feedback (ts, title, company, verdict, source) VALUES (?1,?2,?3,?4,?5)").bind(new Date().toISOString(), String(title || "").slice(0, 200), String(company || "").slice(0, 120), verdict, source).run();
}
const TECH_TERMS = ["python", "sql", "r ", "tableau", "power bi", "looker", "aws", "azure", "gcp", "kubernetes", "docker", "spark", "snowflake", "dbt", "airflow", "salesforce", "jira", "sap", "workday", "java", "javascript", "typescript", "react", "golang", "rust", "c++", "scala", "stata", "spss", "sas", "arcgis", "qgis", "postgis", "terraform", "excel", "agile", "scrum", "prince2", "six sigma", "lean", "safe"];
const LEDGER_SKILLS = (LEDGER.skills || []).join(" | ").toLowerCase() + " | agile pmp";
function gapsFor(desc) {
  const d = " " + (desc || "").toLowerCase() + " ";
  const mentioned = TECH_TERMS.filter((t) => new RegExp("[^a-z]" + escRe(t.trim()) + "[^a-z]").test(d));
  const notInLedger = mentioned.filter((t) => !LEDGER_SKILLS.includes(t.trim()));
  const out = [];
  if (notInLedger.length) out.push("named in the posting but not in your ledger (add to the ledger if you have it): " + notInLedger.slice(0, 8).join(", "));
  const yrs = [...d.matchAll(/(\d{1,2})\+?\s*(?:or more )?years/g)].map((m) => +m[1]);
  if (yrs.length) out.push(`mentions ${Math.max(...yrs)} years of experience; your record spans ${new Date().getUTCFullYear() - Number(LEDGER.person.career_start)} years (since ${LEDGER.person.career_start})`);
  if (/ph\.?d/.test(d)) out.push("mentions a PhD; you hold an M.S. and a B.A.");
  if (/\bmba\b/.test(d)) out.push("mentions an MBA; not in your ledger");
  return out;
}
function jsonLdPosting(html) {
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data; try { data = JSON.parse(m[1]); } catch (e) { continue; }
    const stack = Array.isArray(data) ? [...data] : [data];
    while (stack.length) {
      const o = stack.shift();
      if (!o || typeof o !== "object") continue;
      if (o["@graph"]) stack.push(...(Array.isArray(o["@graph"]) ? o["@graph"] : [o["@graph"]]));
      const type = [].concat(o["@type"] || []).join(",");
      if (/JobPosting/i.test(type)) {
        const loc = [].concat(o.jobLocation || []).map((l) => (l && l.address ? [l.address.addressLocality, l.address.addressRegion, l.address.addressCountry && (l.address.addressCountry.name || l.address.addressCountry)].filter(Boolean).join(", ") : "")).filter(Boolean).join(" | ");
        const remote = /TELECOMMUTE/i.test(JSON.stringify(o.jobLocationType || "")) ? " (Remote)" : "";
        return { title: o.title || "", company: (o.hiringOrganization && (o.hiringOrganization.name || o.hiringOrganization)) || "", location: (loc + remote).trim(), desc: stripHtml(o.description || "") };
      }
    }
  }
  return null;
}
async function fetchPosting(rawUrl) {
  let u; try { u = new URL(rawUrl); } catch (e) { throw new Error("not a valid URL"); }
  if (u.protocol !== "https:") throw new Error("only https links are read");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname) || /^[\d.]+$/.test(u.hostname) || u.hostname.includes(":")) throw new Error("that host is not a public website");
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 15000);
  try {
    const r = await fetch(u.toString(), { headers: { "user-agent": "Mozilla/5.0 (compatible; qnfo-jobsearch/1.3; +https://qnfo.org)", accept: "text/html,application/xhtml+xml,application/json" }, signal: ac.signal, redirect: "follow" });
    if (!r.ok) throw new Error("the page answered HTTP " + r.status + "; paste the posting text instead");
    const html = (await r.text()).slice(0, 2000000);
    const ld = jsonLdPosting(html);
    if (ld && ld.desc) return { ...ld, url: u.toString() };
    const title = (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || html.match(/<title[^>]*>([^<]+)/i) || [])[1] || "";
    const company = (html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i) || [])[1] || u.hostname.replace(/^www\./, "");
    const body = stripHtml(html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")).slice(0, 30000);
    if (body.length < 400) throw new Error("the page has no readable text (it is probably built in the browser); paste the posting text instead");
    return { title: decodeEntities(title).trim(), company, location: "", desc: body, url: u.toString() };
  } finally { clearTimeout(t); }
}
async function analyzeJob(env, body) {
  const ctx = await loadCtx(env);
  let p = { title: body.title || "", company: body.company || "", location: body.location || "", desc: "", url: "" };
  const input = String(body.input || body.text || body.url || "").trim();
  if (!input) throw Object.assign(new Error("paste a job link or the posting text"), { status: 400 });
  if (/^https?:\/\/\S+$/.test(input)) { p = { ...p, ...(await fetchPosting(input)) }; if (body.title) p.title = body.title; if (body.company) p.company = body.company; if (body.location) p.location = body.location; }
  else { p.desc = input.slice(0, 40000); if (!p.location) { const lm = input.match(/\b(?:location|locatie|werklocatie)\s*:\s*([^\n.;|]{2,90})/i); if (lm) p.location = lm[1].trim(); } if (!p.title) { const first = (input.split("\n").find((l) => l.trim()) || "").trim(); p.title = (first.length > 80 ? first.split(/[.:;|]\s/)[0] : first).slice(0, 140); } }
  if (!p.title) throw Object.assign(new Error("could not find the job title; add it in the title box"), { status: 400 });
  const job = { id: "check:" + (await sha256hex(p.title + p.company + p.desc.slice(0, 200))).slice(0, 12), source: "check", company: p.company || "the employer", title: p.title, location: p.location, url: p.url, desc: p.desc };
  const sc = scoreJob(job, ctx, "analyze");
  const verdict = sc.fit >= 70 ? "strong fit" : sc.fit >= 45 ? "good fit" : sc.fit >= 35 ? "possible fit" : "weak fit";
  const strengths = pickFacts(sc.clusters, 5).map((f) => ({ id: f.id, text: f.text }));
  const m = { clusters: sc.clusters };
  const res = buildResume(job, m), note = buildNote(job, m), bad = verify(res, job).concat(verify(note, job));
  return {
    title: job.title, company: job.company, location: job.location || "(not found; judged on the text)", url: job.url,
    verdict, fit_score: sc.fit, score_after_preferences: sc.score,
    would_appear_in_your_search: sc.drops.length ? false : sc.tier !== "C",
    why_not_in_search: sc.drops.length ? sc.drops : sc.tier === "C" ? ["score below the cut after location and level adjustments"] : [],
    why: sc.why, flags: sc.flags, strengths, gaps: gapsFor(job.desc),
    draft: bad.length ? { blocked: bad.join("; ") } : { resume: stripTags(res), note: stripTags(note) },
  };
}
async function run(env) {
  await ensure(env);
  const t0 = Date.now(), started = iso(t0);
  // self-heal: a run that never finished (isolate killed, D1 error) is closed by the next run instead of reading as "running" forever
  await env.JOBS_DB.prepare("UPDATE jobsearch_runs SET finished_at=?1, errors_json=?2 WHERE finished_at IS NULL AND started_at < ?3")
    .bind(started, JSON.stringify(["run did not finish: closed by the next run"]), iso(t0 - 15 * 60 * 1000)).run();
  const rid = (await env.JOBS_DB.prepare("INSERT INTO jobsearch_runs (started_at) VALUES (?)").bind(started).run()).meta.last_row_id;
  try {
    const ctx = await loadCtx(env);
    const prefsHash = await sha256hex(JSON.stringify([ctx.a, [...ctx.learned.boost].sort(), [...ctx.learned.block].sort()]));
    const prefsChanged = (await getMeta(env, "prefs_hash")) !== prefsHash;
    let { kept, errors, excl, fetched, feeds, feedResults } = await collectAndRank(ctx);
    kept = await llmRerank(env, kept);   // reorder-only AI pass over the top 25, before the per-company cap
    const per = {}, seen = new Set(), picked = [];
    for (const j of kept) {
      const dk = dedupeKey(j);
      if (seen.has(dk)) continue;               // the same posting listed on two boards
      seen.add(dk);
      if ((per[j.company] || 0) < 3) { per[j.company] = (per[j.company] || 0) + 1; picked.push(j); }
    }
    let blocked = 0;
    const now = new Date().toISOString();
    const stmts = [];
    for (const j of picked.slice(0, 40)) {
      const a = artifactsFor(j);
      if (!a.verified) blocked++;
      stmts.push(env.JOBS_DB.prepare(
        `INSERT INTO jobsearch_matches (id, first_seen, last_seen, run_id, company, title, location, url, tier, score, why_json, flags_json, verified, blocked_reason, resume_md, note_md, status)
         VALUES (?1,?2,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,'pending_owner_approval')
         ON CONFLICT(id) DO UPDATE SET last_seen=?2, run_id=?3, tier=?8, score=?9, why_json=?10, flags_json=?11, verified=?12, blocked_reason=?13, resume_md=?14, note_md=?15, title=?5, location=?6, url=?7`
      ).bind(j.id, now, rid, j.company, j.title, j.location, j.url, j.match.tier, j.match.score, JSON.stringify(j.match.why || []), JSON.stringify(j.match.flags || []), a.verified, a.blocked, a.resume, a.note));
    }
    // feed health: success resets the streak, failure extends it (detector fm-jobsearch-feed-down reads 3 in a row)
    for (const f of feedResults) {
      stmts.push(f.ok
        ? env.JOBS_DB.prepare("INSERT INTO jobsearch_feeds (feed, last_ok_at, last_count, consecutive_fail) VALUES (?1,?2,?3,0) ON CONFLICT(feed) DO UPDATE SET last_ok_at=?2, last_count=?3, consecutive_fail=0, last_error=NULL").bind(f.feed, now, f.count)
        : env.JOBS_DB.prepare("INSERT INTO jobsearch_feeds (feed, last_error, last_error_at, consecutive_fail) VALUES (?1,?2,?3,1) ON CONFLICT(feed) DO UPDATE SET last_error=?2, last_error_at=?3, consecutive_fail=consecutive_fail+1").bind(f.feed, f.error.slice(0, 300), now));
    }
    // lifecycle: a pending match whose feed answered this run but did not list it for 48 h is gone upstream or no longer matches
    const cutoff = iso(prefsChanged ? t0 : t0 - 48 * 3600 * 1000), prefixes = new Set();   // new preferences retire what no longer fits at once
    const okFeeds = new Set(feedResults.filter((f) => f.ok).map((f) => f.feed));
    for (const f of feedResults) {
      if (!f.ok) continue;
      const kind0 = f.feed.split(":")[0];
      if (["remotive", "muse", "jobicy"].includes(kind0) && !BOARDS[kind0].every((c) => okFeeds.has(kind0 + ":" + c))) continue;   // a grouped source expires nothing unless every part answered
      prefixes.add(feedPrefix(f.feed));
    }
    for (const pre of prefixes) stmts.push(env.JOBS_DB.prepare("UPDATE jobsearch_matches SET status='expired', decided_at=?3 WHERE status='pending_owner_approval' AND id LIKE ?1 AND last_seen < ?2").bind(pre + "%", cutoff, now));
    // retention
    stmts.push(env.JOBS_DB.prepare("DELETE FROM jobsearch_matches WHERE status IN ('expired','rejected') AND last_seen < ?").bind(iso(t0 - 90 * 86400000)));
    stmts.push(env.JOBS_DB.prepare("DELETE FROM jobsearch_codes WHERE created_ms < ?").bind(t0 - 86400000));
    stmts.push(env.JOBS_DB.prepare("DELETE FROM jobsearch_sessions WHERE expires_ms < ?").bind(t0 - 86400000));
    await env.JOBS_DB.batch(stmts);
    await env.JOBS_DB.prepare("UPDATE jobsearch_runs SET finished_at=?, feeds=?, fetched=?, passed=?, stored=?, blocked=?, excluded_json=?, errors_json=? WHERE id=?")
      .bind(new Date().toISOString(), feeds, fetched, kept.length, Math.min(picked.length, 40), blocked, JSON.stringify(excl), JSON.stringify(errors), rid).run();
    const nrCut = iso(t0 - NO_REPLY_DAYS * 86400000), nrWhere = "status='applied' AND id IN (SELECT match_id FROM jobsearch_events GROUP BY match_id HAVING MIN(CASE WHEN event='applied' THEN ts END) < ?1) AND id NOT IN (SELECT match_id FROM jobsearch_events WHERE event IN ('replied','interview','offer'))";
    await env.JOBS_DB.batch([
      env.JOBS_DB.prepare("INSERT INTO jobsearch_events (match_id, event, ts, note) SELECT id, 'no_reply', ?2, 'auto: no reply in 21 days' FROM jobsearch_matches WHERE " + nrWhere).bind(nrCut, new Date().toISOString()),
      env.JOBS_DB.prepare("UPDATE jobsearch_matches SET status='no_reply', decided_at=?2 WHERE " + nrWhere).bind(nrCut, new Date().toISOString()),
    ]);
    try { await writeOutcomeMetrics(env, await outcomes(env)); } catch (e) { logErr("outcome-metrics", e); }
    await setMeta(env, "prefs_hash", prefsHash);
    await setMeta(env, "ledger_verified_on", LEDGER_VERIFIED_ON);
    await setMeta(env, "ledger_open_questions", (LEDGER.unverified_needs_owner || []).length);
    await setMeta(env, "worker_version", VERSION);
    await setMeta(env, "email_binding", env.EMAIL ? "1" : "0");
    log("run-ok", { run_id: rid, fetched, passed: kept.length, blocked, feed_errors: errors.length, ms: Date.now() - t0 });
    return { run_id: rid, feeds, fetched, passed: kept.length, stored: Math.min(picked.length, 40), blocked, errors };
  } catch (e) {
    logErr("run-failed", e);
    await env.JOBS_DB.prepare("UPDATE jobsearch_runs SET finished_at=?, errors_json=? WHERE id=?").bind(new Date().toISOString(), JSON.stringify(["run failed: " + String((e && e.message) || e).slice(0, 300)]), rid).run().catch((e2) => logErr("run-failed-record", e2));
    throw e;
  }
}

// ------------------------------------------------------------------ http
const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" } });
const parseRow = (r) => (r ? { ...r, why: JSON.parse(r.why_json || "[]"), flags: JSON.parse(r.flags_json || "[]"), why_json: undefined, flags_json: undefined } : r);
async function tokenOk(request, env) {
  const t = request.headers.get("x-loop-token") || "";
  if (!env.LOOP_TOKEN) return false;
  const [expected, actual] = await Promise.all([sha256hex(env.LOOP_TOKEN), sha256hex(t)]);
  return constEq(expected, actual);
}
// ------------------------------------------------------------------ outcomes (JOBSEARCH-OUTCOME-1): does the matching help?
// Every status change is an append-only event. The outcome measure is the reply rate of applications old enough to have had a reply
// (21 days): replies, interviews and offers per application. Under MIN_N mature applications it is unknown and nothing is written.
const OUTCOME_STATUSES = ["applied", "replied", "interview", "offer", "no_reply"];
const ALL_STATUSES = ["pending_owner_approval", "approved", "rejected", ...OUTCOME_STATUSES];
const REPLY_EVENTS = ["replied", "interview", "offer"], NO_REPLY_DAYS = 21, MIN_N = 10;
async function outcomes(env) {
  await ensure(env);
  const now = Date.now();
  const matches = (await env.JOBS_DB.prepare("SELECT id, tier, score, status FROM jobsearch_matches").all()).results;
  const events = (await env.JOBS_DB.prepare("SELECT match_id, event, ts, note FROM jobsearch_events ORDER BY ts").all()).results;
  const by = {};
  for (const e of events) { (by[e.match_id] = by[e.match_id] || []).push(e); }
  const rows = matches.map((m) => {
    const ev = by[m.id] || [], has = (k) => ev.some((e) => e.event === k);
    const applied = ev.find((e) => e.event === "applied"), snapshot = parseApplicationSnapshot(applied && applied.note);
    return { tier: snapshot ? snapshot.tier : m.tier, score: snapshot ? snapshot.score : m.score, approved: has("approved") || has("applied"), applied: !!applied, applied_ms: applied ? Date.parse(applied.ts) : null,
      replied: REPLY_EVENTS.some(has), interview: has("interview") || has("offer"), offer: has("offer") };
  });
  const funnel = (list) => ({ matches: list.length, approved: list.filter((r) => r.approved).length, applied: list.filter((r) => r.applied).length, replied: list.filter((r) => r.replied).length, interview: list.filter((r) => r.interview).length, offer: list.filter((r) => r.offer).length });
  const mature = rows.filter((r) => r.applied && r.applied_ms <= now - NO_REPLY_DAYS * 86400000 && r.applied_ms >= now - 90 * 86400000);
  const rate = (list, k) => (list.length >= MIN_N ? +(list.filter((r) => r[k]).length / list.length).toFixed(4) : null);
  const tiers = {};
  for (const t of ["A", "B"]) { const l = mature.filter((r) => r.tier === t); tiers[t] = { mature_applied: l.length, reply_rate: rate(l, "replied") }; }
  return {
    funnel: funnel(rows), by_tier: { A: funnel(rows.filter((r) => r.tier === "A")), B: funnel(rows.filter((r) => r.tier === "B")) },
    mature_applied_90d: mature.length, min_mature_for_rate: MIN_N,
    reply_rate_90d: rate(mature, "replied"), interview_rate_90d: rate(mature, "interview"),
    applied_30d: rows.filter((r) => r.applied && r.applied_ms >= now - 30 * 86400000).length,
    reply_rate_by_tier: tiers,
    reading: mature.length < MIN_N ? `unknown: ${mature.length} application(s) old enough to have had a reply, ${MIN_N} needed` : "measured",
  };
}
async function writeOutcomeMetrics(env, o) {
  const put = async (metric, value) => { if (value === null || value === undefined) return; await env.JOBS_DB.prepare("UPDATE metric_registry SET last_value = ?1, last_refreshed = ?2, state = 'MEASURED' WHERE metric = ?3").bind(String(value), new Date().toISOString(), metric).run(); };
  await put("jobsearch_reply_rate_90d", o.reply_rate_90d);
  await put("jobsearch_interview_rate_90d", o.interview_rate_90d);
  await put("jobsearch_applied_30d", o.applied_30d);
}
async function ownerSession(request, env) {
  try {
    const tok = (await tokenOk(request, env)) ? "loop" : "";
    if (tok) return { kind: "loop-token" };
    const c = /(?:^|;\s*)jobs_session=([0-9a-f]{64})/.exec(request.headers.get("cookie") || "");
    const b = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get("authorization") || "");
    const raw = (c && c[1]) || (b && b[1]);
    if (!raw) return null;
    await ensure(env);
    const row = await env.JOBS_DB.prepare("SELECT expires_ms FROM jobsearch_sessions WHERE token_hash=?1 AND revoked=0").bind(await sha256hex(raw)).first();
    return row && Number(row.expires_ms) > Date.now() ? { kind: "session", hash: await sha256hex(raw) } : null;
  } catch (e) { logErr("session-check", e); return null; }
}
async function authRequest(env) {
  if (!env.EMAIL) return [503, { error: "e-mail sign-in is not available: the EMAIL service binding is missing" }];
  await ensure(env);
  const now = Date.now();
  // The request route is public, so the cap must not let a stranger lock the owner out: it is generous (6 an hour), the answer says when to retry,
  // and a code already e-mailed stays valid for 15 minutes whatever the cap says (verify accepts any unexpired code).
  const rec = await env.JOBS_DB.prepare("SELECT COUNT(*) AS n, MIN(created_ms) AS first, MAX(created_ms) AS last FROM jobsearch_codes WHERE created_ms > ?").bind(now - 3600000).first();
  if (Number(rec.n) >= CODE_MAX_PER_HOUR) {
    const retry = Math.max(1, Math.ceil((Number(rec.first) + 3600000 - now) / 60000));
    return [429, { error: `code limit reached; a new code can be sent in ${retry} min. A code e-mailed in the last 15 min still works: enter it.`, retry_after_minutes: retry, enter_existing_code: true }];
  }
  if (rec.last && now - Number(rec.last) < CODE_MIN_GAP_MS) return [200, { ok: true, sent: false, note: "a code was sent less than a minute ago; check " + maskedOwner() }];
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
  const salt = randHex(8);
  await env.JOBS_DB.prepare("INSERT INTO jobsearch_codes (code_hash, salt, created_ms, expires_ms) VALUES (?1,?2,?3,?4)").bind(await sha256hex(salt + code), salt, now, now + CODE_MS).run();
  try {
    const r = await env.EMAIL.fetch("https://qnfo-email/send", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: OWNER_EMAIL, subject: "Job matches sign-in code", body: `Your sign-in code for the job matches page is ${code}. It expires in 15 minutes. If you did not ask for it, ignore this message.`, notify: true }) });
    if (!r.ok) { logErr("auth-mail", "send HTTP " + r.status); return [502, { error: "the code could not be e-mailed (HTTP " + r.status + ")" }]; }
  } catch (e) { logErr("auth-mail", e); return [502, { error: "the code could not be e-mailed" }]; }
  return [200, { ok: true, sent: true, to: maskedOwner(), expires_minutes: 15 }];
}
async function authVerify(env, code) {
  await ensure(env);
  code = String(code || "").trim();
  if (!/^\d{6}$/.test(code)) return [400, { error: "enter the 6-digit code" }];
  const now = Date.now();
  // any unexpired, unused code that has not used up its tries is a candidate (the owner may hold two e-mails)
  const rows = (await env.JOBS_DB.prepare("SELECT id, code_hash, salt, tries FROM jobsearch_codes WHERE used=0 AND expires_ms > ?1 AND tries < ?2 ORDER BY id DESC LIMIT 6").bind(now, CODE_MAX_TRIES).all()).results;
  if (!rows.length) return [401, { error: "no valid code; request a new one" }];
  let hit = null;
  for (const r of rows) if (constEq(await sha256hex(r.salt + code), r.code_hash)) hit = r;
  if (!hit) {
    await env.JOBS_DB.prepare("UPDATE jobsearch_codes SET tries=tries+1 WHERE used=0 AND expires_ms > ?1 AND tries < ?2").bind(now, CODE_MAX_TRIES).run();
    const left = CODE_MAX_TRIES - 1 - Math.max(...rows.map((r) => Number(r.tries)));
    return left <= 0 ? [429, { error: "too many wrong attempts; request a new code" }] : [401, { error: "wrong code" }];
  }
  await env.JOBS_DB.prepare("UPDATE jobsearch_codes SET used=1 WHERE id=?").bind(hit.id).run();
  const token = randHex(32);
  await env.JOBS_DB.prepare("INSERT INTO jobsearch_sessions (token_hash, created_ms, expires_ms) VALUES (?1,?2,?3)").bind(await sha256hex(token), now, now + SESSION_MS).run();
  return [200, { ok: true, token, expires_hours: SESSION_MS / 3600000 }, `jobs_session=${token}; Path=/; Max-Age=${SESSION_MS / 1000}; HttpOnly; Secure; SameSite=Strict`];
}
// Operational self-report: the same checks as the fm-jobsearch-* detector contracts in migrations/2026-10-27-jobsearch-ops.sql
async function opsReport(env) {
  await ensure(env);
  const db = env.JOBS_DB, now = Date.now();
  const last = await db.prepare("SELECT * FROM jobsearch_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1").first();
  const recent = (await db.prepare("SELECT passed, fetched FROM jobsearch_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 3").all()).results;
  const unfinished = (await db.prepare("SELECT COUNT(*) AS n FROM jobsearch_runs WHERE finished_at IS NULL AND started_at < ?").bind(iso(now - 15 * 60000)).first()).n;
  const feeds = (await db.prepare("SELECT feed, last_ok_at, last_count, last_error, consecutive_fail FROM jobsearch_feeds ORDER BY feed").all()).results
    .map((feed) => ({ ...feed, active: ACTIVE_FEEDS.has(feed.feed) }));
  const counts = (await db.prepare("SELECT status, COUNT(*) AS n FROM jobsearch_matches GROUP BY status").all()).results;
  const blockedN = (await db.prepare("SELECT COUNT(*) AS n FROM jobsearch_matches WHERE verified=0 AND status='pending_owner_approval'").first()).n;
  const stalePending = (await db.prepare("SELECT COUNT(*) AS n FROM jobsearch_matches WHERE status='pending_owner_approval' AND last_seen < ?").bind(iso(now - 72 * 3600000)).first()).n;
  const ageMin = last ? Math.round((now - Date.parse(last.finished_at)) / 60000) : null;
  const ledgerAge = Math.floor((now - Date.parse(LEDGER_VERIFIED_ON)) / 86400000);
  const checks = [
    { fm: "jobsearch-cron-stalled", ok: ageMin !== null && ageMin <= 120, detail: ageMin === null ? "no finished run yet" : `last run finished ${ageMin} min ago (limit 120)` },
    { fm: "jobsearch-run-unfinished", ok: Number(unfinished) === 0, detail: `${unfinished} run(s) open for over 15 min (the next run closes them)` },
    { fm: "jobsearch-feed-down", ok: !feeds.some((f) => f.active && f.consecutive_fail >= 3), detail: feeds.filter((f) => f.active && f.consecutive_fail >= 3).map((f) => f.feed + " x" + f.consecutive_fail).join(", ") || "no active feed failed 3 runs in a row" },
    { fm: "jobsearch-verifier-blocked", ok: Number(blockedN) === 0, detail: `${blockedN} pending match(es) whose drafts failed verification` },
    { fm: "jobsearch-stale-pending", ok: Number(stalePending) === 0, detail: `${stalePending} pending match(es) not seen for 72 h` },
    { fm: "jobsearch-ledger-stale", ok: ledgerAge <= 90, detail: `ledger verified ${LEDGER_VERIFIED_ON}, ${ledgerAge} days old (limit 90)` },
    { fm: "jobsearch-intake-collapse", ok: !(recent.length >= 3 && recent.every((r) => Number(r.fetched) < 1000 || Number(r.passed) === 0)), detail: recent.map((r) => `${r.fetched}/${r.passed}`).join(" ") + " (fetched/passed, last 3 runs)" },
    { fm: "jobsearch-auth-unavailable", ok: !!env.EMAIL || !!env.LOOP_TOKEN, detail: `email sign-in ${env.EMAIL ? "bound" : "missing"}, loop token ${env.LOOP_TOKEN ? "set" : "not set"}` },
  ];
  return { worker: WORKER, version: VERSION, status: checks.every((c) => c.ok) ? "ok" : "degraded", checked_at: iso(now), last_run: last ? { id: last.id, finished_at: last.finished_at, fetched: last.fetched, passed: last.passed, stored: last.stored, blocked: last.blocked } : null, feeds, matches_by_status: Object.fromEntries(counts.map((c) => [c.status, c.n])), checks };
}
const INDEX = {
  worker: WORKER, version: VERSION,
  routes: {
    "GET /": "web UI", "GET /api/matches?tier=A|B&status=&q=&limit=": "ranked matches without artifacts", "GET /api/matches/:id": "one match with resume_md and note_md",
    "GET /api/runs": "recent pipeline runs", "GET /api/ledger": "the claim ledger every output sentence must come from", "GET /api/ops": "operational self-report: the fm-jobsearch-* checks, feed health, counts", "GET /api/prefs": "the yes/no search survey with your answers; POST {answers:{id:true|false|null}} saves and re-runs the search", "POST /api/analyze": "{input: link or pasted posting text, title?, company?} -> fit, strengths, gaps, whether it would appear in your search, verified draft", "POST /api/feedback": "{title, company, verdict: like|dislike} teaches the search", "GET /api/outcomes": "funnel (matches, approved, applied, replies, interviews, offers), reply rate of applications older than 21 days, by tier", "POST /api/auth/request": "e-mail a 6-digit sign-in code to the owner", "POST /api/auth/verify": "{code} -> owner session (cookie jobs_session, 12 h)", "GET /api/auth/me": "signed-in state", "POST /api/auth/logout": "revoke the session", "POST /api/run": "trigger a run (10-minute cooldown)",
    "POST /api/matches/:id/status": "owner decision or outcome {status: approved|rejected|applied|replied|interview|offer|no_reply|pending_owner_approval}, logged as an event; needs an owner session or x-loop-token", "GET /health": "version",
  },
  policy: "nothing is sent; approval is a status change only",
};

const handler = {
  async scheduled(event, env, ctx) { ctx.waitUntil(run(env).catch((e) => console.log("[jobsearch] run failed " + e.message))); },
  async fetch(request, env, ctx) {
    const url = new URL(request.url), p = url.pathname, m = request.method;
    if (m === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type,x-loop-token", "access-control-allow-methods": "GET,POST,OPTIONS" } });
    if (p === "/health") return J({ ok: true, worker: WORKER, version: VERSION, ledger_verified_on: LEDGER_VERIFIED_ON });
    if (p === "/" && m === "GET") return new Response(UI, { headers: { "content-type": "text/html; charset=utf-8" } });
    if (p === "/api" && m === "GET") return J(INDEX);
    if (p === "/api/ledger" && m === "GET") return J({ person: { ...LEDGER.person, sign_in_email: undefined }, owner_stated: LEDGER.owner_stated, unverified_needs_owner: LEDGER.unverified_needs_owner, facts: LEDGER.facts.map((f) => ({ id: f.id, text: f.text, employer: f.employer, period: f.period })), headlines: LEDGER.headlines });
    if (p === "/api/ops" && m === "GET") { const rep = await opsReport(env); return J(rep, rep.status === "ok" ? 200 : 503); }
    if (p === "/api/outcomes" && m === "GET") return J(await outcomes(env));
    if (p === "/api/prefs" && m === "GET") {
      const ctx = await loadCtx(env);
      const fb = (await env.JOBS_DB.prepare("SELECT verdict, title FROM jobsearch_feedback ORDER BY id DESC LIMIT 20").all()).results;
      return J({ survey: SURVEY.map(([id, group, q, def]) => ({ id, group, q, default: def, answer: ctx.a[id] })), learned: { boost_words: [...ctx.learned.boost].slice(0, 30), block_words: [...ctx.learned.block].slice(0, 30), recent: fb } });
    }
    if (p === "/api/prefs" && m === "POST") {
      if (!(await ownerSession(request, env))) return J({ error: "sign in first: POST /api/auth/request, then POST /api/auth/verify" }, 401);
      let b = {}; try { b = await request.json(); } catch (e) { logErr("bad-json-body", e); }
      await ensure(env);
      const ans = {};
      const saved = await env.JOBS_DB.prepare("SELECT v FROM jobsearch_prefs WHERE k='survey'").first();
      if (saved) {
        try {
          const previous = JSON.parse(saved.v);
          if (previous && typeof previous === "object" && !Array.isArray(previous))
            for (const [id, v] of Object.entries(previous))
              if (SURVEY_IDS.has(id) && (v === true || v === false || v === null)) ans[id] = v;
        } catch (e) { logErr("prefs-parse", e); }
      }
      for (const [id, v] of Object.entries(b.answers || {})) { if (!SURVEY_IDS.has(id)) return J({ error: "unknown question " + id }, 400); if (v !== true && v !== false && v !== null) return J({ error: "answers are true, false or null" }, 400); ans[id] = v; }
      await env.JOBS_DB.prepare("INSERT INTO jobsearch_prefs (k, v, updated_at) VALUES ('survey', ?1, ?2) ON CONFLICT(k) DO UPDATE SET v=?1, updated_at=?2").bind(JSON.stringify(ans), new Date().toISOString()).run();
      ctx.waitUntil(run(env).catch((e) => logErr("rerun-after-prefs", e)));   // the owner's own change bypasses the run cooldown
      return J({ ok: true, saved: Object.keys(ans).length, rerun: true });
    }
    if (p === "/api/feedback" && m === "POST") {
      if (!(await ownerSession(request, env))) return J({ error: "sign in first: POST /api/auth/request, then POST /api/auth/verify" }, 401);
      let b = {}; try { b = await request.json(); } catch (e) { logErr("bad-json-body", e); }
      if (!["like", "dislike"].includes(b.verdict) || !b.title) return J({ error: "send {title, company, verdict: like|dislike}" }, 400);
      await ensure(env); await addFeedback(env, b.title, b.company, b.verdict, "check");
      return J({ ok: true });
    }
    if (p === "/api/analyze" && m === "POST") {
      if (!(await ownerSession(request, env))) return J({ error: "sign in first: POST /api/auth/request, then POST /api/auth/verify" }, 401);
      let b = {}; try { b = await request.json(); } catch (e) { logErr("bad-json-body", e); }
      try { return J(await analyzeJob(env, b)); } catch (e) { return J({ error: e.message }, e.status || 422); }
    }
    if (p === "/api/auth/request" && m === "POST") { const [st, body] = await authRequest(env); return J(body, st); }
    if (p === "/api/auth/verify" && m === "POST") {
      let b = {}; try { b = await request.json(); } catch (e) { logErr("bad-json-body", e); }
      const [st, body, cookie] = await authVerify(env, b.code);
      const r = J(body, st);
      if (cookie) r.headers.append("set-cookie", cookie);
      return r;
    }
    if (p === "/api/auth/me" && m === "GET") return J({ signed_in: !!(await ownerSession(request, env)), email_sign_in: !!env.EMAIL });
    if (p === "/api/auth/logout" && m === "POST") {
      const ses = await ownerSession(request, env);
      if (ses && ses.hash) await env.JOBS_DB.prepare("UPDATE jobsearch_sessions SET revoked=1 WHERE token_hash=?").bind(ses.hash).run();
      const r = J({ ok: true }); r.headers.append("set-cookie", "jobs_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict"); return r;
    }
    if (p === "/api/runs" && m === "GET") {
      const r = await env.JOBS_DB.prepare("SELECT id, started_at, finished_at, feeds, fetched, passed, stored, blocked, excluded_json, errors_json FROM jobsearch_runs ORDER BY id DESC LIMIT 10").all();
      return J({ runs: r.results.map((x) => ({ ...x, excluded: JSON.parse(x.excluded_json || "{}"), errors: JSON.parse(x.errors_json || "[]"), excluded_json: undefined, errors_json: undefined })) });
    }
    if (p === "/api/matches" && m === "GET") {
      const tier = url.searchParams.get("tier"), status = url.searchParams.get("status"), q = (url.searchParams.get("q") || "").toLowerCase();
      const HIDDEN = ["rejected", "expired", "no_reply"];   // a rejected match stays gone unless asked for with status=all
      const lim = Math.min(200, +url.searchParams.get("limit") || 100);
      const r = await env.JOBS_DB.prepare("SELECT id, first_seen, last_seen, company, title, location, url, tier, score, why_json, flags_json, verified, blocked_reason, status, decided_at FROM jobsearch_matches ORDER BY score DESC, last_seen DESC LIMIT 500").all();
      let rows = r.results.map(parseRow);
      if (tier) rows = rows.filter((x) => x.tier === tier);
      if (status === "all") { /* everything */ } else if (status) rows = rows.filter((x) => x.status === status); else rows = rows.filter((x) => !HIDDEN.includes(x.status));
      if (q) rows = rows.filter((x) => (x.title + " " + x.company + " " + x.location).toLowerCase().includes(q));
      return J({ count: rows.length, matches: rows.slice(0, lim) });
    }
    let mm = p.match(/^\/api\/matches\/(.+?)(\/status)?$/);
    if (mm && m === "GET" && !mm[2]) {
      const row = await env.JOBS_DB.prepare("SELECT * FROM jobsearch_matches WHERE id=?").bind(decodeURIComponent(mm[1])).first();
      return row ? J(parseRow(row)) : J({ error: "not found" }, 404);
    }
    if (mm && m === "POST" && mm[2]) {
      if (!env.LOOP_TOKEN && !env.EMAIL) return J({ error: "writes disabled: neither the EMAIL binding nor LOOP_TOKEN is available" }, 503);
      if (!(await ownerSession(request, env))) return J({ error: "sign in first: POST /api/auth/request, then POST /api/auth/verify" }, 401);
      let body = {}; try { body = await request.json(); } catch (e) { console.error(JSON.stringify({ worker: WORKER, event: "bad-json-body", error: e.message })); }
      if (!ALL_STATUSES.includes(body.status)) return J({ error: "status must be one of " + ALL_STATUSES.join("|") }, 400);
      const id = decodeURIComponent(mm[1]);
      const cur = await env.JOBS_DB.prepare("SELECT verified FROM jobsearch_matches WHERE id=?").bind(id).first();
      if (!cur) return J({ error: "not found" }, 404);
      if (!cur.verified && body.status !== "rejected" && body.status !== "pending_owner_approval") return J({ error: "artifacts failed verification; only rejected is allowed" }, 409);
      const tsNow = new Date().toISOString();
      let applicationNote = "owner";
      if (body.status === "rejected" || body.status === "applied" || body.status === "approved") {
        const mt = await env.JOBS_DB.prepare("SELECT title, company, tier, score, why_json FROM jobsearch_matches WHERE id=?").bind(id).first();
        if (mt) await addFeedback(env, mt.title, mt.company, body.status === "rejected" ? "dislike" : "like", "status");
        if (body.status === "applied" && mt) applicationNote = applicationSnapshot(mt);
      }
      await env.JOBS_DB.batch([
        env.JOBS_DB.prepare("UPDATE jobsearch_matches SET status=?, decided_at=? WHERE id=?").bind(body.status, tsNow, id),
        env.JOBS_DB.prepare("INSERT INTO jobsearch_events (match_id, event, ts, note) VALUES (?1, ?2, ?3, ?4)").bind(id, body.status, tsNow, applicationNote),
      ]);
      return J({ ok: true, id, status: body.status });
    }
    if (p === "/api/run" && m === "POST") {
      const last = await env.JOBS_DB.prepare("SELECT started_at FROM jobsearch_runs ORDER BY id DESC LIMIT 1").first();
      if (last && Date.now() - Date.parse(last.started_at) < 10 * 60 * 1000) return J({ error: "cooldown: last run started " + last.started_at }, 429);
      ctx.waitUntil(run(env).catch((e) => console.log("[jobsearch] run failed " + e.message)));
      return J({ ok: true, started: true, note: "poll GET /api/runs" }, 202);
    }
    return J({ error: "not found", see: "/api" }, 404);
  },
};
handler.__test = { evaluate, rank, buildResume, buildNote, verify, stripHtml, locationGate, has, LEDGER, dedupeKey, feedPrefix, makeCtx, scoreJob, scoreFeatures, featuresFromWhy, applicationSnapshot, parseApplicationSnapshot, outcomeScoreWeights, loadCtx, SURVEY, BOARDS };
export default handler;

// ------------------------------------------------------------------ web UI (light theme, plain JS, talks only to the API above)
const UI = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Job matches: verified claims only</title>
<style>
:root{--bg:#f7f7f4;--card:#fff;--ink:#1c1c1a;--mute:#6b6b66;--line:#e2e2dc;--a:#1a7f4b;--b:#a06a00;--bad:#b3261e;--acc:#1f4fd8}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
header{padding:18px 20px;border-bottom:1px solid var(--line);background:#fff;position:sticky;top:0;z-index:2}
h1{margin:0 0 4px;font-size:19px}.sub{color:var(--mute);font-size:13px}
.bar{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center}
select,input,button{font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:#fff}
button{cursor:pointer}button.p{background:var(--acc);color:#fff;border-color:var(--acc)}button:disabled{opacity:.5;cursor:default}
main{max-width:900px;margin:0 auto;padding:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:0 0 12px}
.row{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}.t{font-weight:600;font-size:16px}
.badge{font-size:12px;font-weight:700;padding:2px 8px;border-radius:99px;color:#fff}.A{background:var(--a)}.B{background:var(--b)}
.mute{color:var(--mute);font-size:13px}.flag{color:var(--bad);font-size:13px;margin-top:4px}
.st{font-size:12px;border:1px solid var(--line);border-radius:99px;padding:1px 8px}.st.approved{border-color:var(--a);color:var(--a)}.st.rejected{border-color:var(--bad);color:var(--bad)}
pre{white-space:pre-wrap;background:#fbfbf8;border:1px solid var(--line);border-radius:8px;padding:10px;font:13px/1.45 ui-monospace,Menlo,Consolas,monospace}
.acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}a{color:var(--acc)}
details{background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin:0 0 12px}summary{cursor:pointer;font-weight:600}.q{padding:4px 0;border-top:1px solid var(--line)}.q label{margin-left:10px;white-space:nowrap}h4{margin:10px 0 4px}textarea{font:inherit;border:1px solid var(--line);border-radius:6px;padding:8px;margin-top:8px}.note{background:#fff8e1;border:1px solid #f0d98a;border-radius:8px;padding:8px 12px;font-size:13px;margin-bottom:12px}
</style></head><body>
<header><h1>Job matches: verified claims only</h1><div class="sub" id="meta">loading…</div>
<div class="bar"><select id="tier"><option value="">All tiers</option><option>A</option><option>B</option></select>
<select id="status"><option value="">Active (hides rejected)</option><option value="all">All, including rejected</option><option value="pending_owner_approval">Pending</option><option>approved</option><option>rejected</option><option>applied</option><option>replied</option><option>interview</option><option>offer</option><option>no_reply</option><option>expired</option></select>
<input id="q" placeholder="Search title, company, place" size="26"><button id="run" class="p">Run now</button><a href="/api" class="mute">API</a> <a href="/api/ledger" class="mute">Claim ledger</a> <a href="/api/ops" class="mute">Operations</a> <span id="who" class="mute"></span><button id="signin" onclick="signIn()">Sign in</button><button id="signout" style="display:none" onclick="api(\'/api/auth/logout\',{method:\'POST\'}).then(who)">Sign out</button></div></header>
<main><div class="note">Every sentence in a resume or note is copied from the claim ledger and re-checked line by line; a failed check blocks the draft. Nothing is sent: approve only marks your decision, then you apply from the posting link.</div><details id="check" open><summary>Check a job I found</summary><textarea id="jin" rows="4" placeholder="Paste a job link, or paste the whole posting text" style="width:100%"></textarea><div class="bar"><input id="jtitle" placeholder="Title (optional)"><input id="jco" placeholder="Employer (optional)"><button class="p" id="jgo">How good a match am I?</button></div><div id="jres"></div></details>
<details id="prefs"><summary>Search preferences: yes or no questions</summary><div id="survey" class="mute">loading</div><div class="bar"><button class="p" id="psave">Save and re-run the search</button><span id="prefmsg" class="mute"></span></div></details><div id="list"></div></main>
<script>
const $=s=>document.querySelector(s);const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function api(path,opt){const r=await fetch(path,opt);const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||r.status);return j}
async function load(){
  const q=new URLSearchParams();for(const k of['tier','status','q']){const v=$('#'+k).value;if(v)q.set(k,v)}
  const [m,r,oc]=await Promise.all([api('/api/matches?'+q),api('/api/runs'),api('/api/outcomes')]);
  const last=r.runs[0];$('#meta').textContent=last?('Last run '+last.started_at+' | '+last.fetched+' postings from '+last.feeds+' feeds | '+last.passed+' passed gates | '+last.blocked+' blocked by verifier'+(last.errors.length?' | feed errors: '+last.errors.length:'')):'No run yet. Press Run now.';$('#meta').textContent+=' | Applied '+oc.funnel.applied+', replies '+oc.funnel.replied+', interviews '+oc.funnel.interview+' | reply rate '+(oc.reply_rate_90d===null?'unknown ('+oc.reading+')':Math.round(oc.reply_rate_90d*100)+'%');
  $('#list').innerHTML=m.matches.map(x=>'<div class="card" id="c-'+esc(x.id)+'"><div class="row"><span class="badge '+x.tier+'">'+x.tier+' '+x.score+'</span><span class="t">'+esc(x.title)+'</span><span class="mute">'+esc(x.company)+' | '+esc(x.location||'n/a')+'</span><span class="st '+esc(x.status)+'">'+esc(x.status.replace(/_/g,' '))+'</span></div>'
   +'<div class="mute">'+esc(x.why.join(' | '))+'</div>'+x.flags.map(f=>'<div class="flag">Check: '+esc(f)+'</div>').join('')
   +(x.verified?'':'<div class="flag">Blocked by verifier: '+esc(x.blocked_reason)+'</div>')
   +'<div class="acts"><a href="'+esc(x.url)+'" target="_blank" rel="noopener"><button>Open posting</button></a><button onclick="show(\\''+esc(x.id)+'\\')">Resume and note</button>'
   +'<button onclick="decide(\\''+esc(x.id)+'\\',\\'approved\\')">Approve</button><button onclick="decide(\\''+esc(x.id)+'\\',\\'rejected\\')">Reject</button><button onclick="decide(\\''+esc(x.id)+'\\',\\'applied\\')">Mark applied</button>'+[['replied','Got a reply'],['interview','Interview'],['offer','Offer']].map(o=>'<button onclick="decide(\\''+esc(x.id)+'\\',\\''+o[0]+'\\')">'+o[1]+'</button>').join('')+'</div><div class="art"></div></div>').join('')||'<p class="mute">No matches yet.</p>';
}
async function show(id){const el=document.getElementById('c-'+id).querySelector('.art');if(el.innerHTML){el.innerHTML='';return}
  const d=await api('/api/matches/'+encodeURIComponent(id));if(!d.verified){el.innerHTML='<pre>Blocked: '+esc(d.blocked_reason)+'</pre>';return}
  el.innerHTML='<h4>Resume</h4><pre>'+esc(d.resume_md)+'</pre><h4>Note</h4><pre>'+esc(d.note_md)+'</pre><button onclick="navigator.clipboard.writeText(this.dataset.t)" data-t="'+esc(d.note_md)+'">Copy note</button> <button onclick="navigator.clipboard.writeText(this.dataset.t)" data-t="'+esc(d.resume_md)+'">Copy resume</button>'}
function signIn(){return new Promise(async(res)=>{let r;try{r=await api('/api/auth/request',{method:'POST'})}catch(e){if(!/limit/.test(e.message)){alert(e.message);return res(false)}r={sent:false,note:e.message}}
  let box=$('#signbox');if(!box){box=document.createElement('div');box.id='signbox';box.className='note';$('main').prepend(box)}
  box.innerHTML='<b>Sign in</b><div>'+esc(r.sent===false?r.note+' A code sent earlier still works.':'A 6-digit code was e-mailed to '+r.to+'.')+'</div><div class="bar"><input id="scode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6-digit code" size="10"><button class="p" id="sgo">Sign in</button><button id="scancel">Cancel</button><span id="smsg" class="mute"></span></div>';
  const done=v=>{box.remove();res(v)};$('#scancel').onclick=()=>done(false);
  const go=async()=>{try{await api('/api/auth/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:$('#scode').value.trim()})});who();done(true)}catch(e){$('#smsg').textContent=e.message}};
  $('#sgo').onclick=go;$('#scode').onkeydown=e=>{if(e.key==='Enter')go()};$('#scode').focus()})}
async function who(){try{const m=await api('/api/auth/me');$('#who').textContent=m.signed_in?'Signed in':'Not signed in';$('#signin').style.display=m.signed_in?'none':'';$('#signout').style.display=m.signed_in?'':'none'}catch(e){$('#who').textContent='Sign-in status unavailable: '+e.message}}
async function decide(id,status){
  const call=()=>api('/api/matches/'+encodeURIComponent(id)+'/status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({status})});
  try{await call()}catch(e){if(/sign in/.test(e.message)){try{if(await signIn())await call();else return}catch(e2){alert(e2.message);return}}else{alert(e.message);return}}load()}
$('#run').onclick=async()=>{$('#run').disabled=true;try{await authed(()=>api('/api/run',{method:'POST'}));$('#meta').textContent='Run started. Refreshing in 40 s…';setTimeout(()=>{load();$('#run').disabled=false},40000)}catch(e){alert(e.message);$('#run').disabled=false}};
for(const k of['tier','status'])$('#'+k).onchange=load;$('#q').oninput=()=>{clearTimeout(window._t);window._t=setTimeout(load,300)};async function authed(fn){try{return await fn()}catch(e){if(/sign in/.test(e.message)){if(await signIn())return await fn()}throw e}}
async function loadPrefs(){const d=await api('/api/prefs');const g={};d.survey.forEach(q=>{(g[q.group]=g[q.group]||[]).push(q)});$('#survey').innerHTML=Object.keys(g).map(k=>'<h4>'+esc(k)+'</h4>'+g[k].map(q=>'<div class="q"><span>'+esc(q.q)+'</span> '+[['true','Yes'],['false','No'],['null','Skip']].map(o=>'<label><input type="radio" name="q_'+q.id+'" value="'+o[0]+'"'+(String(q.answer)===o[0]?' checked':'')+'> '+o[1]+'</label>').join('')+'</div>').join('')).join('')}
$('#psave').onclick=async()=>{const a={};document.querySelectorAll('#survey input:checked').forEach(i=>{a[i.name.slice(2)]=i.value==='true'?true:i.value==='false'?false:null});$('#prefmsg').textContent='Saving...';try{await authed(()=>api('/api/prefs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({answers:a})}));$('#prefmsg').textContent='Saved. The search is re-running (about a minute); matches that no longer fit are hidden.';setTimeout(load,60000)}catch(e){$('#prefmsg').textContent=e.message}};
function li(a){return a&&a.length?'<ul>'+a.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'<p class="mute">none</p>'}
$('#jgo').onclick=async()=>{const r=$('#jres');r.textContent='Reading the posting...';try{const d=await authed(()=>api('/api/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({input:$('#jin').value,title:$('#jtitle').value,company:$('#jco').value})}));window._last=d;
 r.innerHTML='<div class="card"><div class="t">'+esc(d.verdict)+' ('+d.fit_score+')  '+esc(d.title)+'</div><div class="mute">'+esc(d.company)+' | '+esc(d.location)+'</div><div>'+(d.would_appear_in_your_search?'Would appear in your search.':'Would NOT appear in your search: '+esc(d.why_not_in_search.join('; ')))+'</div><h4>Why</h4>'+li(d.why)+'<h4>Your record that fits</h4>'+li(d.strengths.map(x=>x.text))+'<h4>Gaps and checks</h4>'+li(d.gaps.concat(d.flags))+'<div class="acts"><button class="fb" data-v="like">More like this</button><button class="fb" data-v="dislike">Not for me</button></div><span id="fbmsg" class="mute"></span>'+(d.draft.resume?'<details><summary>Verified resume and note for this job</summary><pre>'+esc(d.draft.resume)+'</pre><pre>'+esc(d.draft.note)+'</pre></details>':'<p class="flag">Draft blocked: '+esc(d.draft.blocked)+'</p>')+'</div>';
 r.querySelectorAll('.fb').forEach(b=>b.onclick=async()=>{try{await authed(()=>api('/api/feedback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:d.title,company:d.company,verdict:b.dataset.v})}));$('#fbmsg').textContent='Noted. The next search run uses it.'}catch(e){$('#fbmsg').textContent=e.message}})}catch(e){r.textContent=e.message}};
load();who();loadPrefs();
</script></body></html>`;
