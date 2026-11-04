#!/usr/bin/env python3
"""backup_agentdb_chunked.py - agent.db backup (permanent, 2026-09-02).
v1.3 (2026-09-02, user directive): RETENTION-AWARE CONTENT PRUNE. User directive:
"WHEN PRUNING AGENT.DB, KEEP CHATS PINNED AND WITHIN 1 DAY OLD. DO NOT PRUNE ALL
CHATS AS THIS MAY ERASE CURRENT WORK". The settings-backup snapshot now KEEPS
chat-thread CONTENT (messages/blocks/tape/child transcripts) for sessions that
are pinned OR active within the last 1 day, instead of deleting all content rows.
Keep-set = new_sessions.is_pinned=1 OR new_sessions.updated_at > now-1d OR
sessions with messages created in the last 1 day (timestamps are epoch ms).
v1.2 (2026-09-02): SETTINGS/MEMORY SPLIT - durable memory exported separately
(agent-memory.db artifact; agent_memory* removed from the settings snapshot).
LIVE DB never modified. Canonical: QNFO/qnfo-ops/scripts/backup_agentdb_chunked.py
(mirror .deepchat/scripts).
"""
import os, sys, json, time, hashlib, sqlite3, urllib.request, urllib.error

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCT = 'edb167b78c9fb901ea5bca3ce58ccc4b'
BUCKET = 'qnfo-backups'
ROAM = r'C:/Users/LENOVO/AppData/Roaming/DeepChat'
CHUNK = int(os.environ.get('BACKUP_CHUNK_BYTES', 90 * 1024 * 1024))  # 90 MiB < REST ~100 MB cap; env-overridable (2026-10-04: host link resets PUTs >=8 MiB -> run 4 MiB)
PREFIX = 'deepchat/' + time.strftime('%Y/%m') + '/'
STAMP = time.strftime('%Y%m%d-%H%M%S')
MEMORY_BACKUP = os.environ.get('MEMORY_BACKUP', '1') == '1'
KEEP_WINDOW_MS = 24 * 60 * 60 * 1000  # 1 day; DeepChat timestamps are epoch ms

# Content tables keyed by session_id (keep rows of kept sessions only)
SESSION_KEYED = [
    'deepchat_messages', 'deepchat_pending_inputs',
    'deepchat_search_documents', 'deepchat_message_search_results',
    'deepchat_tape_entries', 'deepchat_tape_search_projection',
    'deepchat_tape_search_projection_meta',
    'deepchat_memory_ingestion_projection',
    'deepchat_memory_ingestion_projection_meta',
]
# Content tables keyed by message_id (keep rows whose message survived)
MESSAGE_KEYED = [
    'deepchat_assistant_blocks', 'deepchat_user_messages',
    'deepchat_user_message_files', 'deepchat_user_message_links',
]
# Child-session / transient tables with epoch-ms timestamps (keep last 1 day)
TS_KEYED = [
    ('acp_sessions', 'updated_at'), ('acp_turns', 'started_at'),
    ('live_delegations', 'updated_at'), ('live_delegation_turns', 'updated_at'),
    ('live_delegation_events', 'created_at'),
]
# Durable memory tables - REMOVED from the main (settings) backup, exported separately
MEMORY_TABLES = ['agent_memory', 'agent_memory_tombstone', 'agent_memory_clear_job',
                 'agent_memory_derivation', 'agent_memory_dirty', 'agent_memory_fts_meta',
                 'agent_memory_fts', 'agent_memory_fts_data', 'agent_memory_fts_idx',
                 'agent_memory_fts_docsize', 'agent_memory_fts_config',
                 'agent_memory_audit', 'agent_memory_directive']

