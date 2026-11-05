// research-daily-brief v1.1.0
// FIX 2026-09-13: fetchArxiv now has 3-attempt exponential backoff (1s/3s/9s) + Semantic Scholar fallback
// FIX 2026-09-13: scheduled() no longer silently drops errors; alertMsg fires on every failure
var VERSION = "1.1.2-doi-scrub";
var ARXIV = 'https://export.arxiv.org/api/query';
var UA = 'QNFO-Research-Bot/1.1 (research@qnfo.org)';
var ALERTS = 'alerts@qnfo.org';
var EMAIL_URL = 'https://qnfo-email.q08.workers.dev/send';
var CATS = 'cat:quant-ph OR cat:cond-mat.supr-con OR cat:cond-mat.mes-hall OR cat:cs.ET';
var DAILY_KW = {
  'JPCUB': [3, ['landauer','joules per compute','energy efficiency','thermodynamic cost','margolus-levitin','bit erasure','irreversible','kT ln2']],
  'QEC': [2, ['quantum error correction','surface code','fault tolerant','logical qubit','threshold','stabilizer','toric code','topological code','qldpc','ldpc']],
  'ANYON': [2, ['majorana','anyon','topological order','non-abelian','ising anyon','braiding','fusion rule','modular data']],
  'THERMO': [2, ['quantum thermodynamics','heat engine','carnot','entropy production','work extraction','maxwell demon','fluctuation theorem']],
  'COMPUTE': [1, ['quantum computing','qubit','gate fidelity','nisq','variational','vqe','qaoa','quantum advantage']]
};
function json(obj, status) { return new Response(JSON.stringify(obj), { status: status||200, headers: { 'Content-Type': 'application/json' } }); }
function clean(s) { return (s||'').replace(/\s+/g,' ').trim(); }
function norm(s) { return clean(s).toLowerCase(); }
function xmlTag(s, tag) { var m = s.match(new RegExp('<' + tag + '[^>]*>([^]*?)<\\/' + tag + '>')); return m ? clean(m[1]) : ''; }
function yesterday() { var d = new Date(); d.setUTCDate(d.getUTCDate()-1); return d.toISOString().slice(0,10); }
function parseAtom(xml) {
  var papers = [];
  var parts = xml.split('<entry>');
  for (var i = 1; i < parts.length; i++) {
    var e = parts[i];
    var idRaw = xmlTag(e,'id');
    if (!idRaw) continue;
    var id = idRaw.split('/abs/').pop().split('v')[0];
    var pub = clean(xmlTag(e,'published')).slice(0,10);
    var sum = clean(xmlTag(e,'summary'));
    var authors = [];
    var re = /<author>([^]*?)<\/author>/g;
    var m;
    while ((m = re.exec(e))) { var nm = clean(xmlTag(m[1],'name')); if (nm) authors.push(nm); }
    var cm = e.match(/<arxiv:primary_category[^>]*term="([^"]+)"/);
    papers.push({ id: id, title: clean(xmlTag(e,'title')), published: pub, summary: sum, authors: authors, primary_cat: cm ? cm[1] : '', source: 'arXiv' });
  }
  return papers;
}
// FIXED: exponential backoff (3 attempts: 1s, 3s, 9s) + Semantic Scholar fallback on persistent 429
async function fetchArxiv(env, ymd) {
  var RETRY_DELAYS = [1000, 3000, 9000];
  var lastErr;
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      var df = 'submittedDate:[' + ymd + '0000 TO ' + ymd + '2359]';
      var url = ARXIV + '?search_query=' + encodeURIComponent(CATS + ' AND ' + df) + '&start=0&max_results=200&sortBy=submittedDate&sortOrder=descending';
      var r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (r.status === 429 || r.status === 503) {
        lastErr = new Error('arxiv ' + r.status);
        if (attempt < 2) await new Promise(function(res){ setTimeout(res, RETRY_DELAYS[attempt]); });
        continue;
      }
      if (!r.ok) throw new Error('arxiv ' + r.status);
      return parseAtom(await r.text());
    } catch(e) {
      lastErr = e;
      if (attempt < 2) await new Promise(function(res){ setTimeout(res, RETRY_DELAYS[attempt]); });
    }
  }
  // Semantic Scholar fallback when arXiv is rate-limiting
  try {
    var ssUrl = 'https://api.semanticscholar.org/graph/v1/paper/search?query=quantum+error+correction+energy+efficiency+landauer&fields=title,authors,year,externalIds,abstract&limit=20';
    var sr = await fetch(ssUrl, { headers: { 'User-Agent': UA } });
    if (sr.ok) {
      var sdata = await sr.json();
      return (sdata.data || []).map(function(p) {
        return {
          id: (p.externalIds && p.externalIds.ArXiv) || p.paperId,
          title: p.title||'',
          published: (p.year||new Date().getFullYear())+'-01-01',
          summary: p.abstract||'',
          authors: (p.authors||[]).map(function(a){ return a.name; }),
          primary_cat: 'quant-ph',
          source: 'SemanticScholar'
        };
      });
    }
  } catch(_) {}
  throw lastErr || new Error('arxiv fetch failed after 3 attempts');
}
function matchPapers(papers) {
  var results = [];
  for (var i = 0; i < papers.length; i++) {
    var p = papers[i];
    var text = norm((p.title||'') + ' ' + (p.summary||''));
    var matches = {}; var total = 0; var bestProg = null; var bestW = 0;
    for (var prog in DAILY_KW) {
      var weight = DAILY_KW[prog][0]; var kws = DAILY_KW[prog][1];
      var hits = kws.filter(function(kw){ return text.indexOf(norm(kw)) >= 0; });
      if (hits.length) { var s = hits.length * weight; total += s; matches[prog] = hits; if (weight > bestW){ bestW = weight; bestProg = prog; } }
    }
    if (total > 0) results.push(Object.assign({}, p, { matches: matches, score: total, primary_program: bestProg }));
  }
  results.sort(function(a,b){ return b.score - a.score; });
  return results;
}
function formatBrief(papers, dateStr) {
  var out = [];
  out.push('QNFO Research Daily Briefing (arXiv) - ' + dateStr);
  out.push('='.repeat(60));
  if (!papers.length) { out.push('\nNo new papers matched QNFO keywords.'); return out.join('\n'); }
  var high = papers.filter(function(p){ return p.score >= 10; });
  var med = papers.filter(function(p){ return p.score >= 5 && p.score < 10; });
  var low = papers.filter(function(p){ return p.score < 5; });
  var tiers = [['HIGH RELEVANCE', high], ['MEDIUM', med], ['LOW - SKIMMABLE', low]];
  for (var t = 0; t < tiers.length; t++) {
    var group = tiers[t][1];
    if (!group.length) continue;
    out.push(''); out.push(tiers[t][0] + ' (' + group.length + ')');
    for (var j = 0; j < group.length; j++) {
      var p = group[j];
      var authors = p.authors.slice(0,2).join(', ');
      if (p.authors.length > 2) authors += ' et al.';
      var kws = [];
      for (var k in p.matches) { kws = kws.concat(p.matches[k].slice(0,3)); }
      out.push('  [' + (p.primary_program||'') + '] ' + String(p.title).slice(0,110));
      out.push('         ' + authors + ' | ' + p.id + ' | ' + p.published + ' | ' + (p.source||'arXiv'));
      if (kws.length) out.push('         Keywords: ' + Array.from(new Set(kws)).sort().slice(0,5).join(', '));
      out.push('');
    }
  }
  var progs = Array.from(new Set(papers.map(function(p){ return p.primary_program; }).filter(Boolean)));
  out.push('-'.repeat(60));
  out.push(papers.length + ' papers in ' + progs.length + ' programs: ' + progs.sort().join(', '));
  return out.join('\n');
}
async function sendEmail(env, to, subject, body, from) {
  var bind = env['qnfo-email'];
  var key = env.EMAIL_API_KEY;
  if (!key) throw new Error('EMAIL_API_KEY missing (fail-closed)');
  var payload = { to: to, subject: subject, body: body };
  if (from) payload.from = from;
  var r = await (bind ? bind.fetch.bind(bind) : fetch)(EMAIL_URL, { method: 'POST', headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify(payload) });
  var txt = await r.text();
  if (!r.ok && txt.indexOf('"success":true') < 0) throw new Error('email ' + r.status + ' ' + txt.slice(0,120));
  return txt;
}
async function alertMsg(env, msg) {
  try {
    await env.OUTREACH_DB.prepare('CREATE TABLE IF NOT EXISTS brief_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, text TEXT)').run();
    await env.OUTREACH_DB.prepare('INSERT INTO brief_alerts (ts, text) VALUES (?,?)').bind(new Date().toISOString(), String(msg).slice(0,4000)).run();
  } catch(e){}
}
async function runBrief(env, dateStr, dry) {
  var ymd = dateStr.replace(/-/g,'');
  var pid = dry ? '__DRY__' : '__BRIEF__';
  var ins = await env.OUTREACH_DB.prepare('INSERT OR IGNORE INTO sent_log (brief_date, paper_id, status) VALUES (?,?,?)').bind(dateStr, pid, 'pending').run();
  if (ins.meta.changes === 0) return { status: dry ? 'dry_already' : 'already_sent', date: dateStr };
  var papers = await fetchArxiv(env, ymd);
  var matched = matchPapers(papers);
  var text = formatBrief(matched, dateStr);
  var subject = 'QNFO Research Briefing - ' + dateStr;
  if (dry) {
    await env.OUTREACH_DB.prepare('UPDATE sent_log SET status=?, sent_at=? WHERE brief_date=? AND paper_id=?').bind('dry', new Date().toISOString(), dateStr, pid).run();
    return { status: 'dry', date: dateStr, scanned: papers.length, matched: matched.length, preview: text.slice(0,500) };
  }
  try {
    await env.OUTREACH_DB.prepare('CREATE TABLE IF NOT EXISTS brief_artifacts (id INTEGER PRIMARY KEY AUTOINCREMENT, brief_date TEXT, body TEXT, created_at TEXT)').run();
    await env.OUTREACH_DB.prepare('INSERT INTO brief_artifacts (brief_date, body, created_at) VALUES (?,?,?)').bind(dateStr, text.slice(0,30000), new Date().toISOString()).run();
    await env.OUTREACH_DB.prepare('UPDATE sent_log SET status=?, sent_at=? WHERE brief_date=? AND paper_id=?').bind('sent', new Date().toISOString(), dateStr, pid).run();
    return { status: 'persisted', date: dateStr, scanned: papers.length, matched: matched.length };
  } catch(e) {
    await env.OUTREACH_DB.prepare('UPDATE sent_log SET status=?, sent_at=? WHERE brief_date=? AND paper_id=?').bind('failed', new Date().toISOString(), dateStr, pid).run();
    throw e;
  }
}
function topicsFor(title) {
  var t = title.toLowerCase();
  if (t.indexOf('primon') >= 0 || t.indexOf('zeta') >= 0) return ['all:"primon gas" OR all:"free Riemann gas"'];
  if (t.indexOf('measurement') >= 0) return ['all:"quantum measurement" OR all:"measurement problem"'];
  return ['all:"mathematical physics" OR all:"foundations of physics"'];
}
async function scanOutreach(env) {
  var today = new Date().toISOString().slice(0,10);
  // NOZ-DOI-1 (2026-10-10): no repository lookup; scan the default topic only.
  var hits = [{ metadata: { title: '' } }];
  var count = 0;
  for (var i = 0; i < Math.min(hits.length, 2); i++) {
    var title = ((hits[i].metadata && hits[i].metadata.title) || '').slice(0,150);
    var topics = topicsFor(title);
    for (var t = 0; t < topics.length; t++) {
      var url2 = ARXIV + '?search_query=' + encodeURIComponent(topics[t] + ' AND submittedDate:[202408310000 TO 202608312359]') + '&start=0&max_results=10';
      var r2 = await fetch(url2, { headers: { 'User-Agent': UA } });
      if (!r2.ok) continue;
      var xml = await r2.text();
      var parts = xml.split('<entry>');
      for (var j = 1; j < parts.length; j++) {
        var e = parts[j];
        var nm = clean(xmlTag(e,'name'));
        if (!nm) continue;
        var pid2 = (xmlTag(e,'id')||'').split('/abs/').pop();
        var ptitle = clean(xmlTag(e,'title')).slice(0,130);
        var am = e.match(/<arxiv:affiliation>([^]*?)<\/arxiv:affiliation>/);
        var aff = am ? clean(am[1]) : '';
        var ins2 = await env.OUTREACH_DB.prepare('INSERT OR IGNORE INTO outreach_candidates (scan_date, name, affiliation, paper_id, paper_title, topic, created_at) VALUES (?,?,?,?,?,?,?)').bind(today, nm, aff, pid2, ptitle, topics[t], new Date().toISOString()).run();
        count += ins2.meta.changes;
      }
    }
  }
  return { scanned: hits.length, new_candidates: count, date: today };
}
export default {
  async fetch(request, env) {
    var url = new URL(request.url);
    try {
      if (url.pathname === '/health') return json({ ok: true, version: VERSION, emailKey: !!env.EMAIL_API_KEY, db: !!env.OUTREACH_DB, time: new Date().toISOString() });
      if (url.pathname === '/run') { var date = url.searchParams.get('date') || yesterday(); var dry = url.searchParams.get('dry') === '1'; return json(await runBrief(env, date, dry)); }
      if (url.pathname === '/scan') return json(await scanOutreach(env));
      if (url.pathname === '/candidates') { var r = await env.OUTREACH_DB.prepare('SELECT * FROM outreach_candidates ORDER BY id DESC LIMIT 25').all(); return json(r.results); }
      return json({ ok: true, name: 'research-daily-brief', version: VERSION, endpoints: ['/health','/run?date=YYYY-MM-DD&dry=1','/scan','/candidates'] });
    } catch(e) {
      try { await alertMsg(env, String((e && e.stack) || e)); } catch(_){}
      return json({ error: String((e && e.message) || e) }, 500);
    }
  },
  async scheduled(event, env) {
    try {
      await runBrief(env, yesterday(), false);
      await scanOutreach(env);
    } catch(e) {
      await alertMsg(env, 'scheduled run failed: ' + String((e && e.stack) || e));
    }
  }
};