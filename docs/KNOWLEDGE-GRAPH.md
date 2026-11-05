# KG-CURATE-1: the content knowledge graph, curated by the fleet

Charter pillar: autonomy (also research and reach). Shipped 2026-11-05. Owner directive 2026-11-05: the QNFO knowledge graph needs much
denser, more connected edges and nodes from all possible sources and must be curated, pruned, updated and maintained automatically by the
fleet; research best practice, audit weaknesses and failure modes, code and deploy the enhancements, make the Quniverse more connected and
self-aware.

Two graphs live in the `qnfo-graph` D1. They are different things:

| Graph | Tables | Built by | What it answers |
|---|---|---|---|
| Fleet code and topology (FLEET-GRAPH-1, `docs/FLEET-GRAPH.md`) | `fg_node`, `fg_edge`, `fg_finding` | `scripts/fleet_graph.mjs` | what depends on a worker, binding, table, cron or route |
| Content knowledge graph (this document) | `nodes`, `edges`, `kg_*` | `scripts/kg_curate.mjs`, run by the same build | what relates to what: papers, concepts, tags, cited works, workers, databases, metrics, programs, goals, failure modes, issues, decisions, capabilities |

The curator reads the fleet graph (workers and their bindings become anchors in the content graph), so the two now meet at `worker:<name>`,
`d1:<db>`, `r2:<bucket>`, `domain:<host>` nodes.

## Where it started (measured 2026-11-05)

- 8,705 nodes and 9,423 edges: 1.08 edges per node; 60% of the edges were structural `CONTAINS` (a vault of 5,616 notes).
- 1,626 nodes (19%) had no edge; 1,192 of the 1,855 Paper nodes (64%) were isolated; 159 duplicate-name groups (a plain count over all labels);
  75 nodes labelled `*_DEPRECATED`; 457 `archive-*` Paper nodes, about 250 of them placeholders (named by one URL, or "Archive record N") and the
  rest real Zenodo records with no link.
- No edge said where it came from, how sure it was, or when it was last true. Only research-exec and the gateway wrote to the graph, and
  nothing ever revised or removed an edge.
- Untapped in living-paper: 1,855 `paper_tag` rows, 745 categories, 1,913 citations (720 internal, 1,193 arXiv). None were edges.
- A defect found while building it: the shared Vectorize index `qwav-research-v2` returns twenty different papers at one identical score
  (0.89843285) for a query, because chunk 0 of each paper is its YAML front matter (license, email, ORCID lines) or the stub text "QNFO Research
  Paper / Full text and metadata at ...". Similarity edges read from that index would be a hairball, and ask/search retrieval is poisoned by the
  same chunks. The curator therefore does not use the index (issue `KG-VECTORIZE-STUB-1` owns the fix in `qnfo-paper-indexer`).
- `paper_clusters.cluster_rep` is garbage ("Chapter 1" has 152 members, a JSON fragment has 127), so it is not ingested.

## The model

Every row the curator owns carries provenance. The columns are nullable and additive; the writers that existed before (research-exec, the
gateway) are untouched, and an edge with `source IS NULL` is a legacy, authored edge the curator reads but never changes.

| Column | Meaning |
|---|---|
| `edges.source` | the derivation: `kg:lp-tag`, `kg:lp-cat`, `kg:lp-cite`, `kg:artifact`, `kg:fleet`, `kg:audit-*`, `kg:mention`, `kg:concept`, `kg:bib-coupling`, `kg:semantic`, `kg:er` |
| `edges.confidence` | 1 for a fact read from a table or config, 0.7-0.9 for a name match, the cosine for a similarity edge |
| `edges.weight` | strength (IDF-weighted cosine for coupling, cosine for similarity) |
| `edges.evidence` | compact JSON: the alias that matched, the cosine, the cutoff, the rank, `rescue: true` |
| `edges.status`, `invalidated_at` | `NULL`/`active`, or `stale` with the time it was last not derived |
| `edges.last_seen` | the last run that created or changed it (an unchanged row is not rewritten) |
| `nodes.status` | `NULL` (active), `quarantined`, `duplicate`, `retracted`, `superseded`, `draft`, `ghost`, `archived`, `deprecated`, `stale`, `closed` |
| `nodes.source`, `h` | the owning derivation and a content hash (a changed node is rewritten, an unchanged one is not) |
| `nodes.canonical_id` | for a duplicate, the node it is the same as (a link, never a merge) |