def upload(key, data):
    url = f'https://api.cloudflare.com/client/v4/accounts/{ACCT}/r2/buckets/{BUCKET}/objects/{key}'
    # 2026-10-04 (R2-TLS-EOF-1): on this host urllib resets any PUT >= ~2 MiB with
    # "EOF occurred in violation of protocol" (curl handles up to ~4-6 MiB). Upload via curl
    # from a tempfile; callers chunk bodies to <= CHUNK (default now 4 MiB) so each PUT stays small.
    import subprocess, tempfile
    fd, tmp = tempfile.mkstemp(prefix='r2put_', suffix='.bin')
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(data)
        r = subprocess.run(['curl', '-s', '-S', '-m', '600',
                            '--retry', '6', '--retry-all-errors', '--retry-delay', '2',
                            '--http1.1', '-X', 'PUT',
                            '-H', f'Authorization: Bearer {TOKEN}',
                            '-H', 'Content-Type: application/octet-stream',
                            '--data-binary', '@' + tmp, url], capture_output=True)
        try:
            return json.loads(r.stdout.decode('utf-8', 'replace')).get('success', False)
        except Exception:
            print('  [WARN] upload(%s) non-json rc=%s out=%r' % (key, r.returncode, r.stdout[:120]), flush=True)
            return False
    finally:
        try:
            os.remove(tmp)
        except Exception:
            pass

def snapshot(db_src, suffix):
    tmp = os.path.join(os.environ.get('TEMP', 'C:/Users/LENOVO/AppData/Local/Temp'),
                       'agent-snapshot-' + STAMP + '-' + suffix + '.db')
    try:
        os.remove(tmp)
    except Exception:
        pass
    src = sqlite3.connect(db_src, timeout=60)
    dst = sqlite3.connect(tmp)
    src.backup(dst)
    dst.close(); src.close()
    return tmp

def prune_content_retained(con):
    """Retention-aware content prune (2026-09-02 user directive): KEEP chats
    pinned and within 1 day old. Never prune-all. Returns stats dict."""
    cur = con.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
    names = {r[0] for r in cur.fetchall()}
    now_ms = int(time.time() * 1000)
    cutoff = now_ms - KEEP_WINDOW_MS
    stats = {}
    # 1. keep-set: pinned OR active within 1 day OR has recent messages
    cur.execute('CREATE TEMP TABLE IF NOT EXISTS keep_sessions (id TEXT PRIMARY KEY)')
    cur.execute('DELETE FROM keep_sessions')
    if 'new_sessions' in names:
        try:
            cur.execute('INSERT OR IGNORE INTO keep_sessions SELECT id FROM new_sessions WHERE is_pinned=1 OR updated_at > ?', (cutoff,))
        except Exception as e:
            print('  [WARN] keep new_sessions', str(e)[:100], flush=True)
    if 'deepchat_messages' in names:
        try:
            cur.execute('INSERT OR IGNORE INTO keep_sessions SELECT DISTINCT session_id FROM deepchat_messages WHERE created_at > ?', (cutoff,))
        except Exception as e:
            print('  [WARN] keep messages', str(e)[:100], flush=True)
    stats['keep_sessions'] = cur.execute('SELECT COUNT(*) FROM keep_sessions').fetchone()[0]
    # 2. session-keyed content tables
    for t in SESSION_KEYED:
        if t in names:
            try:
                cur.execute('DELETE FROM "' + t + '" WHERE session_id NOT IN (SELECT id FROM keep_sessions)')
                stats[t] = cur.rowcount
            except Exception as e:
                print('  [WARN] del', t, str(e)[:100], flush=True)
    con.commit()
    # 3. message-keyed content tables (keep messages of kept sessions)
    cur.execute('CREATE TEMP TABLE IF NOT EXISTS keep_messages (id TEXT PRIMARY KEY)')
    cur.execute('DELETE FROM keep_messages')
    if 'deepchat_messages' in names:
        cur.execute('INSERT INTO keep_messages SELECT id FROM deepchat_messages')
    stats['keep_messages'] = cur.execute('SELECT COUNT(*) FROM keep_messages').fetchone()[0]
    for t in MESSAGE_KEYED:
        if t in names:
            try:
                cur.execute('DELETE FROM "' + t + '" WHERE message_id NOT IN (SELECT id FROM keep_messages)')
                stats[t] = cur.rowcount
            except Exception as e:
                print('  [WARN] del', t, str(e)[:100], flush=True)
    con.commit()
    # 4. ts-keyed child/transient tables (1-day window; NULL timestamps kept)
    for t, ts_col in TS_KEYED:
        if t in names:
            try:
                cur.execute('DELETE FROM "' + t + '" WHERE "' + ts_col + '" IS NOT NULL AND "' + ts_col + '" <= ?', (cutoff,))
                stats[t] = cur.rowcount
            except Exception as e:
                print('  [WARN] del', t, str(e)[:100], flush=True)
    con.commit()
    # 5. FTS alignment (rebuild external-content index; filter tape FTS)
    if 'deepchat_search_documents_fts' in names:
        try:
            cur.execute("INSERT INTO deepchat_search_documents_fts(deepchat_search_documents_fts) VALUES('rebuild')")
        except Exception as e:
            print('  [WARN] fts rebuild search', str(e)[:100], flush=True)
    if 'deepchat_tape_search_fts' in names:
        try:
            cur.execute('DELETE FROM deepchat_tape_search_fts WHERE session_id NOT IN (SELECT id FROM keep_sessions)')
        except Exception as e:
            print('  [WARN] fts tape', str(e)[:100], flush=True)
    con.commit()
    return stats

