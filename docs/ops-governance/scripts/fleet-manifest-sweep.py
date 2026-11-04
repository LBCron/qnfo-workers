#!/usr/bin/env python3
"""fleet-manifest-sweep.py v2.1 - self-contained fleet self-documentation generator.

v2.0 (2026-09-03, INFRA-AUDIT S0-P0); v2.1 (2026-09-06): + Consolidation & governance candidates section (weekly integration audit): the enumeration + /health-probe stage used to live
outside this script (cron wrote a Temp fleet_rows.json ad hoc), which produced
NO-HEALTH false negatives and let hand-edited cycle notes drift the counts.
Now self-contained: CF API worker list + live /health probes (browser UA, correct
subdomain <name>.q08.workers.dev) + repo-dir alias map + counts derived from rows.
Usage: python fleet-manifest-sweep.py [qnfo-ops-repo-root]   (CLOUDFLARE_API_TOKEN in env)
"""
import json, os, re, sys, datetime, urllib.request, urllib.error

ACCOUNT = 'edb167b78c9fb901ea5bca3ce58ccc4b'
SUBDOMAIN = 'q08'
TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 QNFO-fleet-sweep/2.0'
_here = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('QNFO_OPS_ROOT', '') or os.path.dirname(_here)
QW = os.path.join(REPO_ROOT, '..', 'qnfo-workers') if REPO_ROOT else ''
QO = REPO_ROOT or ''

# Live worker name -> repo dir alias (dir names that differ from live script names)
ALIAS = {
    'qnfo-memory-mcp': 'memory-mcp',
    'qnfo-agent-orchestrator': 'agent-orchestrator',
    'qnfo-skills-discovery': 'skills-discovery',
    'calendar-api': 'calendar',
    'qnfo-errata-orchestrator': 'errata-orchestrator',
    'qnfo-lifecycle': 'personal-lifecycle',
}

def cf_api(path):
    req = urllib.request.Request('https://api.cloudflare.com/client/v4' + path,
                                 headers={'Authorization': 'Bearer ' + TOKEN, 'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)

def probe_health(name):
    url = 'https://%s.%s.workers.dev/health' % (name, SUBDOMAIN)
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=8) as r:
            body = r.read().decode('utf-8', 'replace')[:2000]
    except urllib.error.HTTPError as e:
        if e.code == 401:
            return ('AUTH-GATED', None)
        if e.code in (404, 405):
            return _probe_root(name)
        return ('NO-HEALTH', None)
    except Exception:
        return ('NO-HEALTH', None)
    try:
        d = json.loads(body)
        ver = d.get('version') or d.get('VERSION')
        return (ver if ver else 'NO-VERSION', d)
    except Exception:
        m = re.search(r'version["\':=]+([0-9][0-9a-zA-Z.\-]*)', body)
        return (m.group(1) if m else 'NO-VERSION', None)

def _probe_root(name):
    url = 'https://%s.%s.workers.dev/' % (name, SUBDOMAIN)
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=8) as r:
            return ('ROOT-ONLY', None)
    except Exception:
        return ('NO-HEALTH', None)

def repo_dir(name):
    cand = ALIAS.get(name, name)
    if QW and os.path.isdir(os.path.join(QW, cand)):
        return 'qnfo-workers/' + cand
    if QO and os.path.isdir(os.path.join(QO, 'cloud', cand)):
        return 'qnfo-ops/cloud/' + cand
    if QW and os.path.isdir(os.path.join(QW, name)):
        return 'qnfo-workers/' + name
    return None

def deployed_version(name):
    d = repo_dir(name)
    if not d:
        return None
    base = os.path.join(QW, d.split('/', 1)[1]) if d.startswith('qnfo-workers') else os.path.join(QO, 'cloud', d.split('/', 1)[1])
    for fname in ('deployed-current.worker.js', 'worker.js'):
        cand = os.path.join(base, fname)
        if not os.path.isfile(cand):
            continue
        try:
            txt = open(cand, encoding='utf-8', errors='replace').read()
        except Exception:
            return None
        m = re.search(r'VERSION\s*=\s*["\']([^"\']+)["\']', txt)
        if m:
            return m.group(1)
        m2 = re.search(r'version:[^0-9]{0,12}([0-9]+\.[0-9]+\.[0-9]+)', txt)
        return m2.group(1) if m2 else 'UNVERSIONED'
    return None


