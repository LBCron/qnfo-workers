#!/usr/bin/env python3
"""fleet-wiring-sweep.py v1.0 - live trigger+binding wiring matrix for the QNFO fleet.

WHAT: pulls the authoritative runtime contract (when a worker runs, what it binds:
D1/KV/R2/Vectorize/queues/services/secrets, where it is exposed: crons/routes/domains)
from the Cloudflare Workers Scripts API for every live worker.

WHY: FLEET-ARCHITECTURE-1 (2026-09-09 user directive) - a self-aware/self-healing fleet
requires that "what happens when worker X runs" be answerable from LIVE state for every
worker, not from memory. This is the wiring layer; consumer edges live in
FLEET-CONSUMER-MAP.md (SVC bindings) and purpose text in qnfo-audit.service_registry.

OUTPUT:
  docs/fleet-architecture/wiring-live.json   raw per-worker wiring (bindings + triggers)
  docs/fleet-architecture/wiring-summary.md  compact matrix (76 rows)

PRECONDITION: CLOUDFLARE_API_TOKEN env (Bearer), account id constant below.
POSTCONDITION: json + md written; stdout = stats + first 3 rows; exit 0 on success.
Usage: python fleet-wiring-sweep.py [repo-root]
"""
import json, os, sys, datetime, urllib.request, urllib.error

ACCOUNT = 'edb167b78c9fb901ea5bca3ce58ccc4b'
TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) QNFO-fleet-wiring-sweep/1.0'
_here = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(_here)
OUT = os.path.join(REPO_ROOT, 'docs', 'fleet-architecture')
os.makedirs(OUT, exist_ok=True)

def cf_api(path):
    req = urllib.request.Request('https://api.cloudflare.com/client/v4' + path,
                                 headers={'Authorization': 'Bearer ' + TOKEN,
                                          'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.load(r)

def compact_binding(b):
    t = b.get('type')
    if t == 'kv_namespace': return {'t':'kv','n':b.get('name'),'id':b.get('namespace_id')}
    if t == 'd1_database': return {'t':'d1','n':b.get('name'),'id':b.get('database_id')}
    if t == 'r2_bucket': return {'t':'r2','n':b.get('name'),'b':b.get('bucket_name')}
    if t == 'vectorize': return {'t':'vz','n':b.get('name'),'idx':b.get('index_name')}
    if t == 'queue': return {'t':'q','n':b.get('name'),'q':b.get('queue_name')}
    if t == 'service': return {'t':'svc','n':b.get('name'),'s':b.get('service'),
                               'env':b.get('environment')}
    if t in ('secret_text','plain_text'): return {'t':'sec' if t=='secret_text' else 'txt',
                                                  'n':b.get('name')}
    if t == 'durable_object_namespace': return {'t':'do','n':b.get('name'),
                                                'id':b.get('namespace_id'),
                                                'cls':b.get('class_name')}
    if t == 'analytics_engine': return {'t':'ae','n':b.get('name')}
    return {'t':t,'n':b.get('name')}

def pull(name):
    d = cf_api('/accounts/%s/workers/scripts/%s/settings' % (ACCOUNT, name))['result']
    trig = d.get('triggers', {}) or {}
    row = {
        'name': name,
        'modified': d.get('modified_on'),
        'usage_model': d.get('usage_model'),
        'compatibility_date': d.get('compatibility_date'),
        'crons': [{'cron': c.get('cron'), 'mod': c.get('modified_on')} for c in trig.get('crons', [])],
        'routes': [{'pattern': r.get('pattern'), 'custom_domain': r.get('custom_domain')}
                   for r in trig.get('routes', [])],
        'queue_consumers': trig.get('queue_consumers', []),
        'bindings': [compact_binding(b) for b in d.get('bindings', [])],
    }
    return row

def main():
    wl = cf_api('/accounts/%s/workers/scripts' % ACCOUNT)['result']
    rows, errs = [], []
    for w in wl:
        nm = w.get('name') or w.get('id')
        try:
            rows.append(pull(nm))
        except Exception as e:
            errs.append({'name': nm, 'err': str(e)[:200]})
    rows.sort(key=lambda r: r['name'])
    out = {'generated': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'account': ACCOUNT, 'worker_count': len(rows), 'errors': errs, 'workers': rows}
    with open(os.path.join(OUT, 'wiring-live.json'), 'w') as f:
        json.dump(out, f, indent=1)
    # compact summary md
    lines = ['# QNFO FLEET WIRING MATRIX (live)',
             '',
             '> Auto-generated %s by fleet-wiring-sweep.py v1.0 from the Workers Scripts API.' % out['generated'],
             '> Trigger+binding layer. Consumers: FLEET-CONSUMER-MAP.md; purposes: qnfo-audit.service_registry.',
             '',
             '| Worker | Crons | Routes | D1 | KV | R2 | VZ | Queues | SVC calls | Secrets |',
             '|---|---|---|---|---|---|---|---|---|---|']
    for r in rows:
        b = r['bindings']
        d1 = ','.join(x['n'] for x in b if x['t']=='d1') or '-'
        kv = ','.join(x['n'] for x in b if x['t']=='kv') or '-'
        r2 = ','.join(x['n'] for x in b if x['t']=='r2') or '-'
        vz = ','.join(x['n'] for x in b if x['t']=='vz') or '-'
        q = ','.join(x['n'] for x in b if x['t']=='q') or '-'
        svc = ','.join(x['n'] for x in b if x['t']=='svc') or '-'
        sec = sum(1 for x in b if x['t']=='sec')
        crons = '%d' % len(r['crons'])
        if r['crons']:
            crons += ': ' + '; '.join(c['cron'] for c in r['crons'])
        routes = '%d' % len(r['routes'])
        lines.append('| %s | %s | %s | %s | %s | %s | %s | %s | %s | %d |' % (
            r['name'], crons, routes, d1, kv, r2, vz, q, svc, sec))
    with open(os.path.join(OUT, 'wiring-summary.md'), 'w') as f:
        f.write('\n'.join(lines) + '\n')
    print('OK workers=%d errors=%d' % (len(rows), len(errs)))
    for e in errs:
        print('ERR', e['name'], e['err'])
    print('--- first rows ---')
    for r in rows[:3]:
        print(json.dumps(r)[:600])
    print('--- trigger census ---')
    ncron = sum(len(r['crons']) for r in rows)
    nroute = sum(len(r['routes']) for r in rows)
    print('total crons=%d routes=%d' % (ncron, nroute))
    print('workers with >=1 cron:', sum(1 for r in rows if r['crons']))
    print('workers with >=1 route:', sum(1 for r in rows if r['routes']))

if __name__ == '__main__':
    main()