Tables: `kg_state` (cursors, the cutoff adjustment, the lease), `kg_health` (one row per run, 90 days), `kg_node_stats` (degree, PageRank,
component, community), `kg_gap` (open gaps), `kg_embed` (int8-quantised embeddings of changed papers), `kg_tombstone` (every deleted row, whole).

## What each run does

Run by `.github/workflows/kg-curate.yml` (KG-CURATE-2): on every push to main, on the `fleet-graph-tick` dispatch qnfo-cloud-ops sends when main has
been quiet 60 minutes, and by hand (`workflow_dispatch`, `force`). It is a workflow of its own because `fleet-graph.yml` cancels its run on every newer
push, and 34 of that workflow's last 40 runs on 2026-11-05 were cancelled (median 31 s) before a curation of several minutes could finish; this one's
concurrency group never cancels a running curation. A run is skipped, after reading three rows, when the last good one is under 25 minutes old; a
6-minute lease renewed per phase stops two runs overlapping; a run past its 8-minute budget defers the remaining phases to the next one (each phase
is idempotent, and a deferred run does not count as good for the throttle). `node scripts/kg_curate.mjs [--dry-run] [--force]` runs it from any machine
with the token, and `node scripts/fleet_graph.mjs --scope kg` runs the same code.

| Phase | What it adds or does | Edge kind |
|---|---|---|
| lifecycle | Paper status follows living-paper (quarantined, duplicate, retracted ...); a `paper:<slug>` node living-paper does not know and no authored edge touches becomes `ghost`; nodes whose own properties say ARCHIVED or DEPRECATED leave the active counts | status only |
| living | tags, categories (secondary at half weight), internal citations, external works (`work:arxiv:<id>`) | fact, confidence 1 |
| artifacts | R2Object linked to its paper by `r2_key`, then by identifier | fact |
| fleet | Worker, Database, Bucket, VectorIndex, Queue, KVNamespace, Workflow, DurableObject, Domain nodes; `BINDS`, `CALLS` (function-level `http_calls` lifted to the worker), `SERVES`, `CONSUMES`, `PRODUCES` | fact / observed |
| audit | Metric, Program, Goal, FailureMode, open Issue, Decision (newest 300), Capability, linked to the workers they name (`code-task: ... path=<dir>/` is fact, a name in prose is 0.7) and to the metrics they cite (`ABOUT`); an entity with nothing to link to is not created | fact / inferred |
| mentions | legacy nodes that name a worker, domain, program code or phase get `MENTIONS`; an alias matching more than 60 nodes (a domain) or 400 (a program) is dropped as a hub | inferred 0.7 |
| concepts | papers whose title or abstract names a Concept, Program or Person | inferred 0.8 |
| coupling | bibliographic coupling: IDF-weighted shared references, at least two shared (or one rare one), top 6 per paper | derived |
| semantic | embeds cleaned title + abstract (`@cf/baai/bge-base-en-v1.5`, about USD 0.03 for the first full pass, then changed papers only), compares all pairs in memory, keeps mutual-kNN pairs above a cutoff, degree cap 12, `NEAR_DUPLICATE` above 0.985, and a rescue link (best neighbour above the floor) for a paper left with no edge | derived |
| prune | self-loops, dangling edges, stale edges after 14 days, placeholder archive-record nodes, ghost papers after 30 days with no link, deprecated orphans after 30 days, source nodes left without edges | delete, tombstoned |
| entities | duplicate-name groups (same label family, same normalised name, 10 members at most, never Notes) get `SAME_AS` and `canonical_id` | inferred |
| analytics | components, PageRank, communities, bridges, link candidates, the health row | none |
| publish | `kg_health` row, six metrics and `fleet_heartbeat('kg-curate')` in qnfo-audit, a node-link snapshot to R2 `qnfo-backups/kg/latest.json.gz` every 6 hours | none |

