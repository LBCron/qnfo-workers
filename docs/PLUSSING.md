# Plussing: every product gets better without being asked (PLUSSING-1)

Charter pillars: `autonomy` (the loop), `reach` and `research` (the products it improves). Owner prompt 2026-10-29: "how do we keep
plussing that automatically to keep improving it without having the user continually prompt to do it ... That should be a philosophy
throughout the fleet."

## The idea

Plussing is Pixar's review rule: you never answer an idea with "no, but". You accept what exists and add to it ("yes, and"), so
a critique always arrives as a better version, never as a verdict. For the fleet it means one thing: **a shipped product is never
finished, and the next small addition is chosen by the fleet from evidence, not requested by the owner.**

## Why the current system does not do it

Evidence read 2026-10-29 (`GET fleet.qnfo.org/api/managers`):

- The managers are organised by **program** (OPS, INFRA, REACH, RSCH, PERSONAL) and allocate focus by **risk**. QNFO.OPS holds 13 of
  the focus slots because it is the constraint. A healthy product sits in a program with no breach, so it gets no attention: repair-weighted
  allocation starves exactly the products that work.
- Roadmap origination (ROADMAP-ORIGINATE-1) is per program and capped (4 a day); the last 7 days show 8 items deployed, 1 in build, 0 proposed.
- There is no **product** record. `me.q08.org` (the Today tab, shipped 2026-10-29 in two PRs) has no owner other than a session, no usage
  signal, no "last improved" date, and nothing that proposes the next change. Its remaining gap (the owner's two calendar links) sits in
  a memory note, not in a queue.

So after a session ships a product, improvement depends on the owner coming back to ask. That is the thing to remove.

## Programs and products are different axes

| | Program | Product |
|---|---|---|
| Unit | an objective with a charter metric | something a person uses (me.q08.org, ask.qwav.org, the Shorts channel) |
| Allocation | by risk: the worst gets the slots | by **plus budget**: every product gets one, whatever its program's colour |
| Question | what is broken? | what would make this better for the person using it? |

Programs stay as they are. Products get their own register and a fixed, small share of manager capacity.

## The plus loop

Per product, one cycle, run by the program manager that owns it (no new worker; it is a step in the manager tick):

1. **Pick.** The product with the oldest `last_plus_at`, weighted by usage and by open friction. At most one plus in flight per product,
   a daily cap across the fleet (starts at 3, taken from the manager origination cap so it adds no spend).
2. **Gather evidence, no owner input.** Usage by section (what is never opened), empty and error states, failing probes, slow routes, reader
   or voter feedback, the owner's earlier asks and "still owed" notes, and what a comparable best-in-class product does that this one does not.
3. **Say yes, and.** Write one plus: the smallest reversible addition that builds on what is already there, never a removal and never a
   rewrite. It states its prediction (metric, direction, size) before the change.
4. **Ship through the existing path.** `ROADMAP-1: <program> #<n>: <title>` with `code-task:` and `code-anchor:` lines, so the code loop opens the
   PR, the merge runner merges on green and canary reverts on failure. Nothing new to trust.
5. **Verify live and keep or revert.** PLUSSING-4 captures the registered outcome and output-quality guard at verified deployment,
   then re-reads both after seven days. A plus is kept only after a material improvement with no guard regression; otherwise the manager
   requests a revert of that addition through the existing roadmap/code path. Missing or stale measures are unmeasured, never a pass.
6. **Plus the plus.** A kept plus seeds the next one for the same product (what did the first one make possible?). A plus that did not
   move its metric is reverted and replaced by a different angle.

State spans the product catalog (`products.slug`), `product_registry` (program cadence, usage and quality signals, `last_plus_at`)
and `plus_ledger` (one row per plus: evidence, prediction, issue, PR, outcome). Each active `product_registry.product` maps to one
catalog slug; `v_product_plus_due` lists products in the order step 1 picks them.

`PLUS-SUBSTRATE-RECONCILE-1` adds the catalog entries for jobs, travel and the Shorts channel using the live serving-worker graph,
and keeps `q08-home` as the canonical slug for the q08.org product. The graph maps jobs.q08.org to `qnfo-jobsearch`, travel.q08.org
to `personal-companion`, and q08.org to `q08-signal-engine`. The Shorts worker is live and publishes to YouTube; its catalog surface
uses the existing product registry host `youtube` because the graph has no public route for that external channel.

## Rules that keep it from turning into noise

- **Ratchet.** A product's quality signal and its guards must not fall across a plus. A fall reverts it and extends that product's rest.
- **Diminishing returns.** Three plusses in a row that did not move their metric put the product to rest for 7 days; the manager then
  reviews it for a fresh angle (a different user, a different surface) instead of adding a fourth in the same place.
- **Adds, and occasionally subtracts.** Every fifth cycle for a product is a simplify pass, because plussing alone grows complexity.
- **Quiet owner channel.** The owner gets a weekly "what got better" digest from `plus_ledger`, not a card per change. A plus never
  becomes an owner question; an owner-only step (a link, a key) is an IDENTITY-BOUND card with a closing probe, filed once.
- **Limits unchanged.** The interrupt gate, secret lock, work claims, outreach consent and the personal/research separation hold.
  A PERSONAL product is plussed only by PERSONAL and never reads research stores.

## Failure modes (stated, not hoped away)

1. **Goodhart.** The loop optimises the usage metric and ships clutter. Counter: the quality signal is a separate outcome measure, labelled so
   in `output_quality_measures`; a plus is judged on both.
2. **Feature creep.** Small additions compound into a heavy product. Counter: the simplify pass and the ratchet.
3. **Starvation under RED.** While the portfolio is RED the plus budget is the first thing dropped. Counter: it is a fixed share, not a
   leftover; reducing it needs a `control_registry` row with an expiry.
4. **No usage data.** A new product has no signal and the loop guesses. Counter: a product with no usage signal gets a **measurement plus** first.

## Roadmap (`roadmap_implementation` source `plussing-2026`)

| Item | What |
|---|---|
| PLUS-1 | `product_registry`, `plus_ledger`, `v_product_plus_due` and the seeded products (this change) |
| PLUS-2 | **Built** (`migrations/2026-11-05-plus-2-5-usage-digest.sql`): step `pl-usage` of the hourly `management-personas-plus` task copies the newest per-script request snapshot (`worker_usage_daily`, from Cloudflare analytics) into `product_registry.usage_value / usage_window / usage_errors / usage_read_at / usage_source`; a stale or missing snapshot is NULL (unmeasured, never 0). The number is Worker requests, cron and service-binding calls included, not people. `shorts-channel` takes `youtube_videos.views` once a view read lands. Detector `fm-product-usage-unmeasured` |
| PLUS-3 | Plus step in the manager tick: pick, gather, write the `ROADMAP-1` issue with prediction, record in the ledger |
| PLUS-4 | **Built** (`migrations/2026-11-01-plussing-4.sql`): capture baseline at verified deployment; after seven days, keep on a material outcome gain with no guard regression or request a bounded revert; register `plus_shipped_7d` and `plus_kept_share_30d` triggers |
| PLUS-5 | **Built**: table `plus_digest` (a row each Monday from step `pl-digest`, one at apply; an empty week says so) and the fleet page `fleet.qnfo.org/plus` with `GET /api/plus` (fleet-plus/v1): the newest digest, per product last plus, in flight, kept, reverted and usage, and the last 7 days of the ledger. Detector `fm-plus-digest-stale`. No e-mail is sent from SQL: the owner reads the page |
| PLUS-6 | Plus-the-plus and rest rules (three misses rest 7 days, simplify every fifth) |

First product to run it end to end: `me.q08.org`, because the owner's last request there is the clearest example of a gap that should have
been found without being asked. Success: within 14 days it has at least two kept plusses that no session was prompted to build.
