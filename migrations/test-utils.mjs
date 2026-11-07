/**
 * Production database schemas for migration testing.
 * 
 * CRITICAL: These schemas MUST match production exactly. They are extracted from
 * migrations/ab-length-retry.test.mjs which contains the canonical CREATE TABLE
 * statements that production uses.
 * 
 * Purpose: Migration tests import these schemas instead of defining schemas from
 * memory/assumptions, preventing column name mismatches that pass tests but fail
 * in production (evidence: PRs #8506, #8537, #8566, #8571, #8560).
 * 
 * Maintenance: When production schema changes via migration, update here too.
 * Source of truth: migrations/ab-length-retry.test.mjs lines 90-115
 */

/**
 * Production schemas extracted from ab-length-retry.test.mjs
 * Use these for migration tests to ensure column references match production.
 */
export const PRODUCTION_SCHEMAS = {
  
  agent_issues: `CREATE TABLE agent_issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    description TEXT,
    source TEXT,
    category TEXT,
    priority TEXT,
    status TEXT,
    created_at INTEGER,
    updated_at INTEGER
  )`,

  remediation_contracts: `CREATE TABLE remediation_contracts (
    class TEXT PRIMARY KEY,
    issue_id INTEGER,
    precondition TEXT NOT NULL,
    action TEXT NOT NULL,
    verify_probe TEXT NOT NULL,
    verify_transport TEXT NOT NULL,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    escalate_to TEXT NOT NULL,
    expected_cadence_h INTEGER,
    status TEXT DEFAULT 'active',
    ts TEXT DEFAULT (datetime('now')),
    last_attempt_at TEXT,
    last_verdict TEXT,
    module TEXT,
    budget_ms INTEGER DEFAULT 45000,
    next_due_at TEXT,
    max_items INTEGER DEFAULT 5,
    requires_container INTEGER DEFAULT 0,
    attempts INTEGER DEFAULT 0,
    deferred_since TEXT
  )`,

  failure_modes: `CREATE TABLE failure_modes (
    fm_key TEXT PRIMARY KEY,
    failure_mode TEXT NOT NULL,
    root_cause TEXT NOT NULL,
    remediation TEXT NOT NULL,
    detector TEXT NOT NULL,
    probe_class TEXT,
    first_seen TEXT NOT NULL,
    issue_id INTEGER,
    trigger_condition TEXT,
    symptom TEXT,
    blast_radius TEXT
  )`,

  metric_registry: `CREATE TABLE metric_registry (
    metric TEXT PRIMARY KEY,
    last_value TEXT
  )`,

  decision_log: `CREATE TABLE decision_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    actor TEXT NOT NULL,
    assumption TEXT NOT NULL,
    action TEXT NOT NULL,
    evidence TEXT NOT NULL,
    outcome TEXT NOT NULL,
    blast_radius TEXT NOT NULL,
    rollback_path TEXT NOT NULL,
    capability_gain TEXT,
    predicted_outcome TEXT,
    reach_gain TEXT,
    surfaces_tested TEXT,
    outcome_matched INTEGER
  )`,

  cf_model_eval_config: `CREATE TABLE cf_model_eval_config (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  )`,

  ai_call_counters: `CREATE TABLE ai_call_counters (
    day TEXT,
    worker TEXT,
    purpose TEXT,
    model TEXT,
    calls INTEGER DEFAULT 0,
    errors INTEGER DEFAULT 0,
    PRIMARY KEY (day, worker, purpose, model)
  )`
};

/**
 * Validates that a migration's column references exist in the production schema.
 * 
 * @param {string} migrationSql - The migration SQL to validate
 * @param {string} tableName - The table name being modified (e.g., 'remediation_contracts')
 * @returns {{ valid: boolean, errors: string[] }}
 * 
 * Example:
 *   const result = validateColumnReferences(
 *     "INSERT INTO remediation_contracts (class, hit_action) VALUES ('test', 'x')",
 *     'remediation_contracts'
 *   );
 *   if (!result.valid) {
 *     console.error('Schema errors:', result.errors);
 *   }
 */
