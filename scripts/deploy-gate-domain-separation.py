#!/usr/bin/env python3
"""
DOMAIN-PLANE-1 enforcement gate: personal workers (q08.org) must not contain fleet code,
fleet workers (qnfo.org) must not contain personal code.

Owner directive 2026-10-19: personal=q08.org, fleet=qnfo.org, quantum=qwav.org

Usage: python3 scripts/deploy-gate-domain-separation.py [--files changed-files.txt]
Exit: 0 if all checks pass, 1 if domain violations found
"""
import re
import sys
from pathlib import Path

# Personal workers serve q08.org hosts
PERSONAL_WORKERS = {
    'personal-api',
    'personal-companion',
    'personal-embed',
    'personal-replies'
}

# Fleet workers serve qnfo.org hosts  
FLEET_WORKERS = {
    'qnfo-ai',
    'qnfo-ai-search',
    'qnfo-fleet-control',
    'qnfo-fleet-dashboard',
    'qnfo-ops',
    'qnfo-research-exec',
    'qnfo-social',
    'qnfo-lifecycle',
    'qnfo-outreach',
    'qnfo-github-steward'
}

# Fleet code patterns that should not appear in personal workers
FLEET_PATTERNS = [
    r'\bfleet(?:Control|Dashboard|Asks|Metrics|Config)\b',
    r'\bqnfo[-_](?:ai|research|social|ops|lifecycle)',
    r'fleet\.qnfo\.org',
    r'/api/fleet/',
    r'program_.*registry',
    r'roadmap_.*',
    r'v_.*_portfolio',
    r'FOR\s+THE\s+QUNIVERSE',  # Fleet-facing content
]

# Personal code patterns that should not appear in fleet workers
PERSONAL_PATTERNS = [
    r'\bme\.q08\.org',
    r'\bpersonal[-_](?:api|companion|embed)',
    r'/api/personal/',
    r'owner_docs',  # Personal identity store
    r'IDENTITY[-_]WEEKLY',
]

def check_personal_no_fleet(file_path: Path) -> list[str]:
    """Check that personal worker has no fleet code references."""
    # Extract worker name from path (e.g., "personal-api/worker.js" -> "personal-api")
    parts = Path(str(file_path)).parts
    worker_name = parts[0] if len(parts) > 0 else None
    
    if worker_name not in PERSONAL_WORKERS:
        return []
    
    if not file_path.exists():
        return []
    
    violations = []
    try:
        content = file_path.read_text(encoding='utf-8', errors='replace')
        
        for pattern in FLEET_PATTERNS:
            matches = re.finditer(pattern, content, re.IGNORECASE | re.MULTILINE)
            for match in matches:
                line_num = content[:match.start()].count('\n') + 1
                violations.append(
                    f"{file_path}:{line_num}: Personal worker contains fleet reference: {match.group()}"
                )
    
    except Exception as e:
        print(f"Warning: Could not read {file_path}: {e}", file=sys.stderr)
    
    return violations

def check_fleet_no_personal(file_path: Path) -> list[str]:
    """Check that fleet worker has no personal code references."""
    # Extract worker name from path (e.g., "qnfo-ai/worker.js" -> "qnfo-ai")
    parts = Path(str(file_path)).parts
    worker_name = parts[0] if len(parts) > 0 else None
    
    if worker_name not in FLEET_WORKERS:
        return []
    
    if not file_path.exists():
        return []
    
    violations = []
    try:
        content = file_path.read_text(encoding='utf-8', errors='replace')
        
        for pattern in PERSONAL_PATTERNS:
            matches = re.finditer(pattern, content, re.IGNORECASE | re.MULTILINE)
            for match in matches:
                line_num = content[:match.start()].count('\n') + 1
                violations.append(
                    f"{file_path}:{line_num}: Fleet worker contains personal reference: {match.group()}"
                )
    
    except Exception as e:
        print(f"Warning: Could not read {file_path}: {e}", file=sys.stderr)
    
    return violations

def main():
    """Check all changed files for domain separation violations."""
    repo_root = Path(__file__).parent.parent
    
    # Get list of changed files
    files_arg = None
    for i, arg in enumerate(sys.argv):
        if arg == '--files' and i + 1 < len(sys.argv):
            files_arg = sys.argv[i + 1]
            break
    
    if files_arg:
        files = Path(files_arg).read_text().strip().split('\n')
    else:
        # Check all worker.js files by default
        files = []
        for pattern in ['*/worker.js', '*/worker.mjs']:
            files.extend(str(p.relative_to(repo_root)) for p in repo_root.glob(pattern))
    
    all_violations = []
    
    for file_str in files:
        if not file_str.strip():
            continue
        
        file_path = repo_root / file_str
        
        # Check personal workers don't have fleet code
        all_violations.extend(check_personal_no_fleet(file_path))
        
        # Check fleet workers don't have personal code
        all_violations.extend(check_fleet_no_personal(file_path))
    
    if all_violations:
        print("DOMAIN-SEPARATION violations found:\n", file=sys.stderr)
        for violation in all_violations:
            print(f"  {violation}", file=sys.stderr)
        print(f"\n{len(all_violations)} violation(s) total", file=sys.stderr)
        print("\nPersonal workers (q08.org) must not contain fleet code.", file=sys.stderr)
        print("Fleet workers (qnfo.org) must not contain personal code.", file=sys.stderr)
        sys.exit(1)
    
    print(f"domain-separation: {len(files)} file(s) checked, 0 violations")
    sys.exit(0)

if __name__ == '__main__':
    main()
