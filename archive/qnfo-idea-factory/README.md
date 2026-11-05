# qnfo-idea-factory — QNFO Ideas (ideas.qnfo.org)

Public, read-only window into the QNFO research conversations, served by the
`qnfo-idea-factory` Cloudflare Worker (v2.0.0, 2026-08-31).

## Data sources (the Ideas chat fix)

The Ideas chat **pulls live from the QNFO AI worker chat log**:

| Source | Table (qnfo-audit D1) | Written by | Label |
|---|---|---|---|
| LIVE | `chat` (per-message rows, threaded by `thread_id`) | `qnfo-ai` on every `/v1/chat/completions` | LIVE |
| ARCHIVE | `chat_sessions` (`category='research'`) | DeepChat session sync via `qnfo-thread-ingest` | ARCHIVE |

Prior bug (fixed): the page read only `chat_sessions` (stale DeepChat syncs, last
research sync 2026-08-27) and never read the qnfo-ai `chat` log — so new QNFO AI
worker conversations never appeared. v2.0.0 merges both sources, newest activity
first, tagged LIVE / ARCHIVE.

## Endpoints

- `/` — minimalist 3-view UI (Conversations / Ask / Propose)
- `/api/sessions?limit=&offset=&q=` — merged thread list (live + archive)
- `/api/session/:id` — thread messages (live from `chat`, else archive)
- `/api/feed?after=` — polling feed for new/updated threads
- `/api/ask` (POST) — Ask feature; proxies `qnfo-qwav /ai/ask` + related threads
- `/api/proposals` (POST) — idea submissions → `idea_proposals` table (status 'new')
- `/api/proposals` (GET, X-Sync-Token) — authenticated idea review queue
- `/rss.xml`, `/embed`, `/health`, `/robots.txt`

## Idea submissions — where they go

POST `/api/proposals` inserts into `idea_proposals` (qnfo-audit D1):
`id, name, idea, contact, status='new', ip_hash, created_at`.
Honeypot field (`website`) silently accepts bots. Rate limit: 3/hour per IP hash.
Review: authenticated GET `/api/proposals` with `X-Sync-Token: <SYNC_TOKEN>`.

## Deploy

Script-only PUT /content preserves the D1 binding and SYNC_TOKEN secret:

```bash
curl -sS -X PUT "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/workers/scripts/qnfo-idea-factory/content" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -F 'metadata={"main_module":"worker.js"};type=application/json' \
  -F 'worker.js=@worker.js;filename=worker.js;type=application/javascript+module'
```

Do NOT use `wrangler deploy` (replaces bindings/secrets unless the D1 binding is set).
