import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "worker.js"), "utf8");
const start = source.indexOf("async function tool_search_memories(args, env) {");
const end = source.indexOf("\n__name(tool_search_memories", start);
if (start < 0 || end < 0) throw new Error("tool_search_memories function not found");

const searchMemories = new Function(
  "sanitize",
  "embed",
  `return (${source.slice(start, end)});`
)(
  (value) => String(value == null ? "" : value).trim().slice(0, 800),
  async (_env, text) => [text]
);

function responseOf(result) {
  return JSON.parse(result.content[0].text);
}

test("batches D1 enrichment and preserves Vectorize order and metadata fallback", async () => {
  const matches = [
    { id: "mem:heuristic:one", score: 0.94, metadata: { category: "heuristic", content: "fallback one" } },
    { id: "mem:project_fact:two", score: 0.89, metadata: { category: "project_fact", content: "fallback two" } },
    { id: "mem:anti_pattern:three", score: 0.85, metadata: { category: "anti_pattern", content: "fallback three" } }
  ];
  const records = [
    { id: matches[2].id, category: "anti_pattern", content: "database three", summary: "third", importance: 0.7, session_id: "s3", created_at: "2026-01-03" },
    { id: matches[0].id, category: "heuristic", content: "database one", summary: "first", importance: 0.9, session_id: "s1", created_at: "2026-01-01" }
  ];
  const queries = [];
  const env = {
    PAPER_VZ: { query: async () => ({ matches }) },
    GRAPH_DB: {
      prepare(sql) {
        const query = { sql, values: [] };
        queries.push(query);
        return {
          bind(...values) {
            query.values = values;
            return this;
          },
          async all() {
            const ids = JSON.parse(query.values[0]);
            assert.deepEqual(ids, matches.map((match) => match.id));
            return { results: records };
          }
        };
      }
    }
  };

  const result = responseOf(await searchMemories({ query: "sample", limit: 3 }, env));

  assert.equal(queries.length, 1, "three memory matches should require one D1 read");
  assert.match(queries[0].sql, /id IN \(SELECT value FROM json_each\(\?1\)\)/);
  assert.deepEqual(result.results.map((row) => row.id), matches.map((match) => match.id));
  assert.equal(result.results[0].content, "database one");
  assert.equal(result.results[1].content, "fallback two");
  assert.equal(result.results[1].summary, null);
  assert.equal(result.results[2].content, "database three");
});

test("skips D1 enrichment when Vectorize returns no memory matches", async () => {
  let queries = 0;
  const env = {
    PAPER_VZ: { query: async () => ({ matches: [{ id: "paper:one" }] }) },
    GRAPH_DB: {
      prepare() {
        queries++;
        throw new Error("unexpected D1 query");
      }
    }
  };

  const result = responseOf(await searchMemories({ query: "sample" }, env));

  assert.equal(queries, 0);
  assert.deepEqual(result, { count: 0, results: [] });
});