def clear_memory_rows(con):
    """Wholesale-remove agent_memory* rows from the settings snapshot (memory is
    exported separately per v1.2). Preserves v1.2 behavior exactly."""
    cur = con.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
    names = {r[0] for r in cur.fetchall()}
    removed = 0
    for t in MEMORY_TABLES:
        if t in names:
            try:
                cur.execute('DELETE FROM "' + t + '"')
                removed += cur.rowcount
            except Exception as e:
                print('  [WARN] del', t, str(e)[:100], flush=True)
    if 'agent_memory_fts' in names:
        try:
            cur.execute("INSERT INTO agent_memory_fts(agent_memory_fts) VALUES('delete-all')")
        except Exception as e:
            print('  [WARN] fts memory', str(e)[:100], flush=True)
    con.commit()
    return removed

def upload_object(path, key):
    size = os.path.getsize(path)
    # 2026-10-04 (R2-TLS-EOF-1): single-shot only up to one CHUNK; larger files go multi-part so
    # every PUT stays small enough for the host link (urllib/2MiB, curl/4MiB resets).
    if size <= CHUNK:
        with open(path, 'rb') as f:
            data = f.read()
        ok = upload(key, data)
        return size, 1, ok
    parts = (size + CHUNK - 1) // CHUNK
    keybase = key + '/'
    sha = hashlib.sha256()
    n = 0
    with open(path, 'rb') as f:
        while True:
            data = f.read(CHUNK)
            if not data:
                break
            n += 1
            sha.update(data)
            ok = upload(keybase + 'part_%03d_of_%03d' % (n, parts), data)
            if not ok:
                print('ERROR uploading part %d' % n, flush=True)
                return size, n, False
    manifest = {
        'object': os.path.basename(key), 'created_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'bytes': size, 'parts': parts, 'chunk_bytes': CHUNK, 'sha256': sha.hexdigest(),
        'restore': 'cat part_*_of_%03d > %s' % (parts, os.path.basename(key))}
    ok = upload(keybase + 'manifest.json', json.dumps(manifest).encode('utf-8'))
    return size, n, ok and True