def is_strict_semver(ver):
    """HUB-VERSIONING-1: strict semver = X.Y.Z (digits only). Flags absorbed-N-*/merged-date/
    slash-form/v-prefix/-suffix stamps as non-semver (drift scanner must flag them)."""
    return bool(re.fullmatch(r'\d+\.\d+\.\d+', ver))


def main():
    if not TOKEN:
        print('CLOUDFLARE_API_TOKEN missing'); sys.exit(2)
    data = cf_api('/accounts/%s/workers/scripts?per_page=100' % ACCOUNT)
    scripts = data.get('result', [])
    if not scripts:
        print('no workers returned: %s' % data.get('errors')); sys.exit(2)
    rows = []
    for w in scripts:
        name = w['id'] if isinstance(w.get('id'), str) else w.get('name')
        if not isinstance(w.get('id'), str) and w.get('name'):
            name = w['name']
        ver, body = probe_health(name)
        rows.append({'name': name, 'version': ver, 'modified': (w.get('modified_on') or '')[:19].replace('T', ' ')})
    now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
    L = ['# QNFO FLEET MANIFEST — Cloudflare Workers Ecosystem', '',
         '> Auto-generated ' + now + ' by fleet-manifest-sweep.py v2.1 (self-contained enumeration + /health probes).',
         '> Living inventory; weekly Fleet Drift cron (42b1988c) re-generates this file from live CF state - do NOT hand-edit;',
         '> deploy history lives in qnfo-audit deployment_history + git log.',
         '', '## Self-documentation policy (FLEET-SELF-DOC-1)', '',
         'Every worker MUST carry: (1) VERSION reachable via /health; (2) header with purpose/canonical source;',
         '(3) canonical repo deployed-current.worker.js. Status: OK = all; PARTIAL = versioned not repo-synced;',
         'GAP = missing one or more. AUTH-GATED = /health behind auth (monitor must send bearer).',
         'VERSION-FORMAT = /health version is not strict semver X.Y.Z (HUB-VERSIONING-1: no v-prefix / -suffix / absorbed-N / merged-date / slash-form).',
         '', '## Fleet (' + str(len(rows)) + ' workers)', '',
         '| Worker | Live version | Modified (UTC) | Canonical repo | Repo version | Self-doc |',
         '|---|---|---|---|---|---|']
    for w in sorted(rows, key=lambda x: x['name']):
        name, ver, mod = w['name'], w['version'], w['modified']
        d = repo_dir(name); rv = deployed_version(name)
        if ver is None or ver in ('NO-HEALTH', 'ERR', 'None', 'True'):
            ver = 'NO-HEALTH'
        if ver not in ('NO-HEALTH', 'AUTH-GATED', 'NO-VERSION', 'ROOT-ONLY') and not is_strict_semver(ver):
            sd = 'VERSION-FORMAT (non-semver: ' + ver + ')'
        elif not d:
            sd = 'GAP (no repo dir)'
        elif rv is None:
            sd = 'PARTIAL (no repo deployed-current)'
        elif ver in ('NO-VERSION', 'ROOT-ONLY'):
            sd = 'PARTIAL (health w/o VERSION)'
        elif ver == 'AUTH-GATED':
            sd = 'GAP (auth-gated /health)'
        elif rv.lstrip('vV') != ver.lstrip('vV') and ver not in ('NO-HEALTH', 'AUTH-GATED'):
            sd = 'DRIFT repo=' + str(rv)
        else:
            sd = 'OK'
        L.append('| ' + name + ' | ' + ver + ' | ' + mod + ' | ' + (d or '-') + ' | ' + (rv or '-') + ' | ' + sd + ' |')
    ok = sum(1 for l in L if '| OK |' in l)
    drift = sum(1 for l in L if '| DRIFT ' in l)
    gap = sum(1 for l in L if ('| GAP ' in l) or ('| PARTIAL ' in l))
    nonsemver = sum(1 for l in L if '| VERSION-FORMAT ' in l)
    # --- Consolidation & governance candidates (auto; v2.1 2026-09-06 integration audit) ---
    def _sd_of(r):
        nm, ver = r['name'], r['version']
        d = repo_dir(nm); rv = deployed_version(nm)
        if ver is None or ver in ('NO-HEALTH', 'ERR', 'None', 'True'):
            ver = 'NO-HEALTH'
        if not d:
            return 'GAP'
        if rv is None:
            return 'PARTIAL'
        if ver in ('NO-VERSION', 'ROOT-ONLY'):
            return 'PARTIAL'
        if ver == 'AUTH-GATED':
            return 'GAP'
        if rv.lstrip('vV') != ver.lstrip('vV') and ver not in ('NO-HEALTH', 'AUTH-GATED'):
            return 'DRIFT'
        return 'OK'
    cron_count = {}
    for w in scripts:
        nm = w['id'] if isinstance(w.get('id'), str) else w.get('name')
        try:
            sched = cf_api('/accounts/%s/workers/scripts/%s/schedules' % (ACCOUNT, nm))
            cron_count[nm] = len((sched.get('result') or {}).get('schedules') or [])
        except Exception:
            cron_count[nm] = 0
    monolith = [r['name'] for r in rows if cron_count.get(r['name'], 0) >= 4]
    monolith.sort(key=lambda n: -cron_count.get(n, 0))
    gap_list = sorted([r['name'] for r in rows if _sd_of(r) == 'GAP'])
    cutoff = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=45)).strftime('%Y-%m-%d %H:%M:%S')
    dormant = sorted([r['name'] for r in rows if r['modified'] and r['modified'] < cutoff])
    L += ['', '## Consolidation & governance candidates (auto)', '',
          'Cron-density monoliths (>=4 schedules; merge/split candidates): ' + (', '.join(monolith) if monolith else 'none'),
          '',
          'No canonical repo dir (GAP - re-home per FLEET-SELF-DOC-1 or retire): ' + str(len(gap_list)),
          (('- ' + ', '.join(gap_list)) if gap_list else '- none'),
          '',
          'Dormant >45d since modified (archive/retire candidates): ' + (', '.join(dormant) if dormant else 'none'),
          '',
          '> Advisory output of the recurring integration/consolidation audit (weekly sweep + qnfo-kaizen digest).',
          '> Baseline 2026-09-06: see agent_issues source=qnfo-ops-audit-2026-09-06. Do NOT hand-edit - regenerate.']
    L += ['', '## Summary', '',
          '- Total workers: ' + str(len(rows)),
          '- Self-doc OK: ' + str(ok),
          '- Drift: ' + str(drift),
          '- GAP/PARTIAL: ' + str(gap),
          '- Non-semver version: ' + str(nonsemver),
          '', '## Self-improvement loop', '',
          '1. Fleet Drift & Self-Improvement Audit cron (weekly): re-runs this sweep, logs drift, repairs via wrangler redeploy.',
          '2. AI Worker Health + Provider Config Guard cron (every 3h): probes qnfo-ai + personal-api chat paths.',
          '3. QNFO Data Freshness Sync cron (every 6h): calendar + email to Vectorize.',
          '4. Kaizen cycles: every lesson becomes a named gate, dual-written. OPS-SELF-DOC.md is the master index.']
    out = os.path.join(QO, 'docs', 'FLEET-MANIFEST.md')
    open(out, 'w', encoding='utf-8').write('\n'.join(L))
    print('manifest regenerated rows=%d OK=%d drift=%d gap=%d' % (len(rows), ok, drift, gap))

if __name__ == '__main__':
    main()
