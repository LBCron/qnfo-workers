# -*- coding: utf-8 -*-
"""prompt-parity-guard.py v1.3.0  (companion to prompt-store-verify.py)

Guards three defect classes prompt-store-verify.py does NOT cover:

  D1 STORE-ROT / DRIFT - an expected live parity store is missing or not byte-identical
                         to the canonical .deepchat/system-prompt-v2.7.md
  D2 FOREIGN-STORE     - a LIVE *.json store carries a "DEEPCHAT DEFAULT SYSTEM PROMPT vN"
                         marker at vN != canonical (silent-clobber hazard, e.g. a pre-SQLite
                         leftover read by an old code path)
  D3 ANCHOR-SKEW       - within a prompt surface: title version != newest-banner version
                         != LAST-footer version; or the last footer parenthetical names no
                         gate token from the newest banner row

Archives / drafts / history / sessions / .bak / .log / *.py are excluded by design
(stale is their purpose). Read-only. Exit 0 = clean, exit 1 = findings.
"""
import io, os, re, sys, glob, json, sqlite3, hashlib
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HOME = r'C:\Users\LENOVO'
CANON = os.path.join(HOME, r'.deepchat\system-prompt-v2.7.md')
QNFO = os.path.join(HOME, r'Documents\GitHub\qnfo-skills')
SK = os.path.join(HOME, r'.deepchat\skills')
findings = []

def sha(b):
    return hashlib.sha256(b).hexdigest()[:16]

SKIP_DIRS = ('\\backups\\', '\\drafts\\', '\\history\\', '-history', '\\.git\\', '\\prewrite\\', '\\sessions\\')

def skip(p):
    l = p.lower()
    if any(a.lower() in l for a in SKIP_DIRS):
        return True
    if l.endswith(('.bak', '.log', '.py', '.pyc', '.cmd')):
        return True
    return '.bak-' in l or '.stale-' in l

canon = open(CANON, 'rb').read()
CSHA = sha(canon)
mv = re.search(rb'DEFAULT SYSTEM PROMPT v(\d+\.\d+)', canon)
CVER = mv.group(1).decode() if mv else '?'

# ---------------- D1: expected live stores ----------------
for name, p in (('repo', os.path.join(QNFO, 'system-prompt-v2.7.md')),
                ('skills', os.path.join(SK, 'system-prompt-v2.7.md'))):
    if not os.path.exists(p):
        findings.append(('D1', 'expected store MISSING: %s -> %s' % (name, p)))
        continue
    b = open(p, 'rb').read()
    if b != canon:
        findings.append(('D1', 'store DRIFT: %s (%dB %s != %dB %s)' % (name, len(b), sha(b), len(canon), CSHA)))

RJ = os.path.join(HOME, r'AppData\Roaming\DeepChat\app-settings.json')
try:
    d = json.load(open(RJ, encoding='utf-8'))
    v = d.get('default_system_prompt') or d.get('defaultSystemPrompt')
    if not v:
        findings.append(('D1', 'roaming app-settings.json: no default_system_prompt'))
    elif v.encode('utf-8') != canon:
        findings.append(('D1', 'roaming app-settings.json DRIFT (%dB)' % len(v.encode('utf-8'))))
except Exception as e:
    findings.append(('D1', 'roaming app-settings.json unreadable: %s' % str(e)[:80]))

try:
    con = sqlite3.connect('file:' + os.path.join(HOME, r'AppData\Roaming\DeepChat\app_db\agent.db') + '?mode=ro', uri=True)
    raw = con.execute("SELECT value_json FROM app_settings WHERE key='systemPrompts'").fetchone()
    con.close()
    arr = json.loads(raw[0]) if raw else []
    ent = [e for e in arr if isinstance(e, dict) and e.get('id') == 'default']
    if not ent:
        findings.append(('D1', 'agent.db systemPrompts: no id=default'))
    elif ent[0].get('content', '').encode('utf-8') != canon:
        findings.append(('D1', 'agent.db systemPrompts[default] DRIFT (%dB)' % len(ent[0].get('content', '').encode('utf-8'))))
except Exception as e:
    findings.append(('D1', 'agent.db unreadable: %s' % str(e)[:80]))

# ---------------- D2: live foreign stores ----------------
MARK = re.compile(rb'DEEPCHAT DEFAULT SYSTEM PROMPT v(\d+\.\d+)')
for root in (os.path.join(HOME, '.deepchat'), os.path.join(HOME, r'AppData\Roaming\DeepChat')):
    for g in glob.glob(os.path.join(root, '**', '*.json'), recursive=True):
        try:
            if skip(g) or os.path.getsize(g) > 5_000_000:
                continue
            b = open(g, 'rb').read()
        except Exception:
            continue
        mm = MARK.search(b)
        if not mm or b == canon:
            continue
        if mm.group(1).decode() != CVER:
            findings.append(('D2', 'live foreign store: %s carries v%s (canonical v%s)'
                             % (os.path.relpath(g, HOME), mm.group(1).decode(), CVER)))

# ---------------- D3: anchor consistency ----------------
def anchors(label, path, title_re, banner_re, footer_re):
    try:
        s = open(path, encoding='utf-8', errors='replace').read()
    except Exception as e:
        findings.append(('D3', '%s unreadable: %s' % (label, e)))
        return
    t = re.search(title_re, s, re.M)
    b = re.search(banner_re, s, re.M)
    foots = re.findall(footer_re, s, re.M)
    tv = t.group(1) if t else None
    bv = b.group(1) if b else None
    fv = foots[-1] if foots else None
    if not (tv == bv == fv):
        findings.append(('D3', '%s anchor skew: title=%s banner-newest=%s footer-last=%s' % (label, tv, bv, fv)))
        return
    # last footer parenthetical must share a gate token with the newest banner block
    if b:
        parens = re.findall(r'Current: \*\*v[\d.]+\*\* \(([^)]{0,300})', s)
        if parens:
            last_paren = parens[-1]
            banner_block = s[b.start():b.start() + 900]
            bt = set(re.findall(r'[A-Z][A-Z0-9-]{5,}', banner_block))
            pt = set(re.findall(r'[A-Z][A-Z0-9-]{5,}', last_paren))
            if bt and pt and not (bt & pt):
                findings.append(('D3', '%s footer parenthetical names no gate from newest banner (has %s)'
                                 % (label, sorted(pt)[:3])))

anchors('SYSTEM-PROMPT', CANON,
        r'DEFAULT SYSTEM PROMPT v(\d+\.\d+)',
        r'system-prompt v(\d+\.\d+) / kaizen',
        r'Current: \*\*v(\d+\.\d+)\*\*')

for n in ('kaizen', 'research', 'cloudflare', 'qnfo-core', 'execution-mandate'):
    p = os.path.join(SK, n, 'SKILL.md')
    if os.path.exists(p):
        anchors(n.upper(), p,
                r'^#\s*[A-Z][A-Za-z /-]*[—-]\s*v(\d+\.\d+)',
                r'>\s*\*\*v(\d+\.\d+) UPDATE',
                r'Current: \*\*v(\d+\.\d+)\*\*')

print('PROMPT-PARITY-GUARD v1.3.0  (canonical v%s / %s / %dB)' % (CVER, CSHA, len(canon)))
if not findings:
    print('RESULT: CLEAN - live stores identical; no live foreign store; anchors consistent')
    sys.exit(0)
for c, m in findings:
    print('  [%s] %s' % (c, m))
print('RESULT: %d FINDING(S)' % len(findings))
sys.exit(1)
