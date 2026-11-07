#!/usr/bin/env python3
"""
MIGRATION-SCHEMA-GUARD-1: Pre-merge validation of INSERT column names.

Prevents production failures from column name mismatches before merge.

FAILURE MODE: migrations/2026-11-07-research-pipeline-drain-deferred-pool.sql
- Used 'metric_key' for metric_registry (WRONG - uses 'metric')
- Merged to main, failed in production at statement 2
- Partial state left in D1, required corrective migration

ROOT CAUSE: No pre-merge validation of column names against actual schemas.

INTEGRATION: Called by .github/workflows/pr-checks.yml with changed migration files.
When regression_gate checks the base tree with files that don't exist, guard exits 0.
"""

import re
import sys
from pathlib import Path
from typing import Dict, List, Set

# Known table schemas (extracted from successful migrations)
# Format: table_name -> set of valid column names
KNOWN_SCHEMAS: Dict[str, Set[str]] = {
    'metric_registry': {
        'metric',  # PRIMARY KEY - NOT metric_key!
        'layer', 'kind', 'formula', 'source_of_truth',
        'baseline', 'target', 'owner', 'disposition_actor',
        'refresh_cadence', 'warning_band', 'kill_band',
        'state', 'refresh_class', 'metric_name', 'query',
        'target_value', 'comparison', 'created_at', 'updated_at'
    },
    'analytics_metric_triggers': {
        'id', 'metric_key',  # Uses metric_key, not metric!
        'title', 'source_table', 'operator', 'threshold',
        'priority', 'action', 'owner', 'queue_target',
        'cooldown_hours', 'enabled', 'notes', 'created_at'
    },
    'metric_breach_cause': {
        'metric_key',  # Uses metric_key, not metric! (PRIMARY KEY)
        'cause_key', 'note'  # No created_at!
    },
    'research_queue': {
        'id', 'source', 'source_id', 'idea', 'summary',
        'score', 'decision', 'status', 'claimed_at',
        'completed_at', 'paper_slug', 'created_at',  # NOT queued_at!
        'stage', 'agent_task_id', 'attempt', 'revise_count',
        'context', 'published_at', 'doi', 'paper_url',
        'error', 'recover_count', 'terminal_rearms', 'publish_due_at'
    }
}

# Common mistakes to catch
COLUMN_MISTAKES = {
    ('metric_registry', 'metric_key'): 'metric',  # Most common error
    ('analytics_metric_triggers', 'metric'): 'metric_key',
    ('metric_breach_cause', 'metric'): 'metric_key',
    ('research_queue', 'queued_at'): 'created_at',
}


def extract_insert_columns(sql: str) -> List[tuple[str, str, List[str]]]:
    """Extract table name and columns from INSERT statements."""
    results = []
    
    # Pattern: INSERT INTO table_name (col1, col2, ...)
    pattern = r'INSERT\s+INTO\s+(\w+)\s*\(((?:[^)]|\n)+?)\)\s*VALUES'
    
    for match in re.finditer(pattern, sql, re.IGNORECASE | re.DOTALL):
        table = match.group(1)
        columns_text = match.group(2)
        
        # Extract individual column names (handle multiline)
        columns = [
            col.strip()
            for col in re.split(r',', columns_text)
            if col.strip() and not col.strip().startswith('--')
        ]
        
        results.append((table, columns_text, columns))
    
    return results


def validate_migration(filepath: Path) -> List[str]:
    """Validate migration file for schema errors."""
    errors = []
    
    try:
        content = filepath.read_text(encoding='utf-8')
    except Exception as e:
        return [f"Cannot read {filepath}: {e}"]
    
    inserts = extract_insert_columns(content)
    
    for table, columns_text, columns in inserts:
        if table not in KNOWN_SCHEMAS:
            continue  # Unknown table, skip validation
        
        valid_columns = KNOWN_SCHEMAS[table]
        
        for col in columns:
            if col not in valid_columns:
                # Check for common mistakes
                mistake_key = (table, col)
                if mistake_key in COLUMN_MISTAKES:
                    correct = COLUMN_MISTAKES[mistake_key]
                    errors.append(
                        f"{filepath.name}: INSERT INTO {table} uses '{col}' "
                        f"(WRONG - table uses '{correct}')\n"
                        f"  Context: {columns_text[:100]}..."
                    )
                else:
                    errors.append(
                        f"{filepath.name}: INSERT INTO {table} uses unknown column '{col}'\n"
                        f"  Valid columns: {', '.join(sorted(valid_columns))}"
                    )
    
    return errors


def main():
    """Validate migrations for schema errors.
    
    If arguments are provided, validates only those files.
    Otherwise validates all migrations in migrations/ directory.
    
    CI integration: pr-checks.yml passes only changed migrations via git diff.
    """
    repo_root = Path(__file__).parent.parent
    migrations_dir = repo_root / 'migrations'
    
    if not migrations_dir.exists():
        print(f"ERROR: {migrations_dir} not found", file=sys.stderr)
        return 1
    
    # Determine which files to check
    if len(sys.argv) > 1:
        # Validate specific files passed as arguments
        files_to_check = [Path(arg) for arg in sys.argv[1:]]
        print(f"Validating {len(files_to_check)} migration file(s):")
        for f in files_to_check:
            print(f"  - {f.name}")
    else:
        # Validate all .sql files
        files_to_check = sorted(migrations_dir.glob('*.sql'))
        print(f"Validating all {len(files_to_check)} migrations in {migrations_dir}")
    
    # Filter to existing files
    existing_files = [f for f in files_to_check if f.exists()]
    skipped = len(files_to_check) - len(existing_files)
    
    if skipped > 0:
        print(f"WARNING: {skipped} file(s) not found, skipping")
    
    # If specific files were requested but NONE exist, exit success
    # (This happens when regression_gate checks base for new migrations)
    if len(sys.argv) > 1 and not existing_files:
        print("No migrations to validate (files don't exist in this tree)")
        return 0
    
    all_errors = []
    for filepath in existing_files:
        errors = validate_migration(filepath)
        all_errors.extend(errors)
    
    if all_errors:
        print("=" * 80)
        print("MIGRATION SCHEMA ERRORS DETECTED")
        print("=" * 80)
        for error in all_errors:
            print(f"\n{error}")
        print("\n" + "=" * 80)
        print(f"FAILURE: {len(all_errors)} schema error(s) found")
        print("=" * 80)
        return 1
    
    print("✓ All migrations pass schema validation")
    return 0


if __name__ == '__main__':
    sys.exit(main())