Each phase is isolated: one that throws is reported and the rest still run. A write cap (60,000 rows) stops a runaway run with a named reason.

## The guards (each exists because the research or the shadow run showed the failure)

| Failure mode | Guard |
|---|---|
| Hairball from similarity (kNN hubs) | mutual-kNN or top-2 rank, degree cap 12, floor and cutoff, hub aliases dropped, tag and category hubs shown but never expanded in a view |
| Identical vectors read as "similar" | four or more neighbours at one identical score mean identical text: skipped and counted (`degenerateGroups`) |
| A cosine cutoff that means nothing for this model | the cutoff is the 99.9th percentile of a null (cosines between papers of different primary categories), clamped to 0.70-0.92, then tuned by +-0.01 per run, +-0.05 at most, by category agreement |
| Inferred edges feeding inference | phases read tables and legacy nodes only; analytics alone reads derived edges |
| Stale edges | each source is reconciled as a set: add, update, mark `stale`, delete after 14 days |
| A truncated read sweeping the graph away | a pass that derives under 80% of the previous set does not sweep (three runs in a row accept a lasting shrink); one run marks at most 10% of a source stale; a partial embedding pass does not sweep |
| Runaway deletes | every delete copies the whole row into `kg_tombstone` first; at most 800 per run; legacy edges are never modified |
| The curator making orphans | audit entities become nodes only when they link to something |
| A monorepo name linking everything | `qnfo-workers` is never a worker mention |
| Duplicate over-merge | `SAME_AS` and `canonical_id` only; groups above 10 members (a shared placeholder name) are skipped |
| A short living-paper read ghosting the corpus | ghosting needs at least 500 papers read; a ghost waits 30 days from the day it was marked |
| A node deleted while another writer links it | the delete runs only while no edge of any kind touches the node, checked by the database in the same statement |
| A returning issue, worker or goal staying closed | a node whose status differs from the source is rewritten, and a source that returns nothing still closes its nodes |
| Two runs at once | a 6-minute lease in `kg_state` renewed per phase, and a 25-minute minimum between good runs |

To restore a deleted row: `SELECT row FROM kg_tombstone WHERE kind = 'node' AND key = '<id>'` holds the whole row as JSON.

## Reading it

Open, read-only, no key (OPEN-ACCESS-1) on `https://qnfo-memory-mcp.q08.workers.dev`, and the same as MCP tools `kg_*`. The open routes never serve the
owner's notes, people or vault (labels `Note`, `Person`, `Vault`): those come only through the authenticated MCP tools. A walk runs at most 40 D1 queries
and says `truncated` when a budget cut it short, so "no path" is never reported as proof when the search was cut off.

| Question | Query |
|---|---|
| Is it healthy, and is it getting better? | `GET /kg/health` (orphan share, density, giant component, papers with no content relation, duplicates, by source and relationship, age, a 48-run trend) |
| Everything about one node | `GET /kg/node?id=paper:<slug>` (edges both ways with weight, confidence and origin, PageRank, community) |
| What surrounds it | `GET /kg/neighbors?id=<id>&depth=2` (structural edges and tag hubs hidden by default); `GET /kg/view?id=<id>` draws it |
| How are A and B connected | `GET /kg/path?from=<a>&to=<b>` (semantic edges first) |
| What matters most | `GET /kg/central?label=Paper` (PageRank) |
| What is missing | `GET /kg/gaps` (isolated papers, bridge papers, link candidates), `GET /kg/orphans?label=<label>` |
| Which topics exist | `GET /kg/communities` |

