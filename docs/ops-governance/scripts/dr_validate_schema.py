#!/usr/bin/env python3
"""dr_validate_schema.py — D1 schema gate (permanent, 2026-09-01).
Validates required tables/columns in qnfo-audit + living-paper D1 databases
via the Cloudflare API (Bearer auth, D1-QUERY-BEARER-FALLBACK-1).
Prints 'SCHEMA OK' and exits 0 when all required objects exist; exit 1 otherwise.
Canonical: QNFO/qnfo-ops/scripts/dr_validate_schema.py  (mirrored .deepchat/scripts)
"""
import os, sys, json, urllib.request, urllib.error

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCT = 'edb167b78c9fb901ea5bca3ce58ccc4b'

REQUIRED = {
    'qnfo-audit': {
        'handoffs': ['id', 'session_id', 'project_id', 'phase_completed', 'summary', 'wbs_code'],
        'wbs_state': ['project_id', 'current_phase', 'total_phases', 'last_updated'],
        'chat': ['id', 'thread', 'ts', 'role', 'content', 'model', 'source'],
        'chatbox_conversations': ['id', 'thread_id', 'source', 'worker', 'model', 'messages_json', 'prompt', 'response', 'ts', 'ua'],
        'worker_invocations': ['worker_name', 'endpoint', 'status_code', 'duration_ms', 'created_at'],
        'ai_queries': ['id', 'ts', 'model', 'strategy', 'prompt', 'response', 'latency_ms'],
        'alerts': ['id', 'source', 'level', 'message', 'digested', 'created_at'],
        'cloud_ops_events': ['id', 'ts', 'kind', 'text', 'meta', 'job', 'status'],
        'infra_state': ['id', 'ts', 'kind', 'data'],
    },
    'living-paper': {
        # actual schema verified 2026-09-01 via PRAGMA
        'papers': ['identifier', 'title', 'authors', 'status', 'doi', 'slug', 'created_at'],
        'paper_ids': ['slug', 'vectorize_id', 'kg_id', 'doi', 'r2_path', 'zenodo_url', 'papers_server_url', 'created_at'],
        'term_crosswalks': ['id', 'term', 'class', 'domains', 'source_record', 'note', 'updated_at'],
        'paper_versions': ['identifier', 'component', 'ghost_ts', 'content_hash'],
        'citations': ['id', 'paper_id', 'citation_key', 'title', 'authors', 'year', 'doi'],
    },
}

DBS = {
    'qnfo-audit': '35e2e573-92f3-46ac-83c6-22f6429fc5e5',
    'living-paper': '70a58cb3-b2cd-498d-877f-ecca86859a22',
}

def query(db_id, sql):
    body = json.dumps({'sql': sql}).encode()
    url = f'https://api.cloudflare.com/client/v4/accounts/{ACCT}/d1/database/{db_id}/query'
    req = urllib.request.Request(url, method='POST', data=body, headers={
        'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            d = json.loads(r.read().decode('utf-8'))
        if not d.get('success'):
            return {'err': d.get('errors')}
        return d.get('result', [{}])[0].get('results', [])
    except urllib.error.HTTPError as e:
        return {'err': 'HTTP ' + str(e.code) + ': ' + e.read().decode('utf-8')[:300]}
    except Exception as e:
        return {'err': type(e).__name__ + ': ' + str(e)[:200]}

def main():
    if not TOKEN:
        print('SCHEMA ERROR: CLOUDFLARE_API_TOKEN missing')
        return 1
    errors = []
    ok_count = 0
    for dbname, tables in REQUIRED.items():
        dbid = DBS.get(dbname)
        if not dbid:
            errors.append(f'{dbname}: unknown db id')
            continue
        tbl_res = query(dbid, "SELECT name FROM sqlite_master WHERE type='table'")
        if isinstance(tbl_res, dict) and tbl_res.get('err'):
            errors.append(f'{dbname}: list tables failed: {tbl_res["err"]}')
            continue
        have_tables = {row.get('name') for row in tbl_res if row.get('name')}
        for table, cols in tables.items():
            if table not in have_tables:
                errors.append(f'{dbname}.{table}: TABLE MISSING')
                continue
            col_res = query(dbid, f"PRAGMA table_info({table})")
            if isinstance(col_res, dict) and col_res.get('err'):
                errors.append(f'{dbname}.{table}: pragma failed: {col_res["err"]}')
                continue
            have_cols = {row.get('name') for row in col_res if row.get('name')}
            missing = [c for c in cols if c not in have_cols]
            if missing:
                errors.append(f'{dbname}.{table}: missing columns {missing}')
            else:
                ok_count += 1
    if errors:
        for e in errors:
            print(f'[SCHEMA-VIOLATION] {e}')
        print(f'SCHEMA ERROR: {len(errors)} violation(s), {ok_count} objects OK')
        return 1
    print(f'SCHEMA OK ({ok_count} tables/columns validated across {len(REQUIRED)} databases)')
    return 0

if __name__ == '__main__':
    sys.exit(main())