def main():
    if not TOKEN:
        print('ERROR: CLOUDFLARE_API_TOKEN missing'); return 1
    db_src = os.path.join(ROAM, 'app_db', 'agent.db')
    # DEEP-CLEANUP-2026-09-30: pre-flight free-space gate - never start a multi-GB snapshot
    # unless %TEMP%'s volume has room for it + 2GB headroom (the 2026-09-28 disk-fill:
    # leaked snapshots hit ~97% usage and broke app startup).
    try:
        import shutil as _sh
        _free = _sh.disk_usage(os.environ.get('TEMP', 'C:/Users/LENOVO/AppData/Local/Temp')).free
        _need = os.path.getsize(db_src) + (2 * 1024 * 1024 * 1024)
        if _free < _need:
            print('ERROR: insufficient free space for snapshot: free=%d need=%d' % (_free, _need))
            return 1
    except OSError as _e:
        print('  [WARN] preflight skipped: %s' % _e, flush=True)
    t1 = None
    t2 = None
    try:
        # ---- MAIN SETTINGS BACKUP (retention-aware content prune + memory removed) ----
        t1 = snapshot(db_src, 'settings')
        before = os.path.getsize(t1)
        con = sqlite3.connect(t1, timeout=60)
        con.execute('PRAGMA busy_timeout=15000')
        stats = prune_content_retained(con)
        removed_mem = clear_memory_rows(con)
        con.commit()
        try:
            con.execute('VACUUM')
            con.commit()
        except Exception as e:
            print('  [WARN] vacuum', str(e)[:100], flush=True)
        con.close()
        removed = removed_mem + sum(v for k, v in stats.items() if k not in ('keep_sessions', 'keep_messages'))
        size = os.path.getsize(t1)
        print('prune settings: keep_sessions=%d keep_messages=%d, removed %d rows, %d -> %d bytes (%.1f%% saved)' % (
            stats.get('keep_sessions', 0), stats.get('keep_messages', 0),
            removed, before, size, (100.0 * (before - size) / before) if before else 0), flush=True)
        sbytes, sparts, sok = upload_object(t1, PREFIX + STAMP + '/agent.db')
        print('agent.db settings backup: ' + ('OK' if sok else 'FAIL') + ' (%d parts, %d bytes)' % (sparts, sbytes), flush=True)
        # BACKUP-DISK-LEAK-1 (2026-09-25): t1 cleanup moved to the finally: below so an
        # exception in the upload path cannot leak the multi-GB settings snapshot.
        # ---- MEMORY BACKUP (separate artifact; agent_memory* only) ----
        if MEMORY_BACKUP:
            t2 = snapshot(db_src, 'memory')
            con = sqlite3.connect(t2, timeout=60); cur = con.cursor()
            cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
            drop = []
            for (name,) in cur.fetchall():
                if not name.startswith('agent_memory') and name != 'sqlite_sequence':
                    drop.append(name)
            # drop non-memory content tables (FTS shadows drop with their virtual table? keep FTS shadows of memory by prefix)
            keep_prefix = ('agent_memory',)
            drop = [n for n in drop if not n.startswith(keep_prefix)]
            for n in drop:
                try: cur.execute('DROP TABLE IF EXISTS "' + n + '"')
                except Exception as e:
                    print('  [WARN] drop', n, str(e)[:80], flush=True)
            con.commit()
            try:
                cur.execute('VACUUM')
                con.commit()
            except Exception as e:
                print('  [WARN] memory vacuum', str(e)[:100], flush=True)
            con.close()
            mbytes = os.path.getsize(t2)
            mparts, mok = (1, True) if mbytes <= 95 * 1024 * 1024 else (0, False)
            mbytes2, mparts2, mok = upload_object(t2, PREFIX + STAMP + '/agent-memory.db')
            print('agent-memory.db backup: ' + ('OK' if mok else 'FAIL') + ' (%d parts, %d bytes)' % (mparts2, mbytes2), flush=True)
            # BACKUP-DISK-LEAK-1 (2026-09-25): t2 cleanup moved to the finally: below.
        return 0 if (sok and (mok or not MEMORY_BACKUP)) else 1
    except Exception as e:
        print('ERROR:', type(e).__name__, str(e)[:300]); return 1
    finally:
        # BACKUP-DISK-LEAK-1 (2026-09-25): the t1/t2 snapshots total several GB each. Their
        # os.remove() calls used to live INSIDE the try:, so any exception between snapshot()
        # and the remove (upload failure, VACUUM error, OOM) leaked the file into %TEMP% and
        # helped fill C: to 97%% - which then caused the very 'database or disk is full' error
        # this run reports. finally: guarantees cleanup on every path.
        for _p in (t1, t2):
            if _p and os.path.exists(_p):
                try: os.remove(_p)
                except Exception: pass

if __name__ == '__main__':
    sys.exit(main())