## Measures

`kg_orphan_share`, `kg_giant_component_share`, `kg_paper_unrelated_share`, `kg_edge_density`, `kg_duplicate_groups_unresolved` (targets) and
`kg_sim_category_agreement` (a guard: a proxy for edge precision, never a target) are written by every run and judged by
`v_metric_trigger_state` like any other (migrations/2026-11-05-kg-curate.sql). The Note vault (5,616 notes: path, year and size only; the bodies
live on the owner's local drive) is a labelled island; the giant-component measure excludes it and `notes_bridged` reports it.

## First measurement (shadow run, 2026-11-05)

A copy of the live data run through every phase with real embeddings (16 s):

| | before | after one pass |
|---|---|---|
| nodes | 8,705 | 10,953 |
| edges | 9,423 | 17,281 |
| orphan share | 19.2% | 6.6% |
| non-Note giant component | not measured | 83.7% |
| papers with no content relation | not measured (64% had no edge at all) | 43.8% (the shadow run embedded 600 of 855; the first real run embeds all) |
| duplicate groups linked | 0 (159 by a plain count) | 125 of 125 under the curator's stricter definition (no Notes, no generic names) |

The number to watch is not the edge count. A similarity edge is a lead (confidence = cosine), `kg_sim_category_agreement` was 69.7%, and
precision is not measured yet: `ROADMAP-1: QNFO.RSCH kg-precision-audit-1` adds a weekly audit of 50 sampled edges by a model of a different family.

## Research behind the choices

- Quality dimensions and cheap SQL metrics: Zaveri et al., *Quality assessment for Linked Data: a survey*; Hogan et al., *Knowledge Graphs* (ACM
  Computing Surveys). No source gives a target for orphan share or giant-component share; the targets here are judgement, set by the first
  measurement and revisited by the metric loop.
- Similarity edges: hubness in high dimensions (Radovanovic et al., JMLR 2010); mutual kNN with a connecting link (Ozaki et al., CoNLL 2011);
  cutoffs do not transfer between embedding models, so the cutoff is calibrated against a null.
- Deterministic edges beat guessed ones: bibliographic coupling is as good as text similarity for relatedness (Waltman et al. 2019).
- Provenance and expiry: PROV-O terms (`wasDerivedFrom`, `generatedAtTime`, `invalidatedAtTime`) with a confidence column added; a set
  reconcile (mark-and-sweep) with a grace period instead of a write-only pile.
- Entity resolution: block on normalised name within a label, link before you merge, bound the group size (Papadakis et al. survey).
- Communities: label propagation split into connected parts, because modularity-greedy methods can return disconnected communities (Traag et al.
  2019 on Louvain). Leiden is the follow-up.

## Limits

- Static, name-based links are inferred and labelled; an alias that is common words would link wrongly, which the hub guard and the 0.7 confidence
  contain but do not remove.
- The semantic phase embeds up to 1,000 papers per run; the first run finishes the corpus.
- Communities come from paper-to-paper edges only; the content graph has no community notion for workers or issues yet.
- Precision of inferred edges is a proxy until the weekly audit exists.
- 271 archive-record Paper nodes with real titles and 105 R2Object nodes of papers that are no longer live stay unlinked; they are reported in
  `orphans_by_label`, not hidden.

## Follow-ups (each filed with a doer)

`KG-VECTORIZE-STUB-1` (fix the indexer's chunk 0), `ROADMAP-1: QNFO.REACH kg-related-papers-1` (related papers on every paper page),
`ROADMAP-1: QNFO.RSCH kg-research-gaps-1` (gaps feed the research queue), `kg-precision-audit-1`, `kg-archive-records-1`, and
`KG-NOTES-VAULT-1` (IDENTITY-BOUND: the vault bodies are on the owner's machine).
