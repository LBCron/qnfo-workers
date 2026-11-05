# qnfo-subscribers

Email capture + weekly research digest for qnfo.org.

- POST /subscribe {email,hp,source} -> stores in qnfo-audit.subscribers, sends a confirmation email.
- GET /confirm?token=... -> a page with one "Confirm subscription" button; only its POST sets status='subscribed'
  (1.1.7, #1904: mail link scanners fetch every link, so a GET must never confirm).
- GET or POST /unsubscribe?token=... -> flips status='unsubscribed' (the digest's List-Unsubscribe one-click POST lands here).
- Every send writes a cloud_ops_events row (kind 'subscribers-send', domain only, messageId or error); confirm page views and
  confirmations write kind 'subscribers-confirm' (1.1.7, #1905).
- POST /run/digest (Bearer SUBSCRIBERS_TOKEN) -> sends the digest on demand.
- Cron 0 16 * * 1 (Cloudflare day 1 = Sunday, so Sun 16:00 UTC) -> weekly digest of papers published in the last 7 days.

The public form lives on qnfo.org; qnfo-gateway proxies /api/subscribe and
/api/unsubscribe here so the browser stays same-origin.

## Weekly signal (WEEKLY-SIGNAL-1, RM-BS-WEEKLY-SIGNAL-1, blue-sky bet B16)

One "claim, check, limits" issue a week in place of the roll-up, with a human in the loop and the voice disclosed.

- The hourly tick (not the Sunday run) drafts the issue for the next Sunday 16:00 UTC slot once the slot is within 96 hours. No model call and no new
  binding: up to three papers from the last seven days that are published, have a plain-language summary (living-paper `plain_summary`, current version, grade
  12 or lower) and no open erratum (`internal_errata`). Claim = that summary; Check = the paper's own "Smallest falsifying experiment" or "Falsification"
  paragraph; Limits = its own "Limitations" list, plus its provenance note "Not checked" and the QNFO label "Not independently peer-reviewed". A missing check or
  limits section is said to be missing. Papers that state both rank first; this is a rule, not a quality judgement.
- The draft is a row in qnfo-audit `weekly_signal_issues` (migration 2026-11-05-weekly-signal-issues.sql): draft -> approved | rejected -> sending -> sent, or expired
  when the slot passed unreviewed. The owner is mailed the draft and a review link once (three attempts at most).
- GET /review?week=YYYY-MM-DD&token=... shows the draft and changes nothing (mail scanners fetch every link). Only its Approve or Reject button (POST) decides, and
  only before the slot. The token is an HMAC of the date under SUBSCRIBERS_TOKEN, never the secret.
- The Sunday run (`runDigest`) sends an approved issue for today's date to confirmed, non-suppressed subscribers and nobody else. The row is claimed ('sending') before the
  first mail, so a cron retry cannot mail it twice. With no approved issue, or an on-demand run with its own window, the paper roll-up goes out exactly as before.
- Every issue says it is machine-drafted and human-approved and that any audio edition is not yet published and will use a synthetic voice, labelled as such. There is no audio yet.
- GET /signal and GET /signal/YYYY-MM-DD are the public archive (sent issues only). POST /run/signal/draft (Bearer SUBSCRIBERS_TOKEN, `{"force":true,"noMail":true}`) drafts on demand.
- Next: audio episode with a labelled synthetic voice and an RSS feed (PROD-22), the review link and archive on qnfo.org through qnfo-gateway, an inline signup.
