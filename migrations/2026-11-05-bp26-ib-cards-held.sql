-- BP26-IB-HELD-1 (2026-11-05, session breach-bp26-reach; charter pillars reach and core; OWNER-NO-LOOSE-ENDS-1, IDENTITY-BOUND rule of AUTONOMY-FIRST-1): gives the dashboard hand-back of the two BP26 IDENTITY-BOUND cards its disposition.
-- WHAT HAPPENED: BP26-IB-CARDS-1 (migrations/2026-11-05-bp26-ib-cards-and-latency-notes.sql, applied 2026-11-04 23:29Z) reopened human_actions 173 (bp26-email-agent-ai-disclosure) and 174 (bp26-social-bot-labels), which had
--   been closed at birth on their defaults. At 2026-11-05 00:26Z the cards were set to status rerouted with the resolution "handed back to the fleet by the owner (dashboard)", and the dashboard filed agent_issues 1001917
--   and 1001918 ("do it yourself"). The step is a platform label on accounts in the owner's name and a notice inside mail sent in the owner's name: both are IDENTITY-BOUND (the owner's own accounts, a legal judgment about
--   the owner's mail), which the fleet may not take for the owner. A rerouted card is read by the fleet loops as fleet work, so left as it is a loop could act on it.
-- WHAT WAS TRIED (read-only, 2026-11-04 23:00Z and 2026-11-05 03:20Z): the public Bluesky AppView profile of did:plc:vad2yeqflg5uznmp557zge5c (handle qnfo.org) answers labels [] and the public Mastodon lookup of
--   @QNFO@mstdn.science answers bot false; both profiles carry the owner's name; X and LinkedIn are unreadable without credentials. The producers read the platforms correctly. No setting on any account and no line of the
--   e-mail agent was changed; a code task that would put a notice into replies in the owner's name (ct_im1000521) failed MERGE-SCOPE-AT-READ-1 and is not to be re-run.
-- WHAT THIS FILE DOES: sets cards 173 and 174 back to open (they keep their IDENTITY-BOUND line and their default in effect) with the closing probe in the text, and appends the exact blocker and the closing probe to issues
--   1001917 and 1001918. It changes no metric, trigger, target, account or mail path, and closes nothing.
-- PREDICTION: social_bot_label_enabled and ai_interaction_disclosure stay in breach until the owner answers; no fleet loop acts on the two cards; owner_queue_live_open +2.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE human_actions SET status = (SELECT b.status FROM bak_20261105_bp26_ib_cards_held b WHERE b.id = human_actions.id), resolved_at = (SELECT b.resolved_at FROM bak_20261105_bp26_ib_cards_held b WHERE b.id = human_actions.id), resolution = (SELECT b.resolution FROM bak_20261105_bp26_ib_cards_held b WHERE b.id = human_actions.id), why = (SELECT b.why FROM bak_20261105_bp26_ib_cards_held b WHERE b.id = human_actions.id), updated_at = (SELECT b.updated_at FROM bak_20261105_bp26_ib_cards_held b WHERE b.id = human_actions.id) WHERE id IN (SELECT id FROM bak_20261105_bp26_ib_cards_held); UPDATE agent_issues SET description = substr(description, 1, instr(description, char(10) || 'DELTA-NOTE (breach-bp26-reach, 2026-11-05d)') - 1) WHERE instr(description, char(10) || 'DELTA-NOTE (breach-bp26-reach, 2026-11-05d)') > 0
-- BACKUP: bak_20261105_bp26_ib_cards_held

CREATE TABLE IF NOT EXISTS bak_20261105_bp26_ib_cards_held AS SELECT * FROM human_actions WHERE id IN (173, 174);

UPDATE human_actions
SET status = 'open', resolved_at = NULL, resolution = NULL, updated_at = datetime('now'),
    why = why || ' HELD 2026-11-05 (BP26-IB-HELD-1): the dashboard hand-back of this card (issue 1001917) reached the fleet, which may not take this step for you: it is a platform label on accounts in your name. Read live, nothing changed: Bluesky qnfo.org labels none, Mastodon @QNFO bot flag off. The default stays in effect (in-text marker on every post). Closing probe: metric social_bot_label_enabled (trigger 14495) reads 1, or your answer ''not on personal accounts'' after which the fleet rescopes the metric and records it in decision_log.'
WHERE id = 174 AND status = 'rerouted' AND instr(why, 'IDENTITY-BOUND:') > 0 AND instr(why, 'BP26-IB-HELD-1') = 0;

UPDATE human_actions
SET status = 'open', resolved_at = NULL, resolution = NULL, updated_at = datetime('now'),
    why = why || ' HELD 2026-11-05 (BP26-IB-HELD-1): the dashboard hand-back of this card (issue 1001918) reached the fleet, which may not take this step for you: it is a notice inside mail sent in your name and a legal judgment about that mail. The e-mail agent was not changed. The default stays in effect (no change). Closing probe: metric ai_interaction_disclosure (trigger 14498) reads 1 after your answer ''disclose'', or your answer ''keep'' after which the fleet rescopes the metric and records it in decision_log.'
WHERE id = 173 AND status = 'rerouted' AND instr(why, 'IDENTITY-BOUND:') > 0 AND instr(why, 'BP26-IB-HELD-1') = 0;

UPDATE agent_issues
SET description = description || char(10) || 'DELTA-NOTE (breach-bp26-reach, 2026-11-05d): blocker, IDENTITY-BOUND. The step is a platform label on the owner''s own accounts (Bluesky did:plc:vad2yeqflg5uznmp557zge5c = qnfo.org, Mastodon @QNFO@mstdn.science, both in the owner''s name; X and LinkedIn unreadable without credentials). Tried on each surface, read-only: the public Bluesky AppView profile answers labels [], the public Mastodon lookup answers bot false; the producer (scripts/bp26_reach.py collect_social_labels) reads both correctly. No write was made on any surface (tools, existing credentials, repository token, executor), because the setting is the owner''s identity on those platforms and the card says so. The card is open again with its IDENTITY-BOUND line (migrations/2026-11-05-bp26-ib-cards-held.sql). Closing probe: metric social_bot_label_enabled (trigger 14495) at 1, or the owner''s answer on the card; do not close this issue without one of them.',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id = 1001917 AND status = 'open' AND instr(description, 'DELTA-NOTE (breach-bp26-reach, 2026-11-05d)') = 0;

UPDATE agent_issues
SET description = description || char(10) || 'DELTA-NOTE (breach-bp26-reach, 2026-11-05d): blocker, IDENTITY-BOUND. The step is a notice inside replies the e-mail agent sends in the owner''s name, and whether Art. 50(1) or the personal-use exclusion applies is a legal judgment this fleet cannot make for the owner. Tried on each surface, read-only: ipatent and the twin disclose live and are counted; the e-mail agent source carries no disclosure and was not changed; the lever-review code task ct_im1000521 failed MERGE-SCOPE-AT-READ-1 and must not be re-run. The card is open again with its IDENTITY-BOUND line (migrations/2026-11-05-bp26-ib-cards-held.sql). Closing probe: metric ai_interaction_disclosure (trigger 14498) at 1 after the owner answers ''disclose'', or the owner''s answer ''keep''; do not close this issue without one of them.',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id = 1001918 AND status = 'open' AND instr(description, 'DELTA-NOTE (breach-bp26-reach, 2026-11-05d)') = 0;
