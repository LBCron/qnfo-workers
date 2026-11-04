/**
 * @qnfo/validate (TypeScript mirror) - v0.1
 * PRECONDITION: schemas/ directory sibling; envelope checks are dependency-free.
 * POSTCONDITION: returns { ok: boolean, errors: string[] }; no network, no randomness.
 * NOTE: payload (kind-specific) validation requires ajv (add package.json dep in P1);
 *       the Python mirror validate.py is the functional validator today.
 */

export interface Envelope {
  schema_version: string;
  kind: string;
  id: string;
  ts: string;
  provenance: { emitter: string; session: string; sha256: string };
  payload?: Record<string, unknown>;
}

const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const KIND_RE = /^[a-z0-9-]+$/;

/** Envelope-only validation mirroring schemas/envelope.json (draft-07 subset). */
export function validateEnvelope(a: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof a !== "object" || a === null || Array.isArray(a)) return { ok: false, errors: ["root not an object"] };
  const e = a as Record<string, unknown>;
  if (e.schema_version !== "1.0") errors.push("schema_version must be '1.0'");
  if (typeof e.kind !== "string" || !KIND_RE.test(e.kind)) errors.push("kind must match [a-z0-9-]+");
  if (typeof e.id !== "string" || e.id.length < 2) errors.push("id must be a string >=2 chars");
  if (typeof e.ts !== "string" || !TS_RE.test(e.ts)) errors.push("ts must be ISO-8601");
  const p = e.provenance as Record<string, unknown> | undefined;
  if (typeof p !== "object" || p === null) errors.push("provenance required");
  else {
    if (typeof p.emitter !== "string") errors.push("provenance.emitter required");
    if (typeof p.session !== "string") errors.push("provenance.session required");
    if (typeof p.sha256 !== "string") errors.push("provenance.sha256 required");
  }
  return { ok: errors.length === 0, errors };
}

/** Full validation; payload schema check is a documented stub until ajv is wired (P1). */
export async function validateArtifact(a: unknown): Promise<{ ok: boolean; errors: string[] }> {
  const env = validateEnvelope(a);
  if (!env.ok) return env;
  // P1: resolve schemas/<kind>.json and validate payload with ajv.
  return { ok: true, errors: [] };
}