export function validateColumnReferences(migrationSql, tableName) {
  const schema = PRODUCTION_SCHEMAS[tableName];
  if (!schema) {
    return {
      valid: false,
      errors: [`Unknown table: ${tableName}. Add it to PRODUCTION_SCHEMAS.`]
    };
  }

  // Extract column names from CREATE TABLE statement
  const createMatch = schema.match(/CREATE TABLE \w+\s*\(([\s\S]+)\)/);
  if (!createMatch) {
    return {
      valid: false,
      errors: [`Could not parse schema for table: ${tableName}`]
    };
  }

  const columnDefs = createMatch[1]
    .split(',')
    .map(def => def.trim())
    .filter(def => !def.toUpperCase().startsWith('PRIMARY KEY'))
    .filter(def => !def.toUpperCase().startsWith('FOREIGN KEY'))
    .filter(def => !def.toUpperCase().startsWith('UNIQUE'))
    .filter(def => !def.toUpperCase().startsWith('CHECK'));

  const productionColumns = new Set(
    columnDefs.map(def => {
      const match = def.match(/^(\w+)/);
      return match ? match[1] : null;
    }).filter(Boolean)
  );

  // Find column references in the migration SQL
  const errors = [];
  
  // Check INSERT statements for this specific table
  const insertPattern = new RegExp(`INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+${tableName}\\s*\\(([^)]+)\\)`, 'gi');
  const insertMatches = migrationSql.matchAll(insertPattern);
  for (const match of insertMatches) {
    const columns = match[1].split(',').map(c => c.trim());
    for (const col of columns) {
      if (!productionColumns.has(col)) {
        errors.push(`Column '${col}' does not exist in table ${tableName}`);
      }
    }
  }

  // Check UPDATE statements for this specific table
  const updatePattern = new RegExp(`UPDATE\\s+${tableName}\\s+SET\\s+(.+?)(?:WHERE|$)`, 'gis');
  const updateMatches = migrationSql.matchAll(updatePattern);
  for (const match of updateMatches) {
    const setClause = match[1].trim().replace(/;$/, ''); // Remove trailing semicolon
    const assignments = setClause.split(',');
    for (const assignment of assignments) {
      const colMatch = assignment.match(/^\s*(\w+)\s*=/);
      if (colMatch && !productionColumns.has(colMatch[1])) {
        errors.push(`Column '${colMatch[1]}' does not exist in table ${tableName}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Sets up a test database with production schemas.
 * 
 * @param {Database} db - SQLite database instance
 * @param {string[]} tables - Array of table names to create (from PRODUCTION_SCHEMAS keys)
 * 
 * Example:
 *   import Database from 'better-sqlite3';
 *   const db = new Database(':memory:');
 *   setupTestDatabase(db, ['remediation_contracts', 'failure_modes']);
 */
export function setupTestDatabase(db, tables) {
  for (const tableName of tables) {
    const schema = PRODUCTION_SCHEMAS[tableName];
    if (!schema) {
      throw new Error(`Unknown table: ${tableName}. Add it to PRODUCTION_SCHEMAS.`);
    }
    db.exec(schema);
  }
}

/**
 * Extract BACKUP header value from migration file lines.
 * 
 * @param {string[]} lines - Migration file lines
 * @returns {string|null} - Backup table name or null if no BACKUP header
 * 
 * Example:
 *   const lines = migrationContent.split('\n');
 *   const backupTable = extractBackupHeader(lines);
 */
export function extractBackupHeader(lines) {
  const backupLine = lines.find(l => /^-- BACKUP: /.test(l));
  if (!backupLine) return null;
  const value = backupLine.replace(/^-- BACKUP: /, '').trim();
  return value === 'none' ? null : value;
}

/**
 * Check if migration has destructive statements that delete rows.
 * 
 * Per BACKUP-SCHEMA-ONLY-1: Only migrations with DELETE FROM or DROP TABLE
 * require non-empty backup tables. DROP TRIGGER/INDEX/VIEW lose no rows.
 * 
 * @param {string} sql - Migration SQL content
 * @returns {boolean} - True if migration deletes rows
 */
export function hasRowDestructiveStatements(sql) {
  // Remove comments and string literals to avoid false positives
  const cleaned = sql
    .split('\n')
    .filter(l => !l.trim().startsWith('--'))
    .join('\n')
    .replace(/'[^']*'/g, "''");  // Remove string contents
  
  return /\bDELETE\s+FROM\b/i.test(cleaned) || /\bDROP\s+TABLE\b/i.test(cleaned);
}

/**
 * Validate BACKUP table exists and is non-empty (mirrors apply_migrations.py logic).
 * 
 * This function implements the same validation as scripts/apply_migrations.py
 * backup_missing() function (lines 1230-1242):
 * 
 * 1. Check BACKUP table exists in sqlite_master
 * 2. Check SELECT COUNT(*) FROM backup_table returns > 0 (if migration deletes rows)
 * 
 * Per BACKUP-SCHEMA-ONLY-1: Empty backup tables are allowed for migrations that
 * only DROP TRIGGER/INDEX/VIEW (they lose no rows).
 * 
 * @param {Database} db - SQLite database instance
 * @param {string} backupTable - Name of backup table to validate
 * @param {boolean} hasRowDestructive - Whether migration has DELETE/DROP TABLE
 * @returns {{valid: boolean, error: string|null}}
 * 
 * Example:
 *   const result = validateBackupTable(db, 'bak_20261107_test', true);
 *   if (!result.valid) {
 *     throw new Error(result.error);
 *   }
 */
export function validateBackupTable(db, backupTable, hasRowDestructive) {
  // Check table exists
  const exists = db.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(backupTable);
  
  if (!exists || exists.n === 0) {
    return {
      valid: false,
      error: `BACKUP table ${backupTable} does not exist`
    };
  }
  
  // Check table is non-empty (only for row-destructive migrations)
  if (hasRowDestructive) {
    const count = db.prepare(`SELECT COUNT(*) AS n FROM "${backupTable}"`).get();
    
    if (!count || count.n === 0) {
      return {
        valid: false,
        error: `BACKUP table ${backupTable} is empty (checked before row-destructive statements)`
      };
    }
  }
  
  return { valid: true, error: null };
}
