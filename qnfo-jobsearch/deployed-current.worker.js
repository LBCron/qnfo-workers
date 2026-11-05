// qnfo-jobsearch: verified-claims job matcher (JOBSEARCH-1). Charter pillar: personal.
// Hourly cron fetches public ATS feeds (Greenhouse, Lever, Ashby) plus Remotive and Arbeitnow, gates and scores each posting
// against the owner's claim ledger, assembles a tailored resume and note ONLY from ledger sentences, re-verifies every output
// line, and stores the result in D1 (jobsearch_matches). Nothing is ever sent: status moves pending_owner_approval -> approved/rejected/applied
// by the owner (POST needs x-loop-token). No LinkedIn/Indeed scraping (LinkedIn User Agreement s8.2).
// JOBSEARCH-OPS-1 (1.1.0): e-mailed-code owner sign-in via qnfo-email (no secret to manage), feed health and retry, self-healing runs, posting lifecycle (expired), dedupe, retention, GET /api/ops self-report.
// JOBSEARCH-OUTCOME-1 (1.2.0): append-only status events, outcome funnel (applied, replies, interviews, offers), reply rate of applications older than 21 days, metrics jobsearch_reply_rate_90d / jobsearch_interview_rate_90d / jobsearch_applied_30d written each run, no_reply after 21 days.
// JOBSEARCH-PROFILE-1 (1.3.0): yes/no search survey, role families drawn from the whole record (policy, transport and planning, data, product, program, research, consulting, nonprofit, GIS, contracts, social policy), location gates from the owner answers (Netherlands and remote by default, US and other on-site only when selected), likes and dislikes teach the search, rejected matches stay hidden, "check a job" analysis of a pasted link or text.
// JOBSEARCH-CV-1 (1.5.0): the CV is part of this worker (page /cv): a yes/no interview that builds the claim bank, review of unconfirmed claims, roles, achievements and publications edited in D1, a resume per job (summary, roles, selected work, education, skills) and a cover note, history and backup. The search is tied to that bank (evidence the owner can back up weighs more; what the CV lacks is shown as a gap), decided postings (rejected, applied, approved) never come back under another id, rejections carry a reason the search learns from, and a wider net: stretch matches outside the stated preferences, more boards and aggregators.
// Routes: GET / (web UI) | GET /api | GET /api/matches | GET /api/matches/:id | GET /api/runs | GET /api/ledger | POST /api/run | POST /api/matches/:id/status | GET /health
// Port of the jobsearch/ Python modules (tests: jobsearch/test_jobsearch.py, qnfo-jobsearch/worker.test.mjs).
var VERSION = "1.6.1";
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
let LEDGER_VERIFIED_ON = LEDGER.ledger_verified_on || "2026-10-01";
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
  "CREATE TABLE IF NOT EXISTS jobsearch_bank (k TEXT PRIMARY KEY, v TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 0, updated_at TEXT)",
  "CREATE TABLE IF NOT EXISTS jobsearch_bank_history (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, rev INTEGER NOT NULL, v TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS jobsearch_history (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, title TEXT, company TEXT, url TEXT, fit INTEGER, verdict TEXT, resume_md TEXT, note_md TEXT)",
];
let ensured = false;
async function ensure(env) {
  if (ensured) return;
  for (const q of DDL) await env.JOBS_DB.prepare(q).run();
  try { await env.JOBS_DB.prepare("ALTER TABLE jobsearch_feedback ADD COLUMN reason TEXT").run(); } catch (e) { if (!/duplicate column/i.test(String((e && e.message) || e))) throw e; }   // why a posting was rejected: the search learns from it
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
  return { greenhouse: `gh:${arg}:`, lever: `lv:${arg}:`, ashby: `ab:${arg}:`, recruitee: `rc:${arg}:`, smartrecruiters: `sr:${arg}:`, remotive: "rm:", muse: "mu:", jobicy: "jb:", arbeitnow: "an:", remoteok: "rok:", himalayas: "him:", hn: "hn:", publicsector: `ps:${arg}:` }[kind];
}
const dedupeKey = (j) => `${j.company}|${j.title}|${j.location}`.toLowerCase().replace(/\s+/g, " ").trim();

// ------------------------------------------------------------------ feeds
// JOBSEARCH-SOURCES-1 (2026-10-28; tier B from 35 so data-product roles at Amsterdam employers surface, legal titles excluded outright): boards chosen for the owner's record (policy and research management, data products, transport and mobility, AI) and for
// Amsterdam and EU employers; each slug was probed live against the public API before it was added. A board that fails 3 runs in a row shows in /api/ops.
const BOARDS = {
  greenhouse: ["anthropic", "scaleai", "mongodb", "elastic", "gitlab", "databricks", "stripe", "adyen", "bird", "datadog", "cloudflare", "canonical", "grafanalabs", "mozilla", "wikimedia", "khanacademy",
    "codeforamerica", "givewell", "dataiku", "fivetran", "nesta", "gallup", "rti", "ideo", "waymo", "nuro", "lyft",
    "givedirectly", "goodfire", "ionq", "psiquantum", "riverlane", "turing", "via", "catawiki", "labelbox"],
  lever: ["palantir", "mistral", "mendix", "brookings", "oliverwyman", "zoox", "apolloresearch", "metr", "rigetti"],
  ashby: ["openai", "cohere", "notion", "elevenlabs", "mollie", "mapbox", "perplexity", "snowflake", "faculty", "wayve", "cerebras", "anyscale", "modal", "fireworks", "redwoodresearch", "pinecone", "runway", "miro"],
  recruitee: ["bunq", "msf", "solvinity", "sweco"],   // sweco: transport, urban and water planning consultancy (probed 2026-11-05: 179 offers, Netherlands among them)
  smartrecruiters: ["oecd"],                           // JOBSEARCH-SOURCES-1 (JS-7): OECD policy research and statistics roles (probed 2026-11-05: 22 postings)
  remotive: ["data", "product", "all-others", "q=research", "q=policy", "q=scientist", "q=quantum", "q=program manager", "q=analyst"],
  muse: ["Amsterdam, Netherlands|", "Amsterdam, Netherlands|Data and Analytics", "Amsterdam, Netherlands|Project & Product Management", "Amsterdam, Netherlands|Management", "Flexible / Remote|Data and Analytics", "Flexible / Remote|Project & Product Management", "Flexible / Remote|Management", "Flexible / Remote|Consulting"],
  jobicy: ["netherlands", "europe", "emea", "tag:research", "tag:data science", "tag:policy", "tag:machine learning"],
  remoteok: [true],
  himalayas: [10],
  hn: [true],
  arbeitnow: true,
  publicsector: ["werkenvoornederland", "academictransfer", "euraxess"],
};
const ACTIVE_FEEDS = new Set(Object.entries(BOARDS).flatMap(([kind, args]) =>
  kind === "arbeitnow" ? ["arbeitnow"] : args.map((arg) => `${kind}:${arg}`)
));
const DISPLAY = { openai: "OpenAI", scaleai: "Scale AI", gitlab: "GitLab", mongodb: "MongoDB", anthropic: "Anthropic", databricks: "Databricks", elastic: "Elastic", stripe: "Stripe", palantir: "Palantir", mistral: "Mistral", cohere: "Cohere", notion: "Notion", elevenlabs: "ElevenLabs", adyen: "Adyen", bird: "Bird", datadog: "Datadog", cloudflare: "Cloudflare", canonical: "Canonical", grafanalabs: "Grafana Labs", mozilla: "Mozilla", wikimedia: "Wikimedia Foundation", khanacademy: "Khan Academy", codeforamerica: "Code for America", givewell: "GiveWell", dataiku: "Dataiku", fivetran: "Fivetran", nesta: "Nesta", gallup: "Gallup", rti: "RTI International", ideo: "IDEO", waymo: "Waymo", nuro: "Nuro", lyft: "Lyft", mendix: "Mendix", brookings: "Brookings Institution", oliverwyman: "Oliver Wyman", zoox: "Zoox", mollie: "Mollie", mapbox: "Mapbox", perplexity: "Perplexity", snowflake: "Snowflake", givedirectly: "GiveDirectly", goodfire: "Goodfire", ionq: "IonQ", psiquantum: "PsiQuantum", riverlane: "Riverlane", turing: "The Alan Turing Institute", via: "Via", catawiki: "Catawiki", labelbox: "Labelbox", apolloresearch: "Apollo Research", metr: "METR", rigetti: "Rigetti", faculty: "Faculty", wayve: "Wayve", cerebras: "Cerebras", anyscale: "Anyscale", modal: "Modal", fireworks: "Fireworks AI", redwoodresearch: "Redwood Research", pinecone: "Pinecone", runway: "Runway", miro: "Miro", bunq: "bunq", msf: "Doctors Without Borders (MSF)", solvinity: "Solvinity", sweco: "Sweco",
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
    const d = await getJson(cat.startsWith("q=") ? `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(cat.slice(2))}&limit=100` : `https://remotive.com/api/remote-jobs?category=${cat}`);
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
    const d = await getJson(geo.startsWith("tag:") ? `https://jobicy.com/api/v2/remote-jobs?count=100&tag=${encodeURIComponent(geo.slice(4))}` : `https://jobicy.com/api/v2/remote-jobs?count=100&geo=${geo}`);
    return (d.jobs || []).map((j) => ({ id: `jb:${j.id}`, source: "jobicy", company: j.companyName || "", title: j.jobTitle || "", location: "Remote - " + (Array.isArray(j.jobGeo) ? j.jobGeo.join(", ") : j.jobGeo || ""), url: j.url || "", desc: stripHtml(j.jobDescription || j.jobExcerpt || "") }));
  },
  // JOBSEARCH-CV-1 wider net: Recruitee company boards, RemoteOK, Himalayas, and the monthly Hacker News "Who is hiring" thread. Every fetcher tolerates an unexpected answer shape (returns nothing).
  async recruitee(slug) {
    const d = await getJson(`https://${slug}.recruitee.com/api/offers/`);
    return (Array.isArray(d.offers) ? d.offers : []).map((j) => ({ id: `rc:${slug}:${j.id}`, source: "recruitee", company: slug, title: j.title || "", location: [j.city, j.country].filter(Boolean).join(", ") + (j.remote ? " (Remote)" : ""), url: j.careers_url || "", desc: stripHtml((j.description || "") + " " + (j.requirements || "")) }));
  },
  // RemoteOK terms: link back to the listing and name RemoteOK as the source; every match keeps the RemoteOK url and shows "via RemoteOK".
  async remoteok() {
    const d = await getJson("https://remoteok.com/api");
    return (Array.isArray(d) ? d.slice(1) : []).filter((j) => j && j.position).map((j) => ({ id: `rok:${j.id}`, source: "remoteok", company: j.company || "", title: j.position || "", location: "Remote - " + (j.location || "Worldwide"), url: j.url || (j.slug ? "https://remoteok.com/remote-jobs/" + j.slug : ""), desc: stripHtml(j.description || "") }));
  },
  async himalayas(pages) {
    const out = [];
    let cursor = "";
    for (let p = 0; p < pages; p++) {
      const d = await getJson("https://himalayas.app/jobs/api?limit=100" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""));
      for (const j of Array.isArray(d.jobs) ? d.jobs : []) out.push({ id: `him:${(j.guid || j.applicationLink || j.title || "").split("/").slice(-2).join("-").slice(0, 80)}`, source: "himalayas", company: j.companyName || "", title: j.title || "", location: "Remote - " + ((j.locationRestrictions || []).join(", ") || "Worldwide"), url: j.guid || j.applicationLink || "", desc: stripHtml(j.description || j.excerpt || "") });
      cursor = d.nextCursor || "";
      if (!cursor) break;
    }
    return out;
  },
  async hn() {
    const st = await getJson("https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=6");
    const story = (st.hits || []).find((h) => /who is hiring/i.test(h.title || "") && !/freelancer|wants to be hired/i.test(h.title || ""));
    if (!story) return [];
    const d = await getJson(`https://hn.algolia.com/api/v1/search?tags=comment,story_${story.objectID}&hitsPerPage=1000`);
    const ROLE = /(manager|engineer|scientist|researcher|analyst|director|lead|head|product|policy|physicist|economist|statistician|developer|designer|architect|fellow)/i;
    const out = [];
    for (const c of d.hits || []) {
      if (String(c.parent_id) !== String(story.objectID) || !c.comment_text) continue;
      const text = stripHtml(c.comment_text), head = (text.split("\n")[0] || "").split("|").map((x) => x.trim()).filter(Boolean);
      if (head.length < 3) continue;
      const title = head.slice(1, 4).find((x) => ROLE.test(x)) || head[1];
      out.push({ id: `hn:${c.objectID}`, source: "hn", company: head[0].slice(0, 80), title: title.slice(0, 140), location: head.filter((x, i) => i > 0 && x !== title).join(" | ").slice(0, 160), url: `https://news.ycombinator.com/item?id=${c.objectID}`, desc: text });
    }
    return out;
  },
  async arbeitnow() {
    const out = [];
    for (let p = 1; p <= 3; p++) {
      const d = await getJson(`https://www.arbeitnow.com/api/job-board-api?page=${p}`);
      for (const j of d.data || []) out.push({ id: `an:${j.slug}`, source: "arbeitnow", company: j.company_name || "", title: j.title || "", location: (j.location || "") + (j.remote ? " (Remote)" : ""), url: j.url || "", desc: stripHtml(j.description || "") });
    }
    return out;
  },
  // JOBSEARCH-SOURCES-1 (JS-7): SmartRecruiters company boards (public API, intended for syndication). The list holds no text, so a posting whose title
  // could be in the owner's lane gets one detail request (at most 40 a run); the others are listed by title and location and the gates drop them.
  async smartrecruiters(id) {
    const list = await getJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(id)}/postings?limit=100`);
    const out = [];
    let detailed = 0;
    for (const p of Array.isArray(list.content) ? list.content : []) {
      const loc = p.location || {};
      const job = { id: `sr:${id}:${p.id}`, source: "smartrecruiters", company: (p.company && p.company.name) || id, title: p.name || "", location: [loc.city, loc.country && String(loc.country).toUpperCase()].filter(Boolean).join(", ") + (loc.remote ? " (Remote)" : ""), url: `https://jobs.smartrecruiters.com/${encodeURIComponent(id)}/${p.id}`, desc: "" };
      if (detailed < 40 && titleCandidate(job.title)) {
        detailed++;
        try {
          const d = await getJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(id)}/postings/${p.id}`);
          const secs = (d.jobAd && d.jobAd.sections) || {};
          job.desc = stripHtml(["companyDescription", "jobDescription", "qualifications", "additionalInformation"].map((k) => (secs[k] && secs[k].text) || "").join("\n"));
          if (d.postingUrl) job.url = d.postingUrl;
        } catch (e) { logErr("smartrecruiters-detail", e); }
      }
      out.push(job);
    }
    return out;
  },
  // JOBSEARCH-NL-PUBLIC-SECTOR-1 (JS-11, issue #1000643): the work the owner knows best (policy, transport and planning, public-sector research) is posted on
  // Dutch government, university and EU research sites that publish no RSS or API. Terms were read first (robots.txt fetched 2026-11-05, recorded in PUBLIC_SECTOR below).
  async publicsector(arg) {
    const s = PUBLIC_SECTOR[arg];
    if (!s) return [];
    return s.sitemap ? publicSectorSitemap(arg, s) : publicSectorListing(arg, s);
  },
};

// A title that could be in the owner's lane: no hard-noise word, and a role family or a generic management title. Used to spend detail requests only where they can pay off.
function titleCandidate(title) {
  const t = String(title || "").toLowerCase();
  if (ABSOLUTE_EXCLUDE.some((x) => t.includes(x) && !ENGINEERING_WORDS.includes(x))) return false;
  return has(t, TITLE_MEDIUM).length > 0 || Object.values(FAMILIES).some((kws) => has(t, kws).length > 0);
}
const familyTitle = (title) => { const t = String(title || "").toLowerCase(); return Object.values(FAMILIES).some((kws) => has(t, kws).length > 0); };
// The answer to lever (1) of the issue, per site: what robots.txt and the terms allow, and how this reader behaves.
//  werkenvoornederland.nl  robots: allow all except /login, Request-rate 10/1, publishes sitemap-vacatures.xml (about 1,300 open vacancies of Dutch ministries and agencies) ->
//                          read the sitemap (1 request), then at most 30 posting pages an hour, one a second, each through its schema.org JobPosting JSON-LD.
//  academictransfer.com    robots: User-agent * allow, Crawl-delay 10; AI training crawlers (GPTBot, ClaudeBot, Google-Extended, CCBot) are disallowed, and this is not one: it is one
//                          person's job lookup that never trains a model -> the sitemap only (1 request an hour), titles from the URL, no posting pages (they would take 10 s each).
//  euraxess.ec.europa.eu   robots: no URLs with a query string and no api paths, so only the plain listing page /jobs/search, one request an hour.
//  jobs.ac.uk              robots allow reading, but the postings are UK on-site; not read.
//  LinkedIn and Indeed are never read (LinkedIn User Agreement 8.2).
const PUBLIC_SECTOR = {
  werkenvoornederland: { sitemap: "https://www.werkenvoornederland.nl/sitemap-vacatures.xml", base: "https://www.werkenvoornederland.nl", company: "Rijksoverheid (Werken voor Nederland)", detail: 30, delayMs: 1000, titleFrom: "wvn" },
  academictransfer: { sitemap: "https://www.academictransfer.com/sitemap-vacancies.xml", base: "https://www.academictransfer.com", company: "Academic Transfer (Dutch universities)", detail: 0, delayMs: 10000, titleFrom: "at", max: 150 },
  euraxess: { url: "https://euraxess.ec.europa.eu/jobs/search", base: "https://euraxess.ec.europa.eu", company: "EURAXESS (EU research careers)", location: "EU" },
};
function sitemapUrls(xml) {
  const out = [];
  for (const m of String(xml || "").matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
    const loc = (/<loc>\s*([^<\s]+)\s*<\/loc>/i.exec(m[1]) || [])[1];
    if (loc) out.push({ loc: decodeEntities(loc), lastmod: (/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i.exec(m[1]) || [])[1] || "" });
  }
  return out;
}
// the vacancy title as the URL slug writes it: ".../vacatures/projectleider-effectief-toezicht-NVWA-2026-4529" -> "projectleider effectief toezicht"
function slugTitle(loc, from) {
  let last = String(loc || "").replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop() || "";
  try { last = decodeURIComponent(last); } catch (e) { logErr("publicsector-slug", e); }
  if (from === "wvn") last = last.replace(/-[A-Za-z0-9]{2,12}-\d{4}-\d+$/, "");
  return last.replace(/-+/g, " ").replace(/\s+/g, " ").trim();
}
async function publicSectorSitemap(arg, s) {
  const urls = sitemapUrls(await getText(s.sitemap));
  if (!urls.length) throw new Error("the sitemap listed no vacancies");
  const cands = [];
  for (const u of urls) {
    if (!u.loc.startsWith(s.base)) continue;
    const title = slugTitle(u.loc, s.titleFrom);
    if (!title || !titleCandidate(title)) continue;
    cands.push({ ...u, title, fam: familyTitle(title) });
  }
  cands.sort((a, b) => (b.fam - a.fam) || String(b.lastmod).localeCompare(String(a.lastmod)));
  const picked = cands.slice(0, s.detail || s.max || 100);
  const out = [];
  let failed = 0;
  for (const c of picked) {
    const job = { id: `ps:${arg}:${(await sha256hex(c.loc)).slice(0, 16)}`, source: "publicsector", company: s.company, title: c.title, location: "Netherlands", url: c.loc, desc: "" };
    if (s.detail) {
      await new Promise((r) => setTimeout(r, s.delayMs));
      try {
        const ld = jsonLdPosting(await getHtml(c.loc));
        if (ld) {
          if (ld.title) job.title = ld.title;
          if (ld.company && ld.company.trim()) job.company = ld.company.trim();
          if (ld.location) job.location = ld.location;
          job.desc = ld.desc || "";
        } else failed++;
      } catch (e) { failed++; logErr("publicsector-posting", e); }
    }
    out.push(job);
  }
  if (s.detail && picked.length >= 5 && failed === picked.length) throw new Error(`no posting page of ${picked.length} could be read`);
  return out;
}
// A plain listing page: each posting is an <a> whose href carries the job path; anchors with a job-like href and a title-like text are kept.
async function publicSectorListing(arg, s) {
  const html = await getHtml(s.url);
  const out = [], seen = new Set();
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
    out.push({ id: `ps:${arg}:${(await sha256hex(href)).slice(0, 16)}`, source: "publicsector", company: s.company, title: text, location: s.location || "Netherlands", url: href, desc: "" });
  }
  return out;
}
async function getText(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 25000);
  try {
    const r = await fetch(url, { headers: { "user-agent": "qnfo-jobsearch/1.0 (+https://qnfo.org; contact via https://qnfo.org)", "accept": "application/xml,text/xml;q=0.9,text/html;q=0.8" }, signal: ac.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

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
  ["fam_science", "Work", "Research scientist, quantitative and applied-science roles (statistics, modelling, physics)?", true],
  ["fam_tech", "Work", "Research-engineering roles (research engineer, ML engineer, data engineer) when the posting matches your record?", null],
  ["lvl_manage", "Level", "Roles that manage people?", null],
  ["lvl_mid", "Level", "Roles below senior level (no senior, lead, head, principal or director in the title)?", null],
  ["type_contract", "Contract", "Contract, freelance or interim engagements?", true],
];
const SURVEY_IDS = new Set(SURVEY.map((q) => q[0]));
// role families: title terms (a hit means the title is in your lane) and the survey question that switches the family on or off
const FAMILIES = {
  fam_policy: ["policy analyst", "policy advisor", "policy adviser", "policy officer", "policy manager", "policy lead", "head of policy", "director of policy", "public policy", "policy researcher", "senior policy", "policy and research", "science policy", "policy specialist", "policy director",
    "beleidsadviseur", "beleidsmedewerker", "beleidsonderzoeker", "beleidsmanager", "beleidsstrateeg", "beleidscoordinator", "adviseur beleid", "hoofd beleid", "strategisch adviseur"],   // JOBSEARCH-NL-PUBLIC-SECTOR-1: the Dutch titles of the same work
  fam_transport: ["transport", "mobility", "urban planner", "urban planning", "regional planning", "spatial planning", "transport planner", "city planner", "land use", "transport model", "smart city", "traffic", "infrastructure planning", "urban development",
    "verkeerskundige", "verkeersmodelleur", "vervoerplanner", "mobiliteitsadviseur", "mobiliteitsmanager", "adviseur mobiliteit", "verkeer en vervoer", "stedenbouwkundige", "ruimtelijk planner", "ruimtelijke ordening", "gebiedsontwikkeling"],
  fam_data: ["data scientist", "head of data", "director of data", "analytics manager", "analytics lead", "director of analytics", "head of analytics", "head of insights", "data science manager", "chief data", "data strategy", "insights manager", "data analytics manager", "lead data", "principal data", "data product", "data lead",
    "datascientist", "data-analist", "data analist", "data-adviseur", "data adviseur", "datamanager", "hoofd data"],
  fam_product: ["product manager", "product owner", "head of product", "group product", "product lead", "director of product", "principal product", "product management"],
  fam_program: ["program manager", "programme manager", "project manager", "portfolio manager", "pmo", "delivery manager", "head of programs", "head of programmes", "director of programs", "programme director", "program director", "program lead", "programme lead",
    "programmamanager", "programmaleider", "programmadirecteur", "portfoliomanager", "projectmanager", "projectleider"],
  fam_research: ["research manager", "research director", "research program", "research programme", "head of research", "director of research", "research operations", "research lead", "grants manager", "research coordinator", "research partnerships", "research strategy", "senior researcher", "principal researcher", "research advisor", "research adviser", "research fellow", "evaluation manager", "monitoring and evaluation",
    "onderzoeker", "onderzoeksleider", "onderzoeksmanager", "onderzoeksadviseur", "hoofd onderzoek", "wetenschappelijk onderzoeker"],
  fam_consult: ["consultant", "engagement manager", "advisory", "associate partner", "management consult*", "strategy consult*"],
  fam_nonprofit: ["executive director", "managing director", "country director", "chief of staff", "director of operations", "foundation"],
  fam_gis: ["gis", "geospatial", "geographic information", "spatial data", "spatial analyst", "geo-informatie", "geo informatie"],
  fam_contract: ["contracting officer", "contract manager", "contracts manager", "procurement manager", "vendor manager", "sourcing manager"],
  fam_social: ["housing", "social policy", "community development", "ageing", "aging", "livability", "affordable"],
  fam_climate: ["sustainability", "climate", "energy transition", "esg", "net zero", "decarbon"],
  fam_ai: ["ai governance", "ai policy", "applied ai", "ai product", "ml product", "responsible ai", "ai safety", "trust and safety", "ai evaluation", "ai ethics", "ai strategy", "ai program", "ai programme"],
  fam_quantum: ["quantum", "research integrity", "scientific integrity", "open science"],
  fam_edu: ["lecturer", "professor", "teaching fellow", "instructor", "trainer", "education manager", "learning manager", "curriculum"],
  fam_science: ["research scientist", "applied scientist", "quantitative researcher", "quantitative analyst", "physicist", "economist", "statistician", "computational scientist", "research associate", "postdoctoral", "principal investigator", "data scientist", "scientist"],
  fam_tech: ["research engineer", "machine learning engineer", "ml engineer", "ai engineer", "data engineer", "analytics engineer", "applied ai engineer", "software engineer, research", "research software engineer"],
};
const CLUSTER_KW = {
  research_mgmt: ["research program", "research portfolio", "research operations", "research management", "program management", "research strategy", "head of research", "research lead", "grant", "wetenschappelijk", "onderzoek"],
  federal: ["federal government", "federal agenc*", "government agenc*", "public sector", "public administration", "government", "ministry", "municipal", "european commission", "rijksoverheid", "ministerie", "gemeente", "provincie", "waterschap", "overheid"],
  transport_modeling: ["transportation", "travel demand", "mobility", "transit", "forecasting", "traffic", "infrastructure", "mobiliteit", "verkeersmodel", "vervoersmodel", "verkeer en vervoer"],
  urban_planning: ["urban planning", "regional planning", "land use", "spatial planning", "urban development", "city planning", "smart city", "ruimtelijke ordening", "ruimtelijke planning", "stedelijke ontwikkeling", "gebiedsontwikkeling"],
  gis: ["gis", "geospatial", "arcgis", "qgis", "spatial analysis", "geographic information", "geo-informatie", "geografische informatie"],
  policy_research: ["public policy", "policy research", "survey", "social science", "evidence-based", "policy analysis", "stakeholder", "beleidsonderzoek", "beleidsevaluatie", "beleidsanalyse", "beleidsadvies"],
  social_policy: ["housing", "affordab*", "ageing", "aging", "older adults", "livability", "community development", "social policy", "volkshuisvesting", "woningmarkt", "ouderenbeleid", "leefbaarheid"],
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
  software: ["python", "javascript", "typescript", "software engineering", "serverless", "distributed systems", "cloud infrastructure"],
  physics_theory: ["theoretical physics", "quantum field theory", "renormali*", "effective field theory", "statistical mechanics", "perturbation theory", "path integral", "condensed matter", "particle physics", "high energy physics"],
  high_dim_stats: ["high-dimensional", "high dimensional", "regulari*", "lasso", "dimensionality reduction", "shrinkage", "penali*"],
  numerics: ["numerical", "simulation", "monte carlo", "optimization", "scientific computing", "linear algebra", "differential equations"],
  teaching: ["teaching", "lecturer", "instructor", "curriculum", "tutor"],
  writing: ["technical writing", "peer-reviewed", "scientific writing", "publications", "report writing"],
};
const TITLE_MEDIUM = ["product manager", "program manager", "programme manager", "principal", "director", "head of", "lead", "strategist", "manager", "analyst", "advisor", "adviser", "consultant", "researcher", "specialist", "policy", "research"];
const SENIOR_RE = /\b(senior|sr\.?|lead|head|director|principal|chief|vp|vice president|staff|manager|partner|executive)\b/i;
const MANAGE_RE = /\b(head of|director|manager|lead|chief|vp|vice president)\b/i;
// hard noise: never your lane, whatever else the title says
const ABSOLUTE_EXCLUDE = ["intern", "junior", "entry", "graduate", "new grad", "apprentice", "trainee", "engineer", "architect", "counsel", "attorney", "lawyer", "paralegal", "legal", "marketing", "forward deployed", "deployment strategist",
  "sales", "account executive", "account manager", "business development", "recruit", "talent", "payroll", "accountant", "accounting", "treasury", "fp&a", "tax ", "facilities", "warehouse", "driver", "nurse", "technician",
  "customer success", "customer support", "customer service", "support specialist", "financial", "webinar", "solutions", "devops", "site reliability", "designer", "finance", "people partner", "hr ", "receptionist", "assistant",
  "stagiair", "stageplaats", "afstudeer", "assistent", "administratief", "secretaresse", "verpleegkundige", "chauffeur", "jurist", "juridisch", "advocaat", "controller", "salaris", "monteur", "schoonmaak", "beveiliger", "handhaver", "toezichthouder", "rechercheur", "boa ", "verpleegkundig", "stage "];   // the Dutch forms of the same noise (JOBSEARCH-NL-PUBLIC-SECTOR-1)
const TITLE_EXCLUDE_SOFT = ["scientist"];
const ENGINEERING_WORDS = ["engineer", "architect"];   // excluded unless the title is a research-engineering title and the posting shows evidence of the owner record
const LOC_BAD_REMOTE = ["us only", "united states only", "us-only", "usa only", "canada only", "uk only", "india only", "latam", "apac only"];
const HOME = ["amsterdam", "netherlands", "nederland", "rotterdam", "utrecht", "eindhoven", "the hague", "den haag", "delft", "leiden", "groningen", "haarlem", "almere", "amersfoort",
  "maastricht", "zwolle", "arnhem", "nijmegen", "tilburg", "apeldoorn", "enschede", "zoetermeer", "dordrecht", "leeuwarden", "alkmaar", "deventer", "hilversum", "amstelveen", "lelystad", "heerlen", "roermond", "hoofddorp", "nieuwegein", "zaandam", "zaanstad", "schiedam", "wageningen", "veenendaal", "hengelo", "almelo", "middelburg", "vlissingen", "rijswijk", "zeist", "bilthoven", "venlo", "helmond", "hertogenbosch", "den bosch", "noord-holland", "zuid-holland", "flevoland", "gelderland", "overijssel", "drenthe", "friesland"];   // JOBSEARCH-NL-PUBLIC-SECTOR-1: Dutch government postings name any municipality; names under six letters stay out because the test is a substring (ede is in sweden)
const REGION_WIDE = ["europe", "emea", "european", "eu ", "eu-", "worldwide", "anywhere", "global"];
const EUROPE_OTHER = ["germany", "berlin", "munich", "france", "paris", "london", "uk", "united kingdom", "ireland", "dublin", "spain", "madrid", "barcelona", "portugal", "lisbon", "italy", "belgium", "brussels", "denmark", "copenhagen", "sweden", "stockholm", "norway", "oslo", "finland", "helsinki", "austria", "vienna", "switzerland", "zurich", "poland", "warsaw", "czech", "prague", "luxembourg", "estonia", "latvia", "lithuania", "hungary", "romania", "greece", "croatia", "slovenia", "slovakia", "bulgaria", "malta", "cyprus"];
const US_RE = /\b(us|usa|united states|san francisco|new york|seattle|washington|boston|austin|chicago|los angeles|palo alto|mountain view|menlo park|sf|nyc|dc)\b|, (ca|ny|wa|ma|tx|il|dc)\b/;
const CORE = new Set(["federal", "policy_research", "transport_modeling", "research_mgmt", "urban_planning", "social_policy", "contracting"]);
const FRONTIER = new Set(["ai_systems", "research_integrity"]);
const DATA_SIDE = new Set(["data_product", "data_science", "survey_methods", "ai_systems", "gis"]);
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const EUROPE_OTHER_RE = EUROPE_OTHER.map((k) => new RegExp("\\b" + escRe(k) + "\\b"));
// Keywords match whole words; a trailing * allows an intentional stem to continue to the word end.
const KW_RE = new Map();
const kwRe = (k) => { let r = KW_RE.get(k); if (!r) { const stem = k.endsWith("*"); const term = stem ? k.slice(0, -1) : k; r = new RegExp("(?<![a-z])" + escRe(term) + (stem ? "[a-z]*" : "(?![a-z])")); KW_RE.set(k, r); } return r; };
const has = (text, kws) => kws.filter((k) => kwRe(k).test(text));
const STOP_TOKENS = new Set(["senior", "lead", "head", "manager", "director", "principal", "global", "europe", "remote", "team", "and", "for", "the", "with", "staff", "group", "associate"]);
const tokens = (title) => [...new Set(String(title || "").toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 4 && !STOP_TOKENS.has(t)))];

// ctx = what the owner told us. answers: {id: true|false|null}; learned: {boost:Set, block:Set} from likes and dislikes of real postings
const COMPANY_SUFFIX = /(^|\s)(b\.?v\.?|n\.?v\.?|inc\.?|ltd\.?|llc|gmbh|plc|s\.?a\.?|co\.?)(?=$|\s)/g;
const OPT_IN_FAMILIES = new Set(["fam_edu"]);
const coKey = (c) => String(c || "").toLowerCase().replace(COMPANY_SUFFIX, " ").replace(/[^a-z0-9]+/g, "");
function makeCtx(answers, feedback, outcomeWeights = {}, owned = null) {
  const a = {};
  for (const [id, , , def] of SURVEY) a[id] = answers && Object.prototype.hasOwnProperty.call(answers, id) && answers[id] !== undefined ? answers[id] : def;
  const fam = new Set(Object.keys(FAMILIES).filter((k) => a[k] !== false && !(OPT_IN_FAMILIES.has(k) && a[k] !== true)));   // teaching and academic titles need a yes: an unanswered question must not surface every lectureship
  const like = {}, dis = {};
  const co = {};
  // what a rejection teaches depends on why: "field" counts double for the title words, "level", "location" and "applied" teach nothing about the words, "company" blocks the employer at once
  for (const f of feedback || []) {
    const teachesWords = !["level", "location", "applied"].includes(f.reason), w = f.reason === "field" ? 2 : 1;
    if (teachesWords) for (const t of tokens(f.title)) { const m = f.verdict === "like" ? like : dis; m[t] = (m[t] || 0) + w; }
    const k = coKey(f.company);
    if (k) { const o = co[k] || (co[k] = { like: 0, dis: 0 }); if (f.verdict === "like") o.like++; else if (f.reason !== "applied") o.dis += f.reason === "company" ? 3 : 1; }
  }
  const boost = new Set(Object.keys(like).filter((t) => !dis[t])), block = new Set(Object.keys(dis).filter((t) => dis[t] >= 2 && !like[t]));
  const coKeys = Object.keys(co);
  const coPen = new Set(coKeys.filter((k) => co[k].dis >= 2 && !co[k].like)), coDrop = new Set(coKeys.filter((k) => co[k].dis >= 4 && !co[k].like)), coBoost = new Set(coKeys.filter((k) => co[k].like >= 1 && !co[k].dis));
  return { a, fam, learned: { boost, block, coPen, coDrop, coBoost }, outcomeWeights, owned };
}
const DEFAULT_CTX = makeCtx({}, []);   // owned = null: every cluster counts as evidence (the unit tests and the unauthenticated paths)

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
  const otherEu = EUROPE_OTHER_RE.some((re) => re.test(l)) || /\b(serbia|ukraine|turkey|albania|bosnia|montenegro|macedonia|moldova|georgia|armenia)\b/.test(l);
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
  const wide = mode === "wide";                           // wider net: preferences the owner stated become a penalty and a "stretch" label instead of a drop
  let stretch = false;
  const drop = (reason, soft) => { if (wide && soft) { stretch = true; pen += 25; flags.push("OUTSIDE YOUR PREFERENCES: " + reason); } else drops.push(reason); };
  const famOn = [...ctx.fam].filter((k) => has(title, FAMILIES[k]).length);
  const hits = ABSOLUTE_EXCLUDE.filter((x) => title.includes(x));
  const hardHit = hits.some((x) => !ENGINEERING_WORDS.includes(x)), engHit = hits.length > 0 && !hardHit;
  // most postings are dropped by their title alone; those return before the expensive reading of the posting text (the run scores about ten thousand postings)
  const early = (reason) => ({ stretch: false, fit: 0, score: 0, tier: "C", clusters: [], unique: false, why: [], flags: [], drops: [reason], gate: "", locNote: "", families: [] });
  let cl = null;
  if (mode !== "analyze") {
    if (hardHit || (engHit && !(wide && famOn.includes("fam_tech")))) return early("role family below target or not your lane");
    if (engHit) { cl = clustersIn(desc, job.title); if (cl.size < 2) return early("role family below target or not your lane"); }
  } else if (hits.length) drops.push("role family below target or not your lane");
  const famOff = Object.keys(FAMILIES).filter((k) => !ctx.fam.has(k) && has(title, FAMILIES[k]).length);
  const medium = has(title, TITLE_MEDIUM);
  const soft = TITLE_EXCLUDE_SOFT.some((x) => title.includes(x));
  if (mode !== "analyze" && !famOn.length && !famOff.length && !medium.length && !soft) return early("title not in your role families");
  if (soft && !famOn.length) drop("role family excluded by title");
  if (!famOn.length && famOff.length) drop("family switched off in your preferences: " + famOff[0].replace("fam_", ""), true);
  if (!famOn.length && !medium.length) drop("title not in your role families");
  if (!cl) cl = clustersIn(desc, job.title);
  const [gate, locNote] = locationGate(job.location, desc.slice(0, 3000), ctx);
  if (gate === "fail") drop(locNote, /not selected/.test(locNote));
  if (gate === "check" && locNote === "location missing" && mode !== "analyze") drop("no location in the posting; it cannot be placed against your preferences");
  else if (gate === "check") { flags.push("LOCATION: " + locNote); pen += /^(Elsewhere|Europe)/.test(locNote) ? 15 : 10; }
  if (!famOn.length && cl.size < 2) drop("generic title and thin evidence in the posting");
  if (famOn.length && !cl.size) pen += 15;
  const tScore = famOn.length ? 40 : (medium.length >= 2 || medium.includes("research")) ? 20 : 12;
  const eScore = Math.min(45, 9 * cl.size);
  const eOwned = ctx.owned ? Math.min(45, [...cl].reduce((sum, c) => sum + (ctx.owned.has(c) ? 9 : 4), 0)) : eScore;   // evidence the CV can back up counts in full, evidence it lacks counts less
  const uniqA = [...cl].some((c) => CORE.has(c)) && [...cl].some((c) => FRONTIER.has(c));
  const uniqB = [...cl].some((c) => CORE.has(c)) && [...cl].some((c) => DATA_SIDE.has(c));
  if (famOn.length) why.push("title in your lane: " + famOn.slice(0, 2).map((k) => k.replace("fam_", "")).join(", ")); else why.push("generic title: " + medium.slice(0, 2).join(", "));
  why.push(cl.size ? "evidence in the posting: " + [...cl].sort().join(", ") : "no matching evidence in the posting text");
  const lacking = ctx.owned ? [...cl].filter((c) => !ctx.owned.has(c)) : [];
  if (lacking.length) why.push("not in your CV yet: " + lacking.sort().join(", "));
  if (uniqA) why.push("uncommon intersection: research-program or policy-research management + AI or research-integrity systems");
  else if (uniqB) why.push("uncommon intersection: public-policy or planning expertise + data and analytics");
  let score = tScore + eOwned + (uniqA || uniqB ? 15 : 0);
  const outcomeDelta = Math.max(-12, Math.min(12, scoreFeatures(famOn, cl).reduce((sum, feature) => {
    const weight = Number(ctx.outcomeWeights && ctx.outcomeWeights[feature]);
    return sum + (Number.isFinite(weight) ? weight : 0);
  }, 0)));
  score += outcomeDelta;
  if (outcomeDelta > 0) why.push("past application outcomes favor these posting signals");
  else if (outcomeDelta < 0) why.push("past application outcomes weigh these posting signals less");
  const senior = SENIOR_RE.test(job.title || "");
  if (!senior) { if (ctx.a.lvl_mid === false) drop("below senior level (preference)", true); else if (ctx.a.lvl_mid !== true) { pen += 6; why.push("no seniority marker in the title"); } }
  if (ctx.a.lvl_manage === false && MANAGE_RE.test(job.title || "")) pen += 15;
  if (ctx.a.type_contract === false && /\b(contract|freelance|interim|temporary)\b/.test(title)) drop("contract work not selected", true);
  const tk = tokens(job.title);
  if (tk.some((t) => ctx.learned.boost.has(t))) { score += 10; why.push("looks like roles you liked: " + tk.filter((t) => ctx.learned.boost.has(t)).slice(0, 2).join(", ")); }
  const ck = coKey(job.company);
  if (ctx.learned.coDrop && ctx.learned.coDrop.has(ck)) drops.push("you rejected several roles at this employer");
  else if (ctx.learned.coPen && ctx.learned.coPen.has(ck)) { pen += 20; why.push("you rejected roles at this employer before"); }
  else if (ctx.learned.coBoost && ctx.learned.coBoost.has(ck)) { score += 8; why.push("you liked or applied to a role at this employer"); }
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
  const tier = stretch ? "C" : score >= 70 && cl.size ? "A" : score >= 35 ? "B" : "C";
  return { stretch, fit, score, tier, clusters: [...cl].sort(), unique: uniqA || uniqB, why, flags, drops, gate, locNote, families: famOn };
}
function evaluate(job, ctx = DEFAULT_CTX, wide = false) {
  const r = scoreJob(job, ctx, wide ? "wide" : "rank");
  if (r.drops.length) return { status: "excluded", reason: r.drops[0] };
  return { status: "ok", score: r.score, tier: r.tier, clusters: r.clusters, unique: r.unique, why: r.why, flags: r.flags, stretch: r.stretch };
}
// wide: tier C ("stretch": outside the stated preferences, or a thin fit) is kept when the score is at least 25, so the owner sees the whole range and decides
function rank(jobs, ctx = DEFAULT_CTX, wide = false) {
  const ok = [], excl = {};
  for (const j of jobs) {
    const r = evaluate(j, ctx, wide);
    if (r.status === "ok" && (r.tier !== "C" || (wide && r.score >= 25))) ok.push({ ...j, match: r });
    else { const k = (r.reason || "score below threshold").replace(/:.*/, ""); excl[k] = (excl[k] || 0) + 1; }
  }
  ok.sort((a, b) => b.match.score - a.match.score);
  return [ok, excl];
}

// ------------------------------------------------------------------ tailoring + verification (port of tailor.py)
// ------------------------------------------------------------------ CV bank (JOBSEARCH-CV-1)
// The claim ledger is the owner's CV bank: roles, achievements, publications, credentials. It lives in D1 (jobsearch_bank, edited on /cv),
// BANK_SEED is only the first value. Every resume sentence is still copied from the bank and re-verified line by line.
const BANK_SEED = {"version":2,"rev":0,"person":{"name":"Rowan Brad Quni-Gudzinas","also_published_as":"Brad Gudzinas","location":"Amsterdam, Netherlands","email":"rowan.quni@qnfo.org","sign_in_email":"rwnquni@outlook.com","links":{"site":"https://qnfo.org","papers":"https://papers.qnfo.org","linkedin":"https://www.linkedin.com/in/rowan-quni/","orcid":"https://orcid.org/0009-0002-4317-5604"},"career_start":2004},"summaries":[{"id":"S1","tags":[],"text":"Data and AI leader who builds the systems behind the research. 15 years running national research programs and data products at the U.S. Federal Highway Administration and AARP. Founder of QNFO, an independent research imprint with an AI-assisted pipeline, a published audit method, and a public correction trail. Open to research management, applied AI, and research-integrity roles."}],"roles":[{"id":"R01","title":"Founder","org":"QNFO (independent research)","location":"","start":"2024","end":"present","tags":["research_integrity","llm","quantum","software"]},{"id":"R02","title":"Executive Director and Founder","org":"Empowering Change (nonprofit)","location":"San Francisco, CA","start":"2023","end":"2024","tags":["nonprofit","leadership","llm"]},{"id":"R03","title":"Platform Data Product Manager","org":"iManage","location":"","start":"2022","end":"2023","tags":["product","data_eng"]},{"id":"R04","title":"Senior Product Manager","org":"Epsilon (Publicis Groupe)","location":"","start":"2021","end":"2022","tags":["product","data_eng"]},{"id":"R05","title":"Product Manager and Senior Methods Advisor","org":"AARP Public Policy Institute","location":"Washington, DC","start":"2016","end":"2021","tags":["product","policy","statistics"]},{"id":"R06","title":"Senior Data Scientist","org":"The Advisory Board Company","location":"","start":"2016","end":"2016","tags":["ml","statistics"]},{"id":"R07","title":"Senior Associate, Data Analytics","org":"Deloitte Consulting LLP","location":"Washington, DC","start":"2015","end":"2016","tags":["consulting","ml","policy"]},{"id":"R08","title":"Data Analyst and Research Manager","org":"U.S. Department of Transportation, Federal Highway Administration","location":"Washington, DC","start":"2011","end":"2015","tags":["research_mgmt","transport","statistics","contracting"]},{"id":"R09","title":"Consultant","org":"IBI Group","location":"","start":"2008","end":"2011","tags":["transport","consulting"]},{"id":"R10","title":"Systems Planner","org":"Delaware Valley Regional Planning Commission","location":"","start":"2005","end":"2008","tags":["transport","gis"]},{"id":"R11","title":"GIS Analyst","org":"Cross County Connection TMA","location":"","start":"2004","end":"2005","tags":["gis","transport"]}],"facts":[{"id":"F01","role":"R08","text":"Managed a $1.5M+ federal research portfolio as a certified Contracting Officer's Representative: technical oversight, budgets, milestones, and acceptance of contractor deliverables.","tags":["contracting","leadership","research_mgmt"],"source":"verified_cv","status":"verified","pitch":"At the Federal Highway Administration I managed a $1.5M+ federal research portfolio as a certified Contracting Officer's Representative."},{"id":"F02","role":"R08","text":"Led technical components of the national Tour-Based Model System for long-distance passenger travel forecasting.","tags":["contracting","data_eng","policy","product","statistics","transport"],"source":"verified_cv","status":"verified","pitch":"I led technical components of the national Tour-Based Model System for long-distance passenger travel forecasting."},{"id":"F03","role":"R05","text":"Led the AARP Livability Index: 50+ data sources across 7 domains, scoring U.S. neighborhoods nationwide, across multiple public releases.","tags":["data_eng","gis","policy","product","statistics","writing"],"source":"verified_cv","status":"verified","pitch":"At AARP I led the Livability Index: 50+ data sources across 7 domains, scoring U.S. neighborhoods nationwide."},{"id":"F04","role":"R05","text":"The Index and its method are cited in 20+ academic and policy studies.","tags":["policy","writing"],"source":"verified_cv","status":"verified","pitch":"The Livability Index and its method are cited in 20+ academic and policy studies."},{"id":"F05","role":"R05","text":"Co-authored the Livability Index 2018 report and AARP policy work on housing affordability, including the 2016 analysis of Low-Income Housing Tax Credits.","tags":["policy","writing"],"source":"verified_cv","status":"verified","pitch":"I co-authored the Livability Index 2018 report and AARP policy work on housing affordability."},{"id":"F06","role":"R01","text":"Built and run an autonomous research system on Cloudflare (44+ live workers) that drafts, referees, revises, versions, publishes, and corrects papers.","tags":["llm","research_integrity","research_mgmt","software"],"source":"verified_cv","status":"verified","pitch":"I built and run an autonomous research system on Cloudflare (44+ live workers) that drafts, referees, revises, versions, publishes, and corrects papers."},{"id":"F07","role":"R01","text":"Designed the audit method: The Universal Ignorance Audit and Epistemic Legibility in AI-Assisted Science.","tags":["llm","research_integrity","software"],"source":"verified_cv","status":"verified","pitch":"I designed a published audit method for AI-assisted research: The Universal Ignorance Audit and Epistemic Legibility in AI-Assisted Science."},{"id":"F08","role":"R01","text":"Proposed JPCUB, a whole-system energy benchmark for computing (joules per correct answer), with a measurement protocol, estimates for 17 quantum platforms, and an extension to LLM inference.","tags":["llm","numerics","quantum","software"],"source":"verified_cv","status":"verified","pitch":"I proposed JPCUB, a whole-system energy benchmark for computing (joules per correct answer), with estimates for 17 quantum platforms and an extension to LLM inference."},{"id":"F09","role":"R01","text":"Publish an open library of preprints with DOIs and a queryable knowledge graph.","tags":["research_integrity"],"source":"verified_cv","status":"verified","pitch":"I publish an open library of preprints with DOIs and a queryable knowledge graph."},{"id":"F10","role":"R02","text":"Built an LLM legal-navigation tool for self-represented litigants: document drafting, procedural guidance, and plain-language translation of legal terms.","tags":["llm","nonprofit","software"],"source":"verified_cv","status":"verified","pitch":"I built an LLM legal-navigation tool for self-represented litigants: document drafting, procedural guidance, and plain-language translation of legal terms."},{"id":"F11","role":"R02","text":"Took the nonprofit from incorporation to public launch.","tags":["leadership","nonprofit","research_mgmt"],"source":"verified_cv","status":"verified","pitch":"As Executive Director and Founder of Empowering Change I took the nonprofit from incorporation to public launch."},{"id":"F12","role":"R07","text":"Delivered analytics and machine-learning engagements for federal and public-sector clients.","tags":["consulting","contracting","ml","statistics"],"source":"verified_cv","status":"verified","pitch":"At Deloitte I delivered analytics and machine-learning engagements for federal and public-sector clients."},{"id":"F13","role":"R07","text":"Co-authored a 2016 Transportation Research Board paper on updating the National Household Travel Survey with American Community Survey data.","tags":["policy","statistics","transport","writing"],"source":"verified_cv","status":"verified","pitch":"I co-authored a 2016 Transportation Research Board paper on updating the National Household Travel Survey with American Community Survey data."},{"id":"F14","role":"R08","text":"Presented national long-distance travel data needs at the 2011 TRB National Household Travel Survey workshop.","tags":["policy","statistics","transport","writing"],"source":"verified_cv","status":"verified","pitch":"I presented national long-distance travel data needs at the 2011 TRB National Household Travel Survey workshop."}],"publications":[{"id":"P01","title":"The Joules-per-Solution Metric: Definition, Measurement Protocol, and Anti-Gaming Provisions","year":2026,"doi":"","tags":["quantum","numerics","research_integrity"]},{"id":"P02","title":"Error Correction Is a Landauer Machine: The Thermodynamic Floor of Quantum Error-Correction Overhead","year":2026,"doi":"","tags":["quantum","physics_theory"]},{"id":"P03","title":"The Universal Ignorance Audit","year":2026,"doi":"","tags":["research_integrity","llm"]},{"id":"P04","title":"Operating the Quniverse Fleet: Objectives, Successes, Failures, and Roadmap of an Autonomous Cloud Research System","year":2026,"doi":"","tags":["llm","software","research_integrity"]},{"id":"P05","title":"Epistemic Legibility in AI-Assisted Science","year":2026,"doi":"","tags":["research_integrity","llm"]},{"id":"P06","title":"AARP Livability Index 2018 report (co-author, as Brad Gudzinas)","year":2018,"doi":"","tags":["policy","statistics","gis"]},{"id":"P07","title":"Tour-Based National Model System, FHWA (as Brad Gudzinas)","year":2014,"doi":"","tags":["transport","statistics"]},{"id":"P08","title":"Updating the National Household Travel Survey with American Community Survey data (TRB, co-author)","year":2016,"doi":"","tags":["transport","statistics","policy"]}],"education":["M.S., City and Regional Studies, Rutgers University, Edward J. Bloustein School of Planning and Public Policy (2008)","B.A., Urban Studies and Community Planning, Rutgers University-Camden (2004)"],"certifications":["Project Management Professional (PMP), Project Management Institute (2016)","Contracting Officer's Representative (COR), Defense Acquisition University (2011)","American Institute of Certified Planners (AICP), American Planning Association (2009)"],"skills":[{"name":"Research program management","tags":["research_mgmt"]},{"name":"Federal contract oversight","tags":["contracting"]},{"name":"Product management","tags":["product"]},{"name":"Statistical modeling","tags":["statistics"]},{"name":"Travel-demand modeling","tags":["transport"]},{"name":"GIS","tags":["gis"]},{"name":"LLM agent systems","tags":["llm"]},{"name":"Cloudflare Workers, D1, R2, Vectorize","tags":["software","data_eng"]},{"name":"Python","tags":["software","numerics"]},{"name":"JavaScript","tags":["software"]},{"name":"SQL","tags":["data_eng"]},{"name":"Machine learning","tags":["ml"]},{"name":"Data science","tags":["ml","statistics"]}],"review":[{"id":"V1","role":"R08","tags":["transport","statistics","research_mgmt"],"text":"Co-directed the $10M U.S. DOT National Household Travel Survey.","why":"Appears in your Oct 1 identity-kit draft but was removed from your verified CV. Confirm only if true; edit the wording to what you actually did."},{"id":"V2","role":"R04","tags":["ml","product"],"text":"Led predictive analytics deployments at Epsilon (Publicis Groupe).","why":"From the same draft; not in the verified CV. Confirm only if true."},{"id":"V3","role":"","tags":["physics_theory","quantum"],"text":"Inventor on U.S. patent(s) in quantum computing: [add patent numbers and titles].","why":"Your GitHub profile mentions patents; none found in a patent search. A patent claim without numbers will be checked, so add the numbers or reject."}],"answers":{}};
const QUESTIONS = [{"id":"phys_qft","section":"Physics & theory","ask":"Have you done quantum field theory or particle-physics calculations (any level: research, thesis, independent work)?","tags":["physics_theory"]},{"id":"phys_renorm","section":"Physics & theory","ask":"Have you used renormalization, dimensional regularization, or effective field theory methods?","tags":["physics_theory","high_dim_stats"]},{"id":"phys_statmech","section":"Physics & theory","ask":"Have you worked with statistical mechanics, lattice methods, or path-integral techniques?","tags":["physics_theory","numerics"]},{"id":"phys_quantum_info","section":"Physics & theory","ask":"Have you worked on quantum computing, quantum information, or quantum algorithms?","tags":["quantum"]},{"id":"phys_benchmark","section":"Physics & theory","ask":"Have you designed benchmarks, measurement protocols, or resource estimates for computing hardware or algorithms?","tags":["quantum","numerics","research_integrity"]},{"id":"phys_papers","section":"Physics & theory","ask":"Have you authored or co-authored physics/theory papers or preprints?","tags":["physics_theory","writing"]},{"id":"stat_highdim","section":"Statistics & ML","ask":"Have you handled high-dimensional data (more variables than observations, regularized regression, lasso/ridge, dimensionality reduction)?","tags":["high_dim_stats","statistics","ml"]},{"id":"stat_bayes","section":"Statistics & ML","ask":"Have you built Bayesian or hierarchical models?","tags":["statistics"]},{"id":"stat_causal","section":"Statistics & ML","ask":"Have you done causal inference, program evaluation, or experiment/A-B test design?","tags":["statistics","policy"]},{"id":"stat_survey","section":"Statistics & ML","ask":"Have you designed, weighted, fused, or analyzed survey data?","tags":["statistics","transport","policy"]},{"id":"stat_forecast","section":"Statistics & ML","ask":"Have you built forecasting, simulation, or demand models?","tags":["statistics","transport","numerics"]},{"id":"ml_train","section":"Statistics & ML","ask":"Have you trained or deployed machine-learning models?","tags":["ml"]},{"id":"ml_index","section":"Statistics & ML","ask":"Have you built a composite index or scoring system from many data sources?","tags":["statistics","data_eng","policy"]},{"id":"num_sim","section":"Statistics & ML","ask":"Have you written numerical simulation, Monte Carlo, or optimization code?","tags":["numerics","software"]},{"id":"llm_build","section":"AI systems","ask":"Have you built LLM-based applications or agents?","tags":["llm","software"]},{"id":"llm_rag","section":"AI systems","ask":"Have you built retrieval (RAG), vector search, or knowledge-graph systems?","tags":["llm","data_eng"]},{"id":"llm_eval","section":"AI systems","ask":"Have you built evaluations, red-team tests, or quality/verification gates for AI output?","tags":["llm","research_integrity"]},{"id":"llm_safety","section":"AI systems","ask":"Have you worked on AI safety, governance, auditing, or responsible-AI methods?","tags":["research_integrity","llm","policy"]},{"id":"llm_autonomy","section":"AI systems","ask":"Have you designed autonomous multi-step pipelines (scheduled, self-monitoring, self-correcting)?","tags":["llm","software","research_integrity"]},{"id":"sw_python","section":"Software & data","ask":"Do you write production or research Python?","tags":["software"]},{"id":"sw_js","section":"Software & data","ask":"Do you write JavaScript/TypeScript?","tags":["software"]},{"id":"sw_cloud","section":"Software & data","ask":"Have you built and operated cloud/serverless systems (Cloudflare, AWS, etc.)?","tags":["software","data_eng"]},{"id":"sw_sql","section":"Software & data","ask":"Have you designed databases or data pipelines (SQL, ETL)?","tags":["data_eng"]},{"id":"sw_oss","section":"Software & data","ask":"Have you published open-source code or datasets?","tags":["software","research_integrity"]},{"id":"sw_gis","section":"Software & data","ask":"Have you done GIS or geospatial analysis?","tags":["gis","transport"]},{"id":"mgmt_portfolio","section":"Management & leadership","ask":"Have you managed a research/program portfolio or budget?","tags":["research_mgmt","contracting"]},{"id":"mgmt_contract","section":"Management & leadership","ask":"Have you overseen contractors, grants, or procurements?","tags":["contracting","research_mgmt"]},{"id":"mgmt_team","section":"Management & leadership","ask":"Have you directly managed or mentored people?","tags":["leadership"]},{"id":"mgmt_found","section":"Management & leadership","ask":"Have you founded or launched an organization, product, or program from zero?","tags":["leadership","nonprofit","product"]},{"id":"mgmt_product","section":"Management & leadership","ask":"Have you owned a product roadmap or shipped a data product to users?","tags":["product"]},{"id":"mgmt_stake","section":"Management & leadership","ask":"Have you briefed executives, legislators, or external stakeholders?","tags":["policy","leadership","writing"]},{"id":"mgmt_funding","section":"Management & leadership","ask":"Have you written grant proposals or raised funding?","tags":["research_mgmt","nonprofit","writing"]},{"id":"pol_housing","section":"Policy & planning","ask":"Have you done housing, aging, or social-policy analysis?","tags":["policy"]},{"id":"pol_transport","section":"Policy & planning","ask":"Have you done transportation, land-use, or urban-planning work?","tags":["transport","policy"]},{"id":"pol_climate","section":"Policy & planning","ask":"Have you worked on climate, energy, or sustainability topics?","tags":["policy","quantum"]},{"id":"pol_intl","section":"Policy & planning","ask":"Have you worked with international/EU/Dutch institutions or in a non-US context?","tags":["policy","consulting"]},{"id":"pub_peer","section":"Writing & teaching","ask":"Have you published peer-reviewed papers, reports, or conference talks?","tags":["writing","research_integrity"]},{"id":"pub_review","section":"Writing & teaching","ask":"Have you reviewed papers or run a peer-review/referee process?","tags":["research_integrity","writing"]},{"id":"pub_teach","section":"Writing & teaching","ask":"Have you taught, tutored, or trained people (courses, workshops)?","tags":["teaching"]},{"id":"pub_cited","section":"Writing & teaching","ask":"Has your work been cited, adopted, or used by others (cite counts, downloads, users)?","tags":["writing","policy"]},{"id":"cons_client","section":"Consulting","ask":"Have you delivered client-facing consulting engagements?","tags":["consulting"]},{"id":"cons_analytics","section":"Consulting","ask":"Have you delivered analytics or ML for government/regulated clients?","tags":["consulting","ml","policy"]},{"id":"misc_other","section":"Anything else","ask":"Is there something you've done that none of the above covers but you'd want an employer to know?","tags":[]}];
// CV topic tag -> posting evidence clusters (CLUSTER_KW keys). The owner's tags drive what counts as evidence the owner can back up.
const TAG_TO_CLUSTERS = {
  statistics: ["survey_methods"], ml: ["data_science"], llm: ["ai_systems"], quantum: ["quantum_energy"], research_mgmt: ["research_mgmt"],
  contracting: ["contracting", "federal"], product: ["product"], policy: ["policy_research", "social_policy"], transport: ["transport_modeling", "urban_planning"],
  gis: ["gis"], leadership: ["program_mgmt"], nonprofit: ["nonprofit"], research_integrity: ["research_integrity"], consulting: ["consulting"],
  data_eng: ["data_product"], software: ["software"], physics_theory: ["physics_theory"], high_dim_stats: ["high_dim_stats", "survey_methods"],
  numerics: ["numerics"], teaching: ["teaching"], writing: ["writing"],
};
const clustersOf = (tags) => [...new Set((tags || []).flatMap((t) => TAG_TO_CLUSTERS[t] || []))];
const STATIC_BASE = ["Hello,", "Best regards,", "## Experience highlights", "## Credentials", "## Experience", "## Earlier roles", "## Selected work", "## Education", "## Certifications", "## Skills", "**Other experience**"];
const endYr = (r) => (/present/i.test(r.end) ? 9999 : parseInt(r.end, 10) || 0);
const byRecency = (a, b) => endYr(b) - endYr(a) || (parseInt(b.start, 10) || 0) - (parseInt(a.start, 10) || 0);
const rolePeriod = (r) => (r.start === r.end ? r.start : `${r.start} to ${r.end}`);
const roleHead = (r) => `**${r.title}**, ${r.org}${r.location ? ", " + r.location : ""} | ${rolePeriod(r)}`;
const roleLite = (r) => `${r.title}, ${r.org} (${rolePeriod(r)})`;
const pubLine = (p) => `${p.title} (${p.year})` + (p.doi ? `, https://doi.org/${p.doi}` : p.url ? `, ${p.url}` : "");
let BANK = BANK_SEED, BANK_REV = 0, OWNED = null, FACTS = {}, P = LEDGER.person, STATIC = new Set(), LEDGER_LOW = "", LEDGER_SKILLS = "";
const HEADS = Object.fromEntries(LEDGER.headlines.map((h) => [h.id, h]));
function applyBank(b, rev) {
  BANK = b; BANK_REV = rev || 0;
  const roles = Object.fromEntries((b.roles || []).map((r) => [r.id, r]));
  const rec = (f) => (roles[f.role] ? endYr(roles[f.role]) : 0);
  LEDGER.facts = (b.facts || []).filter((f) => f.status !== "rejected").map((f) => {
    const r = roles[f.role];
    return { id: f.id, role: f.role || "", text: f.text, pitch: f.pitch || f.text, tags: f.tags || [], cluster: clustersOf(f.tags), employer: r ? r.org : "", period: r ? rolePeriod(r) : "" };
  }).sort((x, y) => rec(y) - rec(x));
  LEDGER.person = { ...b.person };
  LEDGER.skills = (b.skills || []).map((s) => s.name.toLowerCase());
  LEDGER.ledger_verified_on = b.verified_on || LEDGER.ledger_verified_on;
  LEDGER_VERIFIED_ON = LEDGER.ledger_verified_on;
  FACTS = Object.fromEntries(LEDGER.facts.map((f) => [f.id, f]));
  P = LEDGER.person;
  STATIC = new Set([...STATIC_BASE, LEDGER.closing, P.name]);
  LEDGER_LOW = JSON.stringify([LEDGER, b]).toLowerCase();
  LEDGER_SKILLS = LEDGER.skills.join(" | ") + " | agile pmp";
  const owned = new Set();
  for (const f of LEDGER.facts) f.cluster.forEach((c) => owned.add(c));
  for (const r of b.roles || []) clustersOf(r.tags).forEach((c) => owned.add(c));
  for (const p of b.publications || []) clustersOf(p.tags).forEach((c) => owned.add(c));
  for (const s of b.skills || []) clustersOf(s.tags).forEach((c) => owned.add(c));
  OWNED = owned;
}
const tag = (line, t) => `${line} <!--${t}-->`;
const FORBIDDEN = ["kubernetes", "tensorflow", "pytorch", "java", "rust", "golang", "aws", "azure", "gcp", "spark", "docker", "react", "tableau", "power bi", "snowflake", "databricks", "scrum master", "six sigma", "cissp", "phd", "ph.d", "mba", "cfa", "security clearance", "fluent"];

function pickFacts(clusters, k) {
  const cl = new Set(clusters), scored = [];
  LEDGER.facts.forEach((f, i) => {
    const s = f.cluster.filter((c) => cl.has(c)).length;
    if (s) scored.push([-s, i, f]);
  });
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const picked = scored.slice(0, k).map((x) => x[2]);
  for (const f of LEDGER.facts) { if (picked.length >= k) break; if (!picked.includes(f)) picked.push(f); }   // postings outside the clusters still get verified facts, newest roles first
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
// Resume: summary, every recent role with the achievements that fit the posting (at most 3 per role, 9 in all), older roles on one line each,
// the publications that fit, education, certifications, skills. Each line is tagged with the bank record it is copied from.
function buildResume(job, m) {
  const cl = new Set(m.clusters), b = BANK, roles = [...(b.roles || [])].sort(byRecency);
  const jobTags = new Set(Object.entries(TAG_TO_CLUSTERS).filter(([, cs]) => cs.some((c) => cl.has(c))).map(([t]) => t));
  const per = {}, chosen = [];
  for (const f of pickFacts(m.clusters, 30)) { const k = f.role || "-"; per[k] = (per[k] || 0) + 1; if (per[k] > 3) continue; chosen.push(f); if (chosen.length >= 9) break; }
  const byRole = {};
  for (const f of chosen) (byRole[f.role] = byRole[f.role] || []).push(f);
  const summaries = (b.summaries || []).map((s) => [(s.tags || []).filter((t) => jobTags.has(t)).length, s]).sort((x, y) => y[0] - x[0]);
  const L = [tag("# " + P.name, "P"), tag(`${P.location} | ${P.email} | ${P.links.site} | ${P.links.linkedin}`, "P"), tag(`Earlier work is published under ${P.also_published_as}.`, "P"), ""];
  if (summaries.length) L.push(tag(summaries[0][1].text, "SUM:" + summaries[0][1].id), "");
  L.push(tag("## Experience", "S"));
  const recent = roles.filter((r) => endYr(r) >= 2011 || byRole[r.id]), older = roles.filter((r) => !recent.includes(r));
  for (const r of recent) { L.push("", tag(roleHead(r), "R:" + r.id)); for (const f of byRole[r.id] || []) L.push(tag("- " + f.text, "F:" + f.id)); }
  if (byRole[""] && byRole[""].length) { L.push("", tag("**Other experience**", "S")); for (const f of byRole[""]) L.push(tag("- " + f.text, "F:" + f.id)); }
  if (older.length) { L.push("", tag("## Earlier roles", "S")); for (const r of older) L.push(tag("- " + roleLite(r), "RL:" + r.id)); }
  const pubs = (b.publications || []).map((p) => [(p.tags || []).filter((t) => jobTags.has(t)).length, p]).sort((x, y) => y[0] - x[0] || y[1].year - x[1].year);
  const topPubs = pubs.filter((x) => x[0] > 0).slice(0, 4).concat(pubs.filter((x) => x[0] === 0).slice(0, 2)).slice(0, 4).map((x) => x[1]).sort((x, y) => y.year - x.year);
  if (topPubs.length) { L.push("", tag("## Selected work", "S")); for (const p of topPubs) L.push(tag("- " + pubLine(p), "PUB:" + p.id)); }
  if ((b.education || []).length) { L.push("", tag("## Education", "S")); b.education.forEach((e, i) => L.push(tag("- " + e, "EDU:" + i))); }
  if ((b.certifications || []).length) { L.push("", tag("## Certifications", "S")); b.certifications.forEach((e, i) => L.push(tag("- " + e, "CERT:" + i))); }
  const low = (job.desc + " " + job.title).toLowerCase();
  const sk = (b.skills || []).map((s) => [(s.tags || []).filter((t) => jobTags.has(t)).length + (low.includes(s.name.toLowerCase()) ? 2 : 0), s]).sort((x, y) => y[0] - x[0]);
  const names = sk.filter((x) => x[0] > 0).concat(sk.filter((x) => x[0] === 0)).slice(0, 10).map((x) => x[1].name);
  if (names.length) L.push("", tag("## Skills", "S"), tag(names.join(" · "), "K"));
  return L.join("\n") + "\n";
}
function buildNote(job, m) {
  const facts = pickFacts(m.clusters, 3), terms = jobTerms(job, m.clusters);
  const L = [tag("Hello,", "S"), "", tag(`I am applying for the ${job.title} role at ${job.company}.`, "J:title")];
  if (terms.length) L.push(tag("The posting mentions " + terms.map((t) => `"${t}"`).join(" and ") + ", which is the work I have done:", "J:terms:" + terms.join("|")));
  L.push("");
  for (const f of facts) L.push(tag(f.pitch !== f.text ? f.pitch : "- " + f.text, "F:" + f.id));
  L.push("", tag(LEDGER.closing, "S"), "", tag("Best regards,", "S"), tag(P.name, "S"));
  return L.join("\n") + "\n";
}
const nums = (s) => new Set(String(s).match(/\d[\d,.]*\+?/g) || []);
function verify(doc, job) {
  const bad = [];
  const allowed = new Set();
  const addAll = (set) => set.forEach((x) => allowed.add(x));
  addAll(nums(JSON.stringify(BANK))); addAll(nums(JSON.stringify(LEDGER.headlines)));
  addAll(nums(job.title)); addAll(nums(job.company));
  const allowedTrim = new Set([...allowed].map((x) => x.replace(/[.,]+$/, "")));
  const jd = (job.desc + " " + job.title).toLowerCase();
  const roleOf = (id) => (BANK.roles || []).find((r) => r.id === id);
  const unbullet = (s) => (s.startsWith("- ") ? s.slice(2) : s);
  doc.split("\n").forEach((raw, i) => {
    const n = i + 1;
    if (!raw.trim()) return;
    const m = raw.match(/^(.*?) <!--(.+)-->$/);
    if (!m) { bad.push(`L${n}: untagged line: ${raw.slice(0, 60)}`); return; }
    const text = m[1], t = m[2], kind = t.split(":")[0], arg = t.slice(kind.length + 1);
    if (kind === "F") {
      const f = FACTS[arg], body = unbullet(text);
      if (!f || (body !== f.text && body !== f.pitch)) bad.push(`L${n}: text does not equal ledger fact ${t}`);
    } else if (kind === "H") {
      const h = HEADS[arg];
      if (!h || text !== h.text) bad.push(`L${n}: headline differs from ledger ${t}`);
    } else if (kind === "SUM") {
      const s = (BANK.summaries || []).find((x) => x.id === arg);
      if (!s || text !== s.text) bad.push(`L${n}: summary differs from the CV ${t}`);
    } else if (kind === "R") {
      const r = roleOf(arg);
      if (!r || text !== roleHead(r)) bad.push(`L${n}: role line differs from the CV ${t}`);
    } else if (kind === "RL") {
      const r = roleOf(arg);
      if (!r || unbullet(text) !== roleLite(r)) bad.push(`L${n}: earlier-role line differs from the CV ${t}`);
    } else if (kind === "PUB") {
      const p = (BANK.publications || []).find((x) => x.id === arg);
      if (!p || unbullet(text) !== pubLine(p)) bad.push(`L${n}: publication differs from the CV ${t}`);
    } else if (kind === "EDU" || kind === "CERT") {
      const list = kind === "EDU" ? BANK.education : BANK.certifications;
      if (unbullet(text) !== (list || [])[+arg]) bad.push(`L${n}: ${kind === "EDU" ? "education" : "certification"} differs from the CV ${t}`);
    } else if (kind === "K") {
      const names = new Set((BANK.skills || []).map((s) => s.name));
      for (const s of text.split(" · ")) if (!names.has(s)) bad.push(`L${n}: skill not in the CV: ${s}`);
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
applyBank(BANK_SEED, 0);
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
    const [ok, ex] = rank(r.jobs, ctx, true);
    for (const [k, v] of Object.entries(ex)) excl[k] = (excl[k] || 0) + v;
    kept.push(...ok);
  }), 6);
  kept.sort((a, b) => b.match.score - a.match.score);
  return { kept, errors, excl, fetched, feeds: feedsList.length, feedResults };
}
// JOBSEARCH-LLM-RERANK-1: reorder-only re-rank of the top passing postings.
// The model may only reorder and add one sentence of reason per posting; it never writes resume or note text
// (drafts are still assembled from the ledger afterwards and re-verified). A failed, malformed or empty answer
// leaves the deterministic order untouched. The call goes through the qnfo-ai service binding with caller
// qnfo-jobsearch, and is skipped when it would cost more than the cheapest Workers AI model (BUDGET-SOFT-ROUTE-1).
// Working path (the first version asked a service binding named AI for an infer route that qnfo-ai does not have, and this worker never declared that binding,
// so it returned the deterministic order on every run). The model is called through the QNFO_AI service binding (props caller qnfo-jobsearch,
// CLAUDE.md 1703: no key copy) on the router's chat route, pinned to one cheap Workers AI model (BUDGET-SOFT-ROUTE-1: the router downgrades at a cap, never refuses).
// Deterministic guards, none of which trusts the model: (1) the answer must order every one of the numbered postings exactly once, otherwise the
// order stands; (2) a reason is shown only when reasonOk accepts it: one plain sentence, no first or second person, no markup or link, and every number
// and proper noun in it already appears in the posting or in the deterministic signals (a model cannot add a claim about the owner or the employer);
// (3) only match.why gets an "LLM: " line: score, tier, flags, the posting and the drafts are never touched, and the resume and note are built afterwards
// from the ledger and re-verified, so no model word can reach them. The outcome of each run is written to jobsearch_meta rerank_status.
const RERANK_TOP = 25;
const RERANK_MODEL = "@cf/zai-org/glm-5.3-flash";   // the cheapest model the floor policy allows; the router sets reasoning_effort low for an answer of at most 2048 tokens (REASONING-BUDGET-1)
const RERANK_SYSTEM = "You order job postings for one job seeker. You may ONLY reorder the numbered postings and write one short plain sentence per posting saying why it ranks where it does, using only words and numbers that appear in the posting fields or signals you are given. Never write or suggest resume, cover letter or note text, never say anything about the job seeker's experience, years, degrees, employers or skills, and never add a fact. Answer with JSON only: {\"order\":[posting numbers, best first, each number exactly once],\"reasons\":{\"<number>\":\"one sentence\"}}.";
const RERANK_SIGNAL_RE = /^(title in your lane|generic title|evidence in the posting|no matching evidence in the posting|uncommon intersection)/;
function rerankMessages(top) {
  const items = top.map((j, i) => ({ n: i + 1, title: j.title, company: j.company, location: j.location || "", score: j.match.score, signals: (j.match.why || []).filter((w) => RERANK_SIGNAL_RE.test(w)).slice(0, 4) }));   // posting-fit signals only: what the owner liked, rejected or applied to never leaves the worker
  return [{ role: "system", content: RERANK_SYSTEM }, { role: "user", content: JSON.stringify(items) }];
}
// {order: [0-based indexes], reasons: {index: text}} or null when the answer is not a full permutation of 1..n
function parseRerank(text, n) {
  const s = String(text || ""), a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  let o; try { o = JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
  if (!o || !Array.isArray(o.order) || o.order.length !== n) return null;
  const seen = new Set(), order = [];
  for (const v of o.order) {
    const k = Number(v);
    if (!Number.isInteger(k) || k < 1 || k > n || seen.has(k)) return null;
    seen.add(k); order.push(k - 1);
  }
  const reasons = {};
  if (o.reasons && typeof o.reasons === "object") for (const [k, v] of Object.entries(o.reasons)) { const i = Number(k) - 1; if (Number.isInteger(i) && i >= 0 && i < n && typeof v === "string") reasons[i] = v; }
  return { order, reasons };
}
// a reason the model wrote is displayed only when it makes no claim the posting does not make
function reasonOk(reason, job) {
  const r = String(reason == null ? "" : reason).replace(/\s+/g, " ").trim();
  if (r.length < 8 || r.length > 240) return null;
  if (/[<>`{}\[\]\\]|https?:|www\./i.test(r)) return null;
  if (/\b(i|i'm|i've|me|my|we|our|you|your|you're|candidate|applicant|owner)\b/i.test(r)) return null;
  const corpus = [job.title, job.company, job.location, String(job.desc || "").slice(0, 4000), ...((job.match && job.match.why) || [])].join(" ").toLowerCase();
  for (const m of r.matchAll(/\d[\d.,%+]*/g)) if (!corpus.includes(m[0].replace(/[.,]+$/, "").toLowerCase())) return null;
  const words = r.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/^[("']+|[)"'.,;:!?]+$/g, "");
    const acronym = /^[A-Z]{2,}$/.test(w), proper = i > 0 && /^[A-Z][a-z]{2,}$/.test(w) && !/[.!?:]$/.test(words[i - 1]);
    if ((acronym || proper) && !corpus.includes(w.toLowerCase())) return null;
  }
  return r;
}
async function rerankAsk(env, messages) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 45000);
  try {
    const r = await env.QNFO_AI.fetch("https://qnfo-ai.internal/v1/chat/completions", {
      method: "POST", headers: { "content-type": "application/json" }, signal: ac.signal,
      body: JSON.stringify({ model: RERANK_MODEL, messages, max_tokens: 2000, temperature: 0, stream: false }),
    });
    if (!r.ok) throw Object.assign(new Error("http " + r.status), { code: "http-" + r.status });
    const j = await r.json();
    return (j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
  } finally { clearTimeout(t); }
}
// returns {kept, status}; status is one of no-binding, empty, ok, reordered, bad-answer, http-NNN, error
async function llmRerankRun(env, kept) {
  if (!env.QNFO_AI || typeof env.QNFO_AI.fetch !== "function") return { kept, status: "no-binding" };
  if (kept.length < 2) return { kept, status: "empty" };
  const top = kept.slice(0, RERANK_TOP), rest = kept.slice(RERANK_TOP);
  let text;
  try { text = await rerankAsk(env, rerankMessages(top)); }
  catch (e) { logErr("llm-rerank", e); return { kept, status: (e && e.code) || "error" }; }
  const p = parseRerank(text, top.length);
  if (!p) return { kept, status: "bad-answer" };
  const next = p.order.map((i) => top[i]);
  next.forEach((j, k) => { j.match.why = (j.match.why || []).concat(["LLM: rank " + (k + 1) + " of " + next.length]); });   // the owner sees what the AI changed
  for (const [i, reason] of Object.entries(p.reasons)) {
    const ok = reasonOk(reason, top[i]);
    if (ok) top[i].match.why = (top[i].match.why || []).concat(["LLM: " + ok]);
  }
  return { kept: next.concat(rest), status: p.order.every((v, i) => v === i) ? "ok" : "reordered" };
}
async function llmRerank(env, kept) {
  try {
    const r = await llmRerankRun(env, kept);
    try { await setMeta(env, "rerank_status", r.status); await setMeta(env, "rerank_at", new Date().toISOString()); } catch (e) { logErr("llm-rerank-status", e); }
    return r.kept;
  } catch (e) { logErr("llm-rerank", e); return kept; }   // any failure: the deterministic order stands
}
function artifactsFor(j) {
  const res = buildResume(j, j.match), note = buildNote(j, j.match);
  const v = verify(res, j).concat(verify(note, j));
  return v.length ? { verified: 0, blocked: v.join("; "), resume: null, note: null } : { verified: 1, blocked: null, resume: stripTags(res), note: stripTags(note) };
}
// ------------------------------------------------------------------ preferences, feedback, "check a job" (JOBSEARCH-PROFILE-1)
async function loadCtx(env) {
  await ensure(env);
  await loadBank(env);
  let answers = {};
  const row = await env.JOBS_DB.prepare("SELECT v FROM jobsearch_prefs WHERE k='survey'").first();
  if (row) { try { answers = JSON.parse(row.v) || {}; } catch (e) { logErr("prefs-parse", e); } }
  const fb = (await env.JOBS_DB.prepare("SELECT title, company, verdict, reason FROM jobsearch_feedback ORDER BY id DESC LIMIT 800").all()).results;
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
  return makeCtx(answers, fb, outcomeScoreWeights(outcomeRows), OWNED);
}
async function getMeta(env, k) { const r = await env.JOBS_DB.prepare("SELECT v FROM jobsearch_meta WHERE k=?").bind(k).first(); return r ? r.v : null; }
const REASONS = ["field", "level", "location", "company", "applied", "other"];
async function addFeedback(env, title, company, verdict, source, reason = null) {
  await env.JOBS_DB.prepare("INSERT INTO jobsearch_feedback (ts, title, company, verdict, source, reason) VALUES (?1,?2,?3,?4,?5,?6)").bind(new Date().toISOString(), String(title || "").slice(0, 200), String(company || "").slice(0, 120), verdict, source, REASONS.includes(reason) ? reason : null).run();
}
const TECH_TERMS = ["python", "sql", "r ", "tableau", "power bi", "looker", "aws", "azure", "gcp", "kubernetes", "docker", "spark", "snowflake", "dbt", "airflow", "salesforce", "jira", "sap", "workday", "java", "javascript", "typescript", "react", "golang", "rust", "c++", "scala", "stata", "spss", "sas", "arcgis", "qgis", "postgis", "terraform", "excel", "agile", "scrum", "prince2", "six sigma", "lean", "safe"];
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
  const ctx = await loadCtx(env);   // also loads the CV bank
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
  const cvGaps = sc.clusters.filter((c) => !OWNED.has(c)).map((c) => ({ cluster: c, questions: QUESTIONS.filter((q) => clustersOf(q.tags).includes(c)).slice(0, 4).map((q) => ({ id: q.id, ask: q.ask })) }));
  const draft = bad.length ? { blocked: bad.join("; ") } : { resume: stripTags(res), note: stripTags(note) };
  try { await saveHistory(env, { title: job.title, company: job.company, url: job.url, fit: sc.fit, verdict, resume: draft.resume, note: draft.note }); } catch (e) { logErr("history", e); }
  return {
    title: job.title, company: job.company, location: job.location || "(not found; judged on the text)", url: job.url, cv_gaps: cvGaps,
    verdict, fit_score: sc.fit, score_after_preferences: sc.score,
    would_appear_in_your_search: sc.drops.length ? false : sc.tier !== "C" || sc.score >= 25,
    why_not_in_search: sc.drops.length ? sc.drops : sc.tier === "C" ? ["score below the cut after location and level adjustments"] : [],
    why: sc.why, flags: sc.flags, strengths, gaps: gapsFor(job.desc),
    draft,
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
    await ensureResearchPubs(env).catch((e) => logErr("research-pubs", e));   // before loadCtx so the context sees the merged bank
    const ctx = await loadCtx(env);
    const prefsHash = await sha256hex(JSON.stringify([ctx.a, [...ctx.learned.boost].sort(), [...ctx.learned.block].sort(), [...OWNED].sort(), [...ctx.learned.coPen].sort(), [...ctx.learned.coDrop].sort()]));
    const prefsChanged = (await getMeta(env, "prefs_hash")) !== prefsHash;
    let { kept, errors, excl, fetched, feeds, feedResults } = await collectAndRank(ctx);
    // what the owner already decided (rejected, applied, approved, got a reply) never comes back, under any id, board or location; and a role already pending under another id is not listed twice
    const decided = await decidedKeys(env);
    const pendingRows = (await env.JOBS_DB.prepare("SELECT id, company, title FROM jobsearch_matches WHERE status='pending_owner_approval' AND last_seen >= ?").bind(iso(t0 - 72 * 3600 * 1000)).all()).results;
    const pendingByKey = new Map(pendingRows.map((r) => [normKey(r), r.id]));
    let suppressed = 0;
    kept = kept.filter((j) => {
      const nk = normKey(j);
      if (decided.has(nk)) { suppressed++; return false; }
      const other = pendingByKey.get(nk);
      if (other && other !== j.id) { suppressed++; return false; }
      return true;
    });
    if (suppressed) excl["already decided or already listed"] = suppressed;
    kept = await llmRerank(env, kept);   // reorder-only AI pass over the top 25, before the per-company cap
    const per = {}, seen = new Set(), picked = [], pickedStretch = [];
    for (const j of kept) {
      const dk = dedupeKey(j);
      if (seen.has(dk)) continue;               // the same posting listed on two boards
      seen.add(dk);
      const stretch = j.match.tier === "C", cap = stretch ? 2 : 3, key = (stretch ? "~" : "") + j.company;
      if ((per[key] || 0) < cap) { per[key] = (per[key] || 0) + 1; (stretch ? pickedStretch : picked).push(j); }
    }
    const toStore = picked.slice(0, 80).concat(pickedStretch.slice(0, 40));
    let blocked = 0;
    const now = new Date().toISOString();
    const stmts = [];
    for (const j of toStore) {
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
      if (["remotive", "muse", "jobicy", "himalayas"].includes(kind0) && !BOARDS[kind0].every((c) => okFeeds.has(kind0 + ":" + c))) continue;   // a grouped source expires nothing unless every part answered
      prefixes.add(feedPrefix(f.feed));
    }
    for (const pre of prefixes) stmts.push(env.JOBS_DB.prepare("UPDATE jobsearch_matches SET status='expired', decided_at=?3 WHERE status='pending_owner_approval' AND id LIKE ?1 AND last_seen < ?2").bind(pre + "%", cutoff, now));
    // retention
    stmts.push(env.JOBS_DB.prepare("DELETE FROM jobsearch_matches WHERE status='expired' AND last_seen < ?").bind(iso(t0 - 90 * 86400000)));
    // decided rows are kept for good (their key is what stops a role coming back); only the bulky drafts are dropped
    stmts.push(env.JOBS_DB.prepare("UPDATE jobsearch_matches SET resume_md=NULL, note_md=NULL WHERE status IN ('rejected','no_reply') AND last_seen < ? AND (resume_md IS NOT NULL OR note_md IS NOT NULL)").bind(iso(t0 - 90 * 86400000)));
    stmts.push(env.JOBS_DB.prepare("DELETE FROM jobsearch_codes WHERE created_ms < ?").bind(t0 - 86400000));
    stmts.push(env.JOBS_DB.prepare("DELETE FROM jobsearch_sessions WHERE expires_ms < ?").bind(t0 - 86400000));
    for (let i = 0; i < stmts.length; i += 50) await env.JOBS_DB.batch(stmts.slice(i, i + 50));
    await env.JOBS_DB.prepare("UPDATE jobsearch_runs SET finished_at=?, feeds=?, fetched=?, passed=?, stored=?, blocked=?, excluded_json=?, errors_json=? WHERE id=?")
      .bind(new Date().toISOString(), feeds, fetched, kept.length, toStore.length, blocked, JSON.stringify(excl), JSON.stringify(errors), rid).run();
    const nrCut = iso(t0 - NO_REPLY_DAYS * 86400000), nrWhere = "status='applied' AND id IN (SELECT match_id FROM jobsearch_events GROUP BY match_id HAVING MIN(CASE WHEN event='applied' THEN ts END) < ?1) AND id NOT IN (SELECT match_id FROM jobsearch_events WHERE event IN ('replied','interview','offer'))";
    await env.JOBS_DB.batch([
      env.JOBS_DB.prepare("INSERT INTO jobsearch_events (match_id, event, ts, note) SELECT id, 'no_reply', ?2, 'auto: no reply in 21 days' FROM jobsearch_matches WHERE " + nrWhere).bind(nrCut, new Date().toISOString()),
      env.JOBS_DB.prepare("UPDATE jobsearch_matches SET status='no_reply', decided_at=?2 WHERE " + nrWhere).bind(nrCut, new Date().toISOString()),
    ]);
    try { await writeOutcomeMetrics(env, await outcomes(env)); } catch (e) { logErr("outcome-metrics", e); }
    await setMeta(env, "prefs_hash", prefsHash);
    await setMeta(env, "ledger_verified_on", LEDGER_VERIFIED_ON);
    await setMeta(env, "bank_rev", BANK_REV);
    await setMeta(env, "ledger_open_questions", (LEDGER.unverified_needs_owner || []).length);
    await setMeta(env, "worker_version", VERSION);
    await setMeta(env, "email_binding", env.EMAIL ? "1" : "0");
    log("run-ok", { run_id: rid, fetched, passed: kept.length, blocked, feed_errors: errors.length, ms: Date.now() - t0 });
    return { run_id: rid, feeds, fetched, passed: kept.length, stored: toStore.length, blocked, errors };
  } catch (e) {
    logErr("run-failed", e);
    await env.JOBS_DB.prepare("UPDATE jobsearch_runs SET finished_at=?, errors_json=? WHERE id=?").bind(new Date().toISOString(), JSON.stringify(["run failed: " + String((e && e.message) || e).slice(0, 300)]), rid).run().catch((e2) => logErr("run-failed-record", e2));
    throw e;
  }
}

// ------------------------------------------------------------------ CV storage and API (JOBSEARCH-CV-1)
const bad400 = (msg) => Object.assign(new Error(msg), { status: 400 });
const clean = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
// One key per role at one employer, whatever the board, id, location or tag in brackets: what the owner decided about it stays decided.
const normKey = (j) => {
  const co = String(j.company || "").toLowerCase().replace(COMPANY_SUFFIX, " ").replace(/[^a-z0-9]+/g, "");
  const ti = String(j.title || "").toLowerCase().replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  return co + "|" + ti;
};
const DECIDED = ["rejected", "applied", "approved", "replied", "interview", "offer", "no_reply"];
async function decidedKeys(env) {
  const keys = new Set();
  const rows = (await env.JOBS_DB.prepare(`SELECT company, title FROM jobsearch_matches WHERE status IN (${DECIDED.map((s) => "'" + s + "'").join(",")})`).all()).results;
  for (const r of rows) keys.add(normKey(r));
  const fb = (await env.JOBS_DB.prepare("SELECT company, title FROM jobsearch_feedback WHERE source='status' OR (source='check' AND verdict='dislike')").all()).results;
  for (const r of fb) keys.add(normKey(r));
  return keys;
}
let bankAt = 0;
async function loadBank(env) {
  if (Date.now() - bankAt < 15000) return BANK;
  await ensure(env);
  const row = await env.JOBS_DB.prepare("SELECT v, rev FROM jobsearch_bank WHERE k='bank'").first();
  if (row) { try { applyBank(JSON.parse(row.v), row.rev); } catch (e) { logErr("bank-parse", e); applyBank(BANK_SEED, 0); } }
  else if (BANK_REV !== 0) applyBank(BANK_SEED, 0);
  bankAt = Date.now();
  return BANK;
}
// JOBSEARCH-RESEARCH-PORTFOLIO-1 (issue 1000707): the owner's QNFO papers that public search surfaces first and the bank lacked. Read from living-paper on 2026-11-05 (status published,
// release gate passed, the pages answer 200 on papers.qnfo.org). None has a DOI (0 of 723 published papers has one), so each carries its papers.qnfo.org address, which pubLine prints.
// They are added once to the owner's bank, additive and tagged so a resume lists them when the posting is in their field; after that the bank is the owner's: a deleted entry stays deleted.
// The fleet's edit does not count as a re-verification (verified_on is kept). The stronger claims in the issue (co-directing a travel survey, predictive analytics at Epsilon) stay out until the owner states them.
const RESEARCH_PUBS = [
  { id: "P09", title: "Quantum Laws of Form", year: 2026, doi: "", url: "https://papers.qnfo.org/papers/quantum-laws-of-form", tags: ["quantum", "physics_theory", "research_integrity"] },
  { id: "P10", title: "Dimensionless Physics", year: 2025, doi: "", url: "https://papers.qnfo.org/papers/dimensionless-physics", tags: ["physics_theory", "numerics"] },
  { id: "P11", title: "Proof-of-Concept for Auditable Attention using Ultrametric Tree Distances", year: 2026, doi: "", url: "https://papers.qnfo.org/papers/proof-of-concept-for-auditable-attention-using-ultrametric-tree-distances", tags: ["llm", "research_integrity", "physics_theory"] },
];
async function ensureResearchPubs(env) {
  if ((await getMeta(env, "research_pubs_v1")) === "done") return false;
  await mutateBank(env, (b) => {
    b.publications = b.publications || [];
    for (const p of RESEARCH_PUBS) if (!b.publications.some((x) => x.id === p.id || String(x.title).toLowerCase() === p.title.toLowerCase())) b.publications.push({ ...p, tags: [...p.tags] });
    return b;
  }, { keepVerified: true });
  await setMeta(env, "research_pubs_v1", "done");
  return true;
}
// Optimistic lock: the write only lands if the revision it read is still current, otherwise it re-reads and re-applies (two tabs cannot overwrite each other).
async function mutateBank(env, fn, opts = {}) {
  await ensure(env);
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await env.JOBS_DB.prepare("SELECT v, rev FROM jobsearch_bank WHERE k='bank'").first();
    const cur = row ? JSON.parse(row.v) : JSON.parse(JSON.stringify(BANK_SEED)), rev = row ? row.rev : 0;
    const next = fn(cur) || cur;
    if (!opts.keepVerified) next.verified_on = new Date().toISOString().slice(0, 10);   // a change the fleet makes is not a re-verification by the owner
    const v = JSON.stringify(next), now = iso(Date.now());
    const res = row
      ? await env.JOBS_DB.prepare("UPDATE jobsearch_bank SET v=?1, rev=rev+1, updated_at=?2 WHERE k='bank' AND rev=?3").bind(v, now, rev).run()
      : await env.JOBS_DB.prepare("INSERT OR IGNORE INTO jobsearch_bank (k, v, rev, updated_at) VALUES ('bank', ?1, 1, ?2)").bind(v, now).run();
    if (res.meta.changes) {
      if (row) await env.JOBS_DB.batch([
        env.JOBS_DB.prepare("INSERT INTO jobsearch_bank_history (ts, rev, v) VALUES (?1,?2,?3)").bind(now, rev, row.v),
        env.JOBS_DB.prepare("DELETE FROM jobsearch_bank_history WHERE id NOT IN (SELECT id FROM jobsearch_bank_history ORDER BY id DESC LIMIT 40)"),
      ]);
      applyBank(next, rev + 1); bankAt = Date.now();
      return next;
    }
  }
  throw Object.assign(new Error("the CV changed in another tab; reload and try again"), { status: 409 });
}
const nextFactId = (b) => "Q" + String(Math.max(0, ...b.facts.map((f) => parseInt(String(f.id).replace(/\D/g, ""), 10) || 0)) + 1).padStart(3, "0");
const roleOk = (b, id) => ((b.roles || []).some((r) => r.id === id) ? id : "");
const tagsOk = (tags) => (Array.isArray(tags) ? tags.filter((t) => TAG_TO_CLUSTERS[t]) : []);
function cvAnswer(b, d) {
  const q = QUESTIONS.find((x) => x.id === d.qid);
  if (!q) throw bad400("unknown question");
  if (d.answer !== "y" && d.answer !== "n") throw bad400("answer is y or n");
  b.answers = b.answers || {};
  const old = (b.answers[q.id] || {}).facts || [];
  b.facts = b.facts.filter((f) => !old.includes(f.id));
  const ids = [];
  if (d.answer === "y") for (const f of (d.facts || []).slice(0, 10)) {
    const text = clean(f.text, 600);
    if (!text) continue;
    const id = nextFactId(b);
    b.facts.push({ id, role: roleOk(b, f.role), text, tags: q.tags, source: "interview:" + q.id, status: "verified" });
    ids.push(id);
  }
  b.answers[q.id] = { answer: d.answer, facts: ids };
}
function cvFact(b, d) {
  const f = b.facts.find((x) => x.id === d.id);
  if (d.delete) { b.facts = b.facts.filter((x) => x.id !== d.id); for (const a of Object.values(b.answers || {})) a.facts = (a.facts || []).filter((i) => i !== d.id); return; }
  const text = clean(d.text, 600);
  if (!text) throw bad400("write what you did");
  if (f) { f.text = text; if ("role" in d) f.role = roleOk(b, d.role); if ("tags" in d) f.tags = tagsOk(d.tags); delete f.pitch; f.status = "verified"; }
  else b.facts.push({ id: nextFactId(b), role: roleOk(b, d.role), text, tags: tagsOk(d.tags), source: "manual", status: "verified" });
}
function cvReview(b, d) {
  const it = (b.review || []).find((x) => x.id === d.id);
  if (!it) throw bad400("unknown review item");
  if (d.action === "confirm") {
    const text = clean(d.text || it.text, 600);
    if (/\[[^\]]*\]/.test(text)) throw bad400("fill in the bracketed part first");
    b.facts.push({ id: nextFactId(b), role: roleOk(b, d.role || it.role), text, tags: tagsOk(it.tags), source: "review:" + it.id, status: "verified" });
  } else if (d.action !== "reject") throw bad400("action is confirm or reject");
  b.review = b.review.filter((x) => x.id !== d.id);
}
const strList = (a, n, len) => (Array.isArray(a) ? a.map((x) => clean(x, len)).filter(Boolean).slice(0, n) : null);
function cvSet(b, d) {
  if (typeof d.summary === "string") { const s = (b.summaries || [])[0]; if (s) s.text = clean(d.summary, 1200); else b.summaries = [{ id: "S1", tags: [], text: clean(d.summary, 1200) }]; }
  if (d.education) b.education = strList(d.education, 12, 300);
  if (d.certifications) b.certifications = strList(d.certifications, 20, 300);
  if (Array.isArray(d.skills)) b.skills = d.skills.slice(0, 60).map((s) => ({ name: clean(s.name, 80), tags: tagsOk(s.tags) })).filter((s) => s.name);
  if (Array.isArray(d.roles)) {
    const roles = d.roles.slice(0, 40).map((r, i) => ({ id: /^R\d+$/.test(r.id || "") ? r.id : "R" + String(100 + i), title: clean(r.title, 120), org: clean(r.org, 160), location: clean(r.location, 80), start: clean(r.start, 4), end: clean(r.end, 8), tags: tagsOk(r.tags) }));
    if (roles.some((r) => !r.title || !r.org || !/^\d{4}$/.test(r.start) || !/^(\d{4}|present)$/i.test(r.end))) throw bad400("every role needs a title, an employer, a start year (YYYY) and an end year or 'present'");
    if (new Set(roles.map((r) => r.id)).size !== roles.length) throw bad400("duplicate role ids");
    b.roles = roles;
    for (const f of b.facts) f.role = roleOk(b, f.role);
  }
  if (Array.isArray(d.publications)) b.publications = d.publications.slice(0, 80).map((p, i) => ({ id: /^P\d+$/.test(p.id || "") ? p.id : "P" + String(100 + i), title: clean(p.title, 300), year: parseInt(p.year, 10) || 0, doi: clean(p.doi, 80), tags: tagsOk(p.tags) })).filter((p) => p.title && p.year);
  if (d.person && typeof d.person === "object") {
    for (const k of ["location", "also_published_as"]) if (typeof d.person[k] === "string") b.person[k] = clean(d.person[k], 120);
    if (typeof d.person.email === "string" && /^[^\s@]+@[^\s@]+$/.test(d.person.email)) b.person.email = d.person.email.trim();
    for (const k of ["site", "linkedin", "orcid", "papers"]) if (d.person.links && typeof d.person.links[k] === "string" && /^https:\/\/\S+$/.test(d.person.links[k])) b.person.links[k] = d.person.links[k];
  }
}
function cvImport(b, d) {
  if (!d || d.version !== 2 || !Array.isArray(d.facts) || !Array.isArray(d.roles) || !d.person || !d.person.name) throw bad400("not a CV export (version 2 expected)");
  const keep = b.answers;
  for (const k of Object.keys(b)) delete b[k];
  Object.assign(b, d); b.answers = d.answers || keep || {}; b.review = d.review || [];
}
async function cvState(env) {
  await loadBank(env);
  const b = BANK, byId = Object.fromEntries(b.facts.map((f) => [f.id, f]));
  return {
    rev: BANK_REV, verified_on: b.verified_on || null, person: b.person, summary: ((b.summaries || [])[0] || {}).text || "", roles: b.roles, facts: b.facts, publications: b.publications,
    education: b.education, certifications: b.certifications, skills: b.skills, review: b.review || [], tags: Object.keys(TAG_TO_CLUSTERS),
    questions: QUESTIONS.map((q) => { const a = (b.answers || {})[q.id]; return { ...q, answer: a ? a.answer : null, facts: a ? a.facts.map((i) => byId[i]).filter(Boolean) : [] }; }),
  };
}
async function saveHistory(env, d) {
  await env.JOBS_DB.batch([
    env.JOBS_DB.prepare("INSERT INTO jobsearch_history (ts, title, company, url, fit, verdict, resume_md, note_md) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)").bind(iso(Date.now()), d.title, d.company, d.url || "", d.fit, d.verdict, d.resume || null, d.note || null),
    env.JOBS_DB.prepare("DELETE FROM jobsearch_history WHERE id NOT IN (SELECT id FROM jobsearch_history ORDER BY id DESC LIMIT 200)"),
  ]);
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
  await loadBank(env);
  const db = env.JOBS_DB, now = Date.now();
  const last = await db.prepare("SELECT * FROM jobsearch_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1").first();
  const recent = (await db.prepare("SELECT passed, fetched FROM jobsearch_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 3").all()).results;
  const unfinished = (await db.prepare("SELECT COUNT(*) AS n FROM jobsearch_runs WHERE finished_at IS NULL AND started_at < ?").bind(iso(now - 15 * 60000)).first()).n;
  const feeds = (await db.prepare("SELECT feed, last_ok_at, last_count, last_error, consecutive_fail FROM jobsearch_feeds ORDER BY feed").all()).results
    .map((feed) => ({ ...feed, active: ACTIVE_FEEDS.has(feed.feed) }));
  const counts = (await db.prepare("SELECT status, COUNT(*) AS n FROM jobsearch_matches GROUP BY status").all()).results;
  const blockedN = (await db.prepare("SELECT COUNT(*) AS n FROM jobsearch_matches WHERE verified=0 AND status='pending_owner_approval'").first()).n;
  const stalePending = (await db.prepare("SELECT COUNT(*) AS n FROM jobsearch_matches WHERE status='pending_owner_approval' AND last_seen < ?").bind(iso(now - 72 * 3600000)).first()).n;
  const rerank = Object.fromEntries(((await db.prepare("SELECT k, v FROM jobsearch_meta WHERE k IN ('rerank_status','rerank_at')").all()).results || []).map((r) => [r.k, r.v]));   // JOBSEARCH-LLM-RERANK-1: what the last run's AI re-rank did
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
  return { worker: WORKER, version: VERSION, status: checks.every((c) => c.ok) ? "ok" : "degraded", checked_at: iso(now), last_run: last ? { id: last.id, finished_at: last.finished_at, fetched: last.fetched, passed: last.passed, stored: last.stored, blocked: last.blocked } : null, rerank: { status: rerank.rerank_status || "never", at: rerank.rerank_at || null, binding: !!env.QNFO_AI }, feeds, matches_by_status: Object.fromEntries(counts.map((c) => [c.status, c.n])), checks };
}
const INDEX = {
  worker: WORKER, version: VERSION,
  routes: {
    "GET /": "web UI", "GET /api/matches?tier=A|B&status=&q=&limit=": "ranked matches without artifacts", "GET /api/matches/:id": "one match with resume_md and note_md",
    "GET /api/runs": "recent pipeline runs", "GET /api/ledger": "the claim ledger every output sentence must come from", "GET /api/ops": "operational self-report: the fm-jobsearch-* checks, feed health, counts", "GET /api/prefs": "the yes/no search survey with your answers; POST {answers:{id:true|false|null}} saves and re-runs the search", "POST /api/analyze": "{input: link or pasted posting text, title?, company?} -> fit, strengths, gaps, whether it would appear in your search, verified draft", "POST /api/feedback": "{title, company, verdict: like|dislike} teaches the search", "GET /api/outcomes": "funnel (matches, approved, applied, replies, interviews, offers), reply rate of applications older than 21 days, by tier", "POST /api/auth/request": "e-mail a 6-digit sign-in code to the owner", "POST /api/auth/verify": "{code} -> owner session (cookie jobs_session, 12 h)", "GET /api/auth/me": "signed-in state", "POST /api/auth/logout": "revoke the session", "POST /api/run": "trigger a run (10-minute cooldown)",
    "POST /api/matches/:id/status": "owner decision or outcome {status: approved|rejected|applied|replied|interview|offer|no_reply|pending_owner_approval}, logged as an event; needs an owner session or x-loop-token", "GET /health": "version", "GET /cv": "the CV page: interview, review, edit, resume per job, history", "GET /api/cv": "the CV bank, questions with answers, review queue (owner session)", "POST /api/cv/answer|fact|review|set|import": "edit the CV bank (owner session); GET /api/cv/export is the backup", "GET /api/cv/history": "resumes built for jobs",
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
    if (p === "/api/ledger" && m === "GET") { await loadBank(env); return J({ person: { ...LEDGER.person, sign_in_email: undefined }, owner_stated: LEDGER.owner_stated, unverified_needs_owner: LEDGER.unverified_needs_owner, facts: LEDGER.facts.filter((f) => ((BANK.facts.find((x) => x.id === f.id) || {}).source === "verified_cv")).map((f) => ({ id: f.id, text: f.text, employer: f.employer, period: f.period })), headlines: LEDGER.headlines }); }   // public: only the verified CV record; what the owner adds in the interview stays private
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
    if (p === "/cv" && m === "GET") return new Response(CV_UI, { headers: { "content-type": "text/html; charset=utf-8" } });
    if (p === "/api/cv" || p.startsWith("/api/cv/")) {
      if (!(await ownerSession(request, env))) return J({ error: "sign in first: POST /api/auth/request, then POST /api/auth/verify" }, 401);
      try {
        if (p === "/api/cv" && m === "GET") return J(await cvState(env));
        if (p === "/api/cv/export" && m === "GET") { await loadBank(env); return new Response(JSON.stringify(BANK, null, 1), { headers: { "content-type": "application/json", "content-disposition": "attachment; filename=cv-backup.json", "cache-control": "no-store" } }); }
        if (p === "/api/cv/history" && m === "GET") return J({ items: (await env.JOBS_DB.prepare("SELECT id, ts, title, company, fit, verdict FROM jobsearch_history ORDER BY id DESC LIMIT 200").all()).results });
        const hm = p.match(/^\/api\/cv\/history\/(\d+)$/);
        if (hm && m === "GET") { const row = await env.JOBS_DB.prepare("SELECT * FROM jobsearch_history WHERE id=?").bind(+hm[1]).first(); return row ? J(row) : J({ error: "not found" }, 404); }
        const ops = { "/api/cv/answer": cvAnswer, "/api/cv/fact": cvFact, "/api/cv/review": cvReview, "/api/cv/set": cvSet, "/api/cv/import": cvImport };
        if (m === "POST" && ops[p]) {
          let b; try { b = await request.json(); } catch (e) { return J({ error: "send a JSON body" }, 400); }
          await mutateBank(env, (bank) => ops[p](bank, b));
          const last = await env.JOBS_DB.prepare("SELECT started_at FROM jobsearch_runs ORDER BY id DESC LIMIT 1").first();
          if (!last || Date.now() - Date.parse(last.started_at) > 10 * 60 * 1000) ctx.waitUntil(run(env).catch((e) => logErr("rerun-after-cv", e)));   // the search follows the CV; at most one run in 10 minutes
          return J({ ok: true, rev: BANK_REV });
        }
      } catch (e) { return J({ error: e.message }, e.status || 500); }
      return J({ error: "not found", see: "/api" }, 404);
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
      // filter in SQL before the window: rejected and expired rows used to fill the 500-row window and push live matches out of it
      const where = [], args = [];
      if (status && status !== "all") { where.push("status = ?"); args.push(status); } else if (!status) where.push("status NOT IN (" + HIDDEN.map((x) => "'" + x + "'").join(",") + ")");
      if (tier) { where.push("tier = ?"); args.push(tier); }
      const r = await env.JOBS_DB.prepare("SELECT id, first_seen, last_seen, company, title, location, url, tier, score, why_json, flags_json, verified, blocked_reason, status, decided_at FROM jobsearch_matches" + (where.length ? " WHERE " + where.join(" AND ") : "") + " ORDER BY tier ASC, score DESC, last_seen DESC LIMIT 500").bind(...args).all();   // A, then B, then the stretch matches, each by score
      let rows = r.results.map(parseRow);
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
      if (body.reason !== undefined && !REASONS.includes(body.reason)) return J({ error: "reason must be one of " + REASONS.join("|") }, 400);
      const id = decodeURIComponent(mm[1]);
      const cur = await env.JOBS_DB.prepare("SELECT verified FROM jobsearch_matches WHERE id=?").bind(id).first();
      if (!cur) return J({ error: "not found" }, 404);
      if (!cur.verified && body.status !== "rejected" && body.status !== "pending_owner_approval") return J({ error: "artifacts failed verification; only rejected is allowed" }, 409);
      const tsNow = new Date().toISOString();
      let applicationNote = "owner";
      if (body.status === "rejected" || body.status === "applied" || body.status === "approved") {
        const mt = await env.JOBS_DB.prepare("SELECT title, company, tier, score, why_json FROM jobsearch_matches WHERE id=?").bind(id).first();
        if (mt) await addFeedback(env, mt.title, mt.company, body.status === "rejected" ? "dislike" : "like", "status", body.status === "rejected" ? body.reason || null : null);
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
handler.__test = { evaluate, rank, buildResume, buildNote, verify, stripHtml, locationGate, has, LEDGER, dedupeKey, feedPrefix, makeCtx, scoreJob, scoreFeatures, featuresFromWhy, applicationSnapshot, parseApplicationSnapshot, outcomeScoreWeights, loadCtx, SURVEY, BOARDS, normKey, applyBank, BANK_SEED, QUESTIONS, TAG_TO_CLUSTERS, clustersOf, cvAnswer, cvFact, cvReview, cvSet, cvImport, mutateBank, loadBank, decidedKeys, FETCHERS, getBank: () => BANK, llmRerank, llmRerankRun, ensureResearchPubs, RESEARCH_PUBS, pubLine, parseRerank, reasonOk, rerankMessages, artifactsFor, titleCandidate, sitemapUrls, slugTitle, PUBLIC_SECTOR, opsReport };
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
.badge{font-size:12px;font-weight:700;padding:2px 8px;border-radius:99px;color:#fff}.A{background:var(--a)}.B{background:var(--b)}.C{background:#6b6b66}
.mute{color:var(--mute);font-size:13px}.flag{color:var(--bad);font-size:13px;margin-top:4px}
.st{font-size:12px;border:1px solid var(--line);border-radius:99px;padding:1px 8px}.st.approved{border-color:var(--a);color:var(--a)}.st.rejected{border-color:var(--bad);color:var(--bad)}
pre{white-space:pre-wrap;background:#fbfbf8;border:1px solid var(--line);border-radius:8px;padding:10px;font:13px/1.45 ui-monospace,Menlo,Consolas,monospace}
.acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}a{color:var(--acc)}
details{background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin:0 0 12px}summary{cursor:pointer;font-weight:600}.q{padding:4px 0;border-top:1px solid var(--line)}.q label{margin-left:10px;white-space:nowrap}h4{margin:10px 0 4px}textarea{font:inherit;border:1px solid var(--line);border-radius:6px;padding:8px;margin-top:8px}.note{background:#fff8e1;border:1px solid #f0d98a;border-radius:8px;padding:8px 12px;font-size:13px;margin-bottom:12px}
</style></head><body>
<header><h1>Job matches: verified claims only</h1><div class="sub" id="meta">loading…</div>
<div class="bar"><select id="tier"><option value="">All tiers</option><option value="A">A</option><option value="B">B</option><option value="C">C: stretch</option></select>
<select id="status"><option value="">Active (hides rejected)</option><option value="all">All, including rejected</option><option value="pending_owner_approval">Pending</option><option>approved</option><option>rejected</option><option>applied</option><option>replied</option><option>interview</option><option>offer</option><option>no_reply</option><option>expired</option></select>
<input id="q" placeholder="Search title, company, place" size="26"><button id="run" class="p">Run now</button><a href="/cv"><b>My CV</b></a> <a href="/api" class="mute">API</a> <a href="/api/ledger" class="mute">Claim ledger</a> <a href="/api/ops" class="mute">Operations</a> <span id="who" class="mute"></span><button id="signin" onclick="signIn()">Sign in</button><button id="signout" style="display:none" onclick="api(\'/api/auth/logout\',{method:\'POST\'}).then(who)">Sign out</button></div></header>
<main><div class="note">Every sentence in a resume or note is copied from the claim ledger and re-checked line by line; a failed check blocks the draft. Nothing is sent: approve only marks your decision, then you apply from the posting link.</div><details id="check" open><summary>Check a job I found</summary><textarea id="jin" rows="4" placeholder="Paste a job link, or paste the whole posting text" style="width:100%"></textarea><div class="bar"><input id="jtitle" placeholder="Title (optional)"><input id="jco" placeholder="Employer (optional)"><button class="p" id="jgo">How good a match am I?</button></div><div id="jres"></div></details>
<details id="prefs"><summary>Search preferences: yes or no questions</summary><div id="survey" class="mute">loading</div><div class="bar"><button class="p" id="psave">Save and re-run the search</button><span id="prefmsg" class="mute"></span></div></details><div id="list"></div></main>
<script>
const $=s=>document.querySelector(s);const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function api(path,opt){const r=await fetch(path,opt);const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||r.status);return j}
async function load(){
  const q=new URLSearchParams();for(const k of['tier','status','q']){const v=$('#'+k).value;if(v)q.set(k,v)}
  const [m,r,oc]=await Promise.all([api('/api/matches?'+q),api('/api/runs'),api('/api/outcomes')]);
  const last=r.runs[0];$('#meta').textContent=last?('Last run '+last.started_at+' | '+last.fetched+' postings from '+last.feeds+' feeds | '+last.passed+' passed gates | '+last.blocked+' blocked by verifier'+(last.errors.length?' | feed errors: '+last.errors.length:'')):'No run yet. Press Run now.';$('#meta').textContent+=' | Applied '+oc.funnel.applied+', replies '+oc.funnel.replied+', interviews '+oc.funnel.interview+' | reply rate '+(oc.reply_rate_90d===null?'unknown ('+oc.reading+')':Math.round(oc.reply_rate_90d*100)+'%');
  $('#list').innerHTML=m.matches.map(x=>'<div class="card" id="c-'+esc(x.id)+'"><div class="row"><span class="badge '+x.tier+'">'+x.tier+' '+x.score+'</span><span class="t">'+esc(x.title)+'</span><span class="mute">'+esc(x.company)+' | '+esc(x.location||'n/a')+(via(x.id)?' | via '+esc(via(x.id)):'')+'</span><span class="st '+esc(x.status)+'">'+esc(x.status.replace(/_/g,' '))+'</span></div>'
   +'<div class="mute">'+esc(x.why.join(' | '))+'</div>'+x.flags.map(f=>'<div class="flag">Check: '+esc(f)+'</div>').join('')
   +(x.verified?'':'<div class="flag">Blocked by verifier: '+esc(x.blocked_reason)+'</div>')
   +'<div class="acts"><a href="'+esc(x.url)+'" target="_blank" rel="noopener"><button>Open posting</button></a><button onclick="show(\\''+esc(x.id)+'\\')">Resume and note</button>'
   +'<button onclick="decide(\\''+esc(x.id)+'\\',\\'approved\\')">Approve</button><button onclick="reject(\\''+esc(x.id)+'\\')">Reject</button><button onclick="decide(\\''+esc(x.id)+'\\',\\'applied\\')">Mark applied</button>'+[['replied','Got a reply'],['interview','Interview'],['offer','Offer']].map(o=>'<button onclick="decide(\\''+esc(x.id)+'\\',\\''+o[0]+'\\')">'+o[1]+'</button>').join('')+'</div><div class="art"></div></div>').join('')||'<p class="mute">No matches yet.</p>';
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
function reject(id){var el=document.getElementById('c-'+id).querySelector('.art');var R=[['field','Wrong field'],['level','Wrong level'],['location','Wrong place'],['company','Not this employer'],['applied','Already handled it'],['other','Other']];el.innerHTML='<div class="note">Why? The search learns from it. '+R.map(function(r){return '<button onclick="rejectWhy(\\''+esc(id)+'\\',\\''+r[0]+'\\')">'+r[1]+'</button>'}).join(' ')+'</div>'}
async function rejectWhy(id,reason){const call=()=>api('/api/matches/'+encodeURIComponent(id)+'/status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({status:'rejected',reason})});try{await authed(call)}catch(e){alert(e.message);return}load()}
const VIA={rok:'RemoteOK',him:'Himalayas',hn:'Hacker News: Who is hiring',rm:'Remotive',jb:'Jobicy',mu:'The Muse',an:'Arbeitnow',gh:'company board',lv:'company board',ab:'company board',rc:'company board',ps:'public-sector board'};
function via(id){return VIA[String(id).split(':')[0]]||''}
function li(a){return a&&a.length?'<ul>'+a.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'<p class="mute">none</p>'}
$('#jgo').onclick=async()=>{const r=$('#jres');r.textContent='Reading the posting...';try{const d=await authed(()=>api('/api/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({input:$('#jin').value,title:$('#jtitle').value,company:$('#jco').value})}));window._last=d;
 r.innerHTML='<div class="card"><div class="t">'+esc(d.verdict)+' ('+d.fit_score+')  '+esc(d.title)+'</div><div class="mute">'+esc(d.company)+' | '+esc(d.location)+'</div><div>'+(d.would_appear_in_your_search?'Would appear in your search.':'Would NOT appear in your search: '+esc(d.why_not_in_search.join('; ')))+'</div><h4>Why</h4>'+li(d.why)+'<h4>Your record that fits</h4>'+li(d.strengths.map(x=>x.text))+'<h4>Gaps and checks</h4>'+li(d.gaps.concat(d.flags))+'<div class="acts"><button class="fb" data-v="like">More like this</button><button class="fb" data-v="dislike">Not for me</button></div><span id="fbmsg" class="mute"></span>'+(d.draft.resume?'<details><summary>Verified resume and note for this job</summary><pre>'+esc(d.draft.resume)+'</pre><pre>'+esc(d.draft.note)+'</pre></details>':'<p class="flag">Draft blocked: '+esc(d.draft.blocked)+'</p>')+'</div>';
 r.querySelectorAll('.fb').forEach(b=>b.onclick=async()=>{try{await authed(()=>api('/api/feedback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:d.title,company:d.company,verdict:b.dataset.v})}));$('#fbmsg').textContent='Noted. The next search run uses it.'}catch(e){$('#fbmsg').textContent=e.message}})}catch(e){r.textContent=e.message}};
load();who();loadPrefs();
</script></body></html>`;

// ------------------------------------------------------------------ CV page (JOBSEARCH-CV-1): interview, review, edit, resume per job, history. Plain JS, talks only to /api/cv* and /api/analyze.
const CV_UI = String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your CV</title>
<style>
:root{--bg:#f6f8fb;--ink:#16202e;--mut:#5b6778;--line:#e3e8ef;--brand:#2457d6;--ok:#16794c;--warn:#a65b00;--bad:#b3261e}
*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,Segoe UI,sans-serif;color:var(--ink);background:var(--bg)}
header{background:#fff;border-bottom:1px solid var(--line);padding:0 20px;display:flex;align-items:center;gap:24px;position:sticky;top:0;z-index:5;flex-wrap:wrap}
header h1{font-size:18px;margin:0;padding:14px 0}nav button{background:none;border:0;border-bottom:3px solid transparent;padding:18px 12px 15px;font:inherit;font-weight:600;color:var(--mut);cursor:pointer}
nav button.on{color:var(--brand);border-color:var(--brand)}header a{color:var(--brand);margin-left:auto}
main{max-width:880px;margin:24px auto;padding:0 16px}.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:24px;margin-bottom:16px}
h2{margin:0 0 6px;font-size:21px}h3{margin:18px 0 6px;font-size:16px}.mut{color:var(--mut)}.sec{color:var(--brand);font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.06em}
.q{font-size:21px;font-weight:600;margin:10px 0 20px;line-height:1.35}.row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}.row>div{flex:1;min-width:140px}
button.b{font:inherit;font-weight:700;border-radius:10px;border:1px solid var(--line);background:#fff;padding:11px 22px;cursor:pointer;color:var(--ink)}button.b:hover{border-color:var(--brand)}
button.yes{background:var(--ok);color:#fff;border-color:var(--ok)}button.pri{background:var(--brand);color:#fff;border-color:var(--brand)}button.bad{color:var(--bad)}
button.link{background:none;border:0;color:var(--brand);cursor:pointer;font:inherit;padding:4px 8px 4px 0}
textarea,input,select{width:100%;font:inherit;padding:10px;border:1px solid #c9d2df;border-radius:10px;background:#fff}textarea{min-height:84px;resize:vertical}
label{display:block;font-weight:600;margin:12px 0 4px;font-size:14px}.bar{height:8px;background:var(--line);border-radius:8px;overflow:hidden;margin-bottom:18px}.bar i{display:block;height:100%;background:var(--brand)}
.hint{background:#eef3ff;border-radius:10px;padding:12px 14px;font-size:14px;color:#2b3f6b;margin:10px 0}.fact{border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:10px 0}
.tag{display:inline-block;background:#eef1f6;border-radius:99px;padding:1px 9px;font-size:12px;margin:2px 3px 0 0;color:var(--mut)}
.resume{background:#fff;border:1px solid var(--line);padding:36px 44px;border-radius:6px;font-family:Georgia,serif;font-size:15px;line-height:1.45}
.resume h1{font-size:25px;margin:0 0 2px}.resume h2{font-size:14px;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #999;padding-bottom:3px;margin:18px 0 8px}
.resume ul{margin:4px 0 8px;padding-left:20px}.resume p{margin:3px 0}.note{white-space:pre-wrap;background:#fff;border:1px solid var(--line);border-radius:6px;padding:20px;font-family:Georgia,serif}
.gap{border-left:4px solid var(--warn);background:#fff8ee;padding:10px 14px;border-radius:0 10px 10px 0;margin:8px 0}.good{border-left:4px solid var(--ok);background:#effaf4;padding:10px 14px;border-radius:0 10px 10px 0;margin:8px 0}
.hide{display:none}.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#16202e;color:#fff;padding:10px 18px;border-radius:10px;z-index:9}
.signbox{background:#fff8e1;border:1px solid #f0d98a;border-radius:10px;padding:14px;margin-bottom:16px}
@media print{header,.noprint{display:none!important}body{background:#fff}main{margin:0;max-width:none;padding:0}.resume{border:0;padding:0}}
</style></head><body>
<header><h1>Your CV</h1><nav id="nav"><button data-t="story" class="on">Interview</button><button data-t="review">Review</button><button data-t="cv">Your CV</button><button data-t="resume">Resume for a job</button><button data-t="hist">History</button></nav><a href="/">Job matches</a></header>
<main><div id="signbox" class="hide"></div><section id="story"></section><section id="review" class="hide"></section><section id="cv" class="hide"></section><section id="resume" class="hide"></section><section id="hist" class="hide"></section></main>
<div id="toast" class="toast hide"></div>
<script>
var S=null,qi=0,draft=[{}],last=null,cur='story';
function $(s){return document.querySelector(s)}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function toast(m){var t=$('#toast');t.textContent=m;t.classList.remove('hide');setTimeout(function(){t.classList.add('hide')},1800)}
async function api(p,b){var r=await fetch(p,b===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});var j=await r.json().catch(function(){return {}});if(!r.ok)throw new Error(j.error||r.status);return j}
function signIn(){return new Promise(async function(res){var r;try{r=await api('/api/auth/request',{})}catch(e){if(!/limit/.test(e.message)){alert(e.message);return res(false)}r={sent:false,note:e.message}}
 var box=$('#signbox');box.classList.remove('hide');box.className='signbox';
 box.innerHTML='<b>Sign in</b><div>'+esc(r.sent===false?r.note+' A code sent earlier still works.':'A 6-digit code was e-mailed to '+r.to+'.')+'</div><div class="row" style="margin-top:8px"><div><input id="scode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6-digit code"></div><button class="b pri" id="sgo">Sign in</button><button class="b" id="scancel">Cancel</button></div><div id="smsg" class="mut"></div>';
 function done(v){box.className='hide';box.innerHTML='';res(v)}
 $('#scancel').onclick=function(){done(false)};
 async function go(){try{await api('/api/auth/verify',{code:$('#scode').value.trim()});done(true)}catch(e){$('#smsg').textContent=e.message}}
 $('#sgo').onclick=go;$('#scode').onkeydown=function(e){if(e.key==='Enter')go()};$('#scode').focus()})}
async function authed(fn){try{return await fn()}catch(e){if(/sign in/.test(e.message)){if(await signIn())return await fn()}throw e}}
async function load(){S=await authed(function(){return api('/api/cv')})}
function go(t){cur=t;document.querySelectorAll('#nav button').forEach(function(b){b.classList.toggle('on',b.dataset.t==t)});['story','review','cv','resume','hist'].forEach(function(s){$('#'+s).classList.toggle('hide',s!=t)});
 ({story:rStory,review:rReview,cv:rCv,resume:rResume,hist:rHist})[t]();window.scrollTo(0,0)}
document.querySelectorAll('#nav button').forEach(function(b){b.onclick=function(){go(b.dataset.t)}});
function roleOpts(sel){return '<option value="">(no specific role)</option>'+S.roles.map(function(r){return '<option value="'+esc(r.id)+'"'+(r.id==sel?' selected':'')+'>'+esc(r.title+', '+r.org+' ('+r.start+' to '+r.end+')')+'</option>'}).join('')}
/* ---------- interview ---------- */
function rStory(){
 var qs=S.questions,done=qs.filter(function(q){return q.answer}).length;
 if(qi>=qs.length){$('#story').innerHTML='<div class="card"><h2>All '+qs.length+' questions answered</h2><p class="mut">Your CV holds '+S.facts.length+' achievements. Next: paste a job posting and get a tailored resume.</p><div class="row"><button class="b pri" onclick="go(\'resume\')">Resume for a job</button><button class="b" onclick="qi=0;rStory()">Review my answers</button></div></div>';return}
 var q=qs[qi];
 if(q.answer=='y'&&q.facts.length&&draft._q!==q.id){draft=q.facts.map(function(f){return {text:f.text,role:f.role}});draft._q=q.id}
 $('#story').innerHTML='<div class="card"><div class="bar"><i style="width:'+(done/qs.length*100)+'%"></i></div><div class="sec">'+esc(q.section)+' · '+(qi+1)+' of '+qs.length+'</div><div class="q">'+esc(q.ask)+'</div>'
  +'<div class="row"><button class="b yes" onclick="pick(\'y\')">Yes</button><button class="b" onclick="pick(\'n\')">No</button><button class="b" onclick="step(1)">Skip for now</button></div>'
  +(q.answer?'<p class="mut">Your earlier answer: <b>'+(q.answer=='y'?'Yes':'No')+'</b></p>':'')
  +'<div id="detail" class="'+(q.answer=='y'||draft._open?'':'hide')+'"></div>'
  +'<p style="margin-top:20px"><button class="link" onclick="step(-1)">← Back</button><button class="link" onclick="step(1)">Next →</button></p></div>';
 if(!$('#detail').classList.contains('hide'))rDetail()}
function rDetail(){
 $('#detail').innerHTML='<div class="hint"><b>One line, the way it would read on a resume:</b> start with a verb, say what and how big, add a result or a number.<br>Example: <i>Led a 6-person team that built a travel-demand model used by 12 state agencies.</i></div>'
  +draft.map(function(d,i){return '<div class="fact"><label>What you did</label><textarea oninput="draft['+i+'].text=this.value">'+esc(d.text)+'</textarea><label>In which role?</label><select onchange="draft['+i+'].role=this.value">'+roleOpts(d.role)+'</select></div>'}).join('')
  +'<div class="row"><button class="b" onclick="draft.push({});rDetail()">+ Add another</button><button class="b pri" onclick="saveQ(\'y\')">Save and continue</button></div>'}
function pick(a){if(a=='y'){draft._open=true;if(!draft.length)draft=[{}];$('#detail').classList.remove('hide');rDetail();return}saveQ(a)}
async function saveQ(a){var q=S.questions[qi];await authed(function(){return api('/api/cv/answer',{qid:q.id,answer:a,facts:a=='y'?draft.filter(function(d){return (d.text||'').trim()}):[]})});await load();toast(a=='y'?'Saved':'Noted');step(1)}
function step(n){qi=Math.max(0,qi+n);draft=[{}];rStory()}
/* ---------- review ---------- */
function rReview(){
 var items=S.review;
 $('#review').innerHTML='<div class="card"><h2>Review ('+items.length+')</h2><p class="mut">Claims found in older drafts that your verified CV does not contain. None of them will ever appear on a resume unless you confirm they are true.</p></div>'
  +(items.map(function(it){return '<div class="card" id="rv_'+esc(it.id)+'"><div class="hint">'+esc(it.why)+'</div><label>As it would appear on your resume</label><textarea id="rt_'+esc(it.id)+'">'+esc(it.text)+'</textarea><label>Role</label><select id="rr_'+esc(it.id)+'">'+roleOpts(it.role)+'</select><p class="row"><button class="b yes" onclick="rv(\''+esc(it.id)+'\',\'confirm\')">This is true, add it</button><button class="b bad" onclick="rv(\''+esc(it.id)+'\',\'reject\')">Not true, remove it</button></p></div>'}).join('')||'<div class="good">Nothing waiting for review.</div>')}
async function rv(id,action){try{await authed(function(){return api('/api/cv/review',{id:id,action:action,text:$('#rt_'+id).value,role:$('#rr_'+id).value})});await load();toast(action=='confirm'?'Added':'Removed');rReview()}catch(e){alert(e.message)}}
/* ---------- your cv ---------- */
function rCv(){
 var p=S.person;
 $('#cv').innerHTML='<div class="card"><h2>Your CV</h2><p class="mut">Last confirmed '+esc(S.verified_on||'never')+'. Everything a resume can say about you is here; changes apply to every future resume and re-run the job search.</p>'
  +'<h3>Summary</h3><textarea id="c_sum" style="min-height:120px">'+esc(S.summary)+'</textarea><p><button class="b pri" onclick="saveSet({summary:$(\'#c_sum\').value})">Save summary</button></p></div>'
  +'<div class="card"><h3>Contact</h3><div class="row"><div><label>Location</label><input id="p_loc" value="'+esc(p.location)+'"></div><div><label>Email on resumes</label><input id="p_mail" value="'+esc(p.email)+'"></div></div><div class="row"><div><label>LinkedIn</label><input id="p_li" value="'+esc(p.links.linkedin)+'"></div><div><label>Website</label><input id="p_site" value="'+esc(p.links.site)+'"></div></div><p><button class="b pri" onclick="saveSet({person:{location:$(\'#p_loc\').value,email:$(\'#p_mail\').value,links:{linkedin:$(\'#p_li\').value,site:$(\'#p_site\').value}}})">Save contact</button></p></div>'
  +'<div class="card"><h3>Roles</h3><div id="roles"></div><p><button class="b" onclick="addRole()">+ Add a role</button> <button class="b pri" onclick="saveRoles()">Save roles</button></p></div>'
  +'<div class="card"><h3>Achievements ('+S.facts.length+')</h3><p><button class="b" onclick="newFact()">+ Add an achievement</button></p><div id="fedit"></div><div id="facts"></div></div>'
  +'<div class="card"><h3>Publications</h3><div id="pubs"></div><p><button class="b" onclick="addPub()">+ Add a publication</button> <button class="b pri" onclick="savePubs()">Save publications</button></p></div>'
  +'<div class="card"><h3>Education (one per line)</h3><textarea id="c_edu">'+esc(S.education.join(String.fromCharCode(10)))+'</textarea><h3>Certifications (one per line)</h3><textarea id="c_cert">'+esc(S.certifications.join(String.fromCharCode(10)))+'</textarea><h3>Skills (comma separated)</h3><textarea id="c_sk">'+esc(S.skills.map(function(s){return s.name}).join(', '))+'</textarea><p><button class="b pri" onclick="saveLists()">Save these lists</button></p></div>'
  +'<div class="card"><h3>Backup</h3><p class="mut">Download your whole CV as a file, or restore one.</p><p><a href="/api/cv/export" download="cv-backup.json"><button class="b">Download backup</button></a> <input type="file" id="imp" accept="application/json" style="width:auto"></p></div>';
 drawRoles();drawFacts();drawPubs();$('#imp').onchange=importFile}
async function saveSet(d){try{await authed(function(){return api('/api/cv/set',d)});await load();toast('Saved');rCv()}catch(e){alert(e.message)}}
function drawRoles(){$('#roles').innerHTML=S.roles.map(function(r,i){return '<div class="fact" data-i="'+i+'"><div class="row"><div style="flex:2"><label>Title</label><input class="rt" value="'+esc(r.title)+'"></div><div style="flex:2"><label>Employer</label><input class="ro" value="'+esc(r.org)+'"></div></div><div class="row"><div><label>Place</label><input class="rl" value="'+esc(r.location)+'"></div><div><label>Start year</label><input class="rs" value="'+esc(r.start)+'"></div><div><label>End year or present</label><input class="re" value="'+esc(r.end)+'"></div><button class="link bad" onclick="delRole('+i+')">Remove</button></div></div>'}).join('')}
function readRoles(){return Array.prototype.map.call(document.querySelectorAll('#roles .fact'),function(el,i){return {id:(S.roles[i]||{}).id,title:el.querySelector('.rt').value,org:el.querySelector('.ro').value,location:el.querySelector('.rl').value,start:el.querySelector('.rs').value,end:el.querySelector('.re').value,tags:(S.roles[i]||{}).tags||[]}})}
function addRole(){S.roles=readRoles();S.roles.push({title:'',org:'',location:'',start:'',end:'',tags:[]});drawRoles()}
function delRole(i){S.roles=readRoles();S.roles.splice(i,1);drawRoles()}
function saveRoles(){saveSet({roles:readRoles()})}
function drawFacts(){var role={};S.roles.forEach(function(r){role[r.id]=r.title+', '+r.org});$('#facts').innerHTML=S.facts.map(function(f){return '<div class="fact"><div>'+esc(f.text)+'</div><div class="mut" style="font-size:13px">'+esc(role[f.role]||'No specific role')+'</div><div>'+(f.tags||[]).map(function(t){return '<span class="tag">'+esc(t.replace(/_/g,' '))+'</span>'}).join('')+'</div><button class="link" onclick="editFact(\''+esc(f.id)+'\')">Edit</button><button class="link bad" onclick="delFact(\''+esc(f.id)+'\')">Remove</button></div>'}).join('')}
function newFact(){editFact(null)}
function editFact(id){var f=S.facts.filter(function(x){return x.id==id})[0]||{text:'',role:'',tags:[]};
 $('#fedit').innerHTML='<div class="fact"><label>What you did</label><textarea id="e_t">'+esc(f.text)+'</textarea><label>Role</label><select id="e_r">'+roleOpts(f.role)+'</select><label>Topics (so the right jobs find this)</label><div>'+S.tags.map(function(t){return '<label style="display:inline-block;font-weight:400;margin:2px 12px 2px 0"><input type="checkbox" style="width:auto" value="'+t+'"'+((f.tags||[]).indexOf(t)>=0?' checked':'')+'> '+t.replace(/_/g,' ')+'</label>'}).join('')+'</div><p><button class="b pri" onclick="saveFact(\''+(id||'')+'\')">Save</button></p></div>';$('#e_t').focus()}
async function saveFact(id){var tags=Array.prototype.map.call(document.querySelectorAll('#fedit input:checked'),function(c){return c.value});try{await authed(function(){return api('/api/cv/fact',{id:id||undefined,text:$('#e_t').value,role:$('#e_r').value,tags:tags})});await load();toast('Saved');rCv()}catch(e){alert(e.message)}}
async function delFact(id){if(!confirm('Remove this achievement?'))return;await authed(function(){return api('/api/cv/fact',{id:id,delete:true})});await load();rCv()}
function drawPubs(){$('#pubs').innerHTML=S.publications.map(function(p){return '<div class="fact pubrow"><label>Title</label><input class="pt" value="'+esc(p.title)+'"><div class="row"><div><label>Year</label><input class="py" value="'+esc(p.year)+'"></div><div style="flex:2"><label>DOI (optional)</label><input class="pd" value="'+esc(p.doi)+'"></div></div></div>'}).join('')}
function readPubs(){return Array.prototype.map.call(document.querySelectorAll('#pubs .pubrow'),function(el,i){return {id:(S.publications[i]||{}).id,title:el.querySelector('.pt').value,year:el.querySelector('.py').value,doi:el.querySelector('.pd').value,tags:(S.publications[i]||{}).tags||[]}})}
function addPub(){S.publications=readPubs();S.publications.push({title:'',year:'',doi:'',tags:[]});drawPubs()}
function savePubs(){saveSet({publications:readPubs()})}
function saveLists(){var nl=String.fromCharCode(10),known={};S.skills.forEach(function(s){known[s.name]=s.tags});
 saveSet({education:$('#c_edu').value.split(nl),certifications:$('#c_cert').value.split(nl),skills:$('#c_sk').value.split(',').map(function(n){n=n.trim();return {name:n,tags:known[n]||[]}})})}
async function importFile(e){var f=e.target.files[0];if(!f)return;if(!confirm('Replace your whole CV with this file?'))return;try{var d=JSON.parse(await f.text());await authed(function(){return api('/api/cv/import',d)});await load();toast('Restored');rCv()}catch(x){alert(x.message)}}
/* ---------- resume for a job ---------- */
function rResume(){
 $('#resume').innerHTML='<div class="card noprint"><h2>Resume for a job</h2><p class="mut">Paste the job link or the whole posting. The resume and cover note are built only from your CV and checked line by line.</p><textarea id="job" style="min-height:150px" placeholder="Paste the job posting or its link"></textarea><div class="row"><div><label>Job title (optional)</label><input id="jt"></div><div><label>Employer (optional)</label><input id="jc"></div></div><p><button class="b pri" onclick="make()">Build my resume</button></p></div><div id="out"></div>';if(last)show(last)}
async function make(){var job=$('#job').value.trim();if(!job)return toast('Paste a posting first');$('#out').innerHTML='<p class="mut">Reading the posting…</p>';
 try{last=await authed(function(){return api('/api/analyze',{input:job,title:$('#jt').value,company:$('#jc').value})});show(last)}catch(e){$('#out').innerHTML='<div class="gap">'+esc(e.message)+'</div>'}}
function inl(s){return esc(s).replace(/[*][*](.+?)[*][*]/g,'<b>$1</b>').replace(/(https:[/][/][^ ,<)]+)/g,'<a href="$1" target="_blank" rel="noopener">$1</a>')}
function md(t){var out=[],inl_=false;t.split(String.fromCharCode(10)).forEach(function(l){var li=l.indexOf('- ')==0;if(inl_&&!li){out.push('</ul>');inl_=false}
 if(l.indexOf('# ')==0)out.push('<h1>'+esc(l.slice(2))+'</h1>');else if(l.indexOf('## ')==0)out.push('<h2>'+esc(l.slice(3))+'</h2>');else if(li){if(!inl_){out.push('<ul>');inl_=true}out.push('<li>'+inl(l.slice(2))+'</li>')}else if(l.trim())out.push('<p>'+inl(l)+'</p>')});if(inl_)out.push('</ul>');return out.join('')}
function show(r){
 var gaps=(r.cv_gaps||[]).map(function(g){return '<div class="gap"><b>The posting asks for '+esc(g.cluster.replace(/_/g,' '))+' and your CV does not mention it.</b> Have you done any of this?'+g.questions.map(function(q){return '<div style="margin-top:6px">'+esc(q.ask)+' <button class="link" onclick="jump(\''+esc(q.id)+'\')"><b>Answer →</b></button></div>'}).join('')+'</div>'}).join('');
 var d=r.draft||{};
 $('#out').innerHTML='<div class="card noprint"><h2>'+esc(r.verdict)+' ('+r.fit_score+')</h2><div class="mut">'+esc(r.title)+' · '+esc(r.company)+' · '+esc(r.location)+'</div><p>'+(r.would_appear_in_your_search?'This kind of role is in your job search.':'This role would not show up in your search: '+esc((r.why_not_in_search||[]).join('; ')))+'</p>'
  +(d.resume?'<div class="row"><button class="b pri" onclick="window.print()">Print or save as PDF</button><button class="b" onclick="cp(last.draft.resume)">Copy resume</button><button class="b" onclick="cp(last.draft.note)">Copy cover note</button></div>':'<div class="gap">Draft blocked: '+esc(d.blocked)+'</div>')+'</div>'
  +(d.resume?'<div class="resume">'+md(d.resume)+'</div><h3 class="noprint">Cover note</h3><div class="note noprint">'+esc(d.note)+'</div>':'')
  +'<div class="noprint"><h3>'+((r.cv_gaps||[]).length?'Gaps to close':'No gaps found')+'</h3>'+(gaps||'<div class="good">Everything this posting asks for is covered by your CV.</div>')+'</div>'}
function cp(t){navigator.clipboard.writeText(t);toast('Copied')}
function jump(id){qi=S.questions.findIndex(function(q){return q.id==id});draft=[{}];go('story')}
/* ---------- history ---------- */
async function rHist(){var h=await authed(function(){return api('/api/cv/history')});
 $('#hist').innerHTML='<div class="card"><h2>Resumes you built</h2><p class="mut">The last 200, newest first.</p></div>'+(h.items.map(function(x){return '<div class="card"><b>'+esc(x.title)+'</b> · '+esc(x.company)+' <span class="mut">'+esc(x.ts.slice(0,10))+' · '+esc(x.verdict)+' ('+x.fit+')</span> <button class="link" onclick="openHist('+x.id+')">Open</button></div>'}).join('')||'<div class="good">Nothing yet.</div>')}
async function openHist(id){var x=await authed(function(){return api('/api/cv/history/'+id)});last={title:x.title,company:x.company,location:'',verdict:x.verdict,fit_score:x.fit,would_appear_in_your_search:true,cv_gaps:[],draft:{resume:x.resume_md,note:x.note_md}};go('resume')}
load().then(function(){qi=Math.max(0,S.questions.findIndex(function(q){return !q.answer}));if(qi<0)qi=0;if(location.hash.indexOf('#q=')==0){var i=S.questions.findIndex(function(q){return q.id==location.hash.slice(3)});if(i>=0)qi=i}
 var rv=document.querySelector('#nav button[data-t=review]');rv.textContent='Review ('+S.review.length+')';rStory()}).catch(function(e){$('#story').innerHTML='<div class="card"><b>Could not load your CV.</b> '+esc(e.message)+'</div>'});
</script></body></html>`;
