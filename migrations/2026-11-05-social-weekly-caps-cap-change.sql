-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_social_caps_probe
-- Rollback: UPDATE control_alternate_probes SET probe_sql = (SELECT b.probe_sql FROM bak_20261105_social_caps_probe b WHERE b.control = control_alternate_probes.control), window_note = (SELECT b.window_note FROM bak_20261105_social_caps_probe b WHERE b.control = control_alternate_probes.control) WHERE control IN (SELECT control FROM bak_20261105_social_caps_probe)
-- CAPS-CHANGE-GRACE-1 (2026-11-05, charter pillar autonomy; GitHub 5282 / agent_issues 1000610 reopened by issue_refile_reopen at 2026-11-05T03:06:40Z, chaos-drill control social-weekly-caps).
-- Live read, 2026-11-05T03:30Z: the drill reads red again ("published Buffer posts exceed a channel effective weekly cap in 7 days") with no violation by the posting path.
-- buffer-mastodon published 8 posts in the last 7 days (2026-10-30 to 2026-11-04T12:31Z) under a weekly cap of 14; pipeline_flags social_channel_caps was set to mastodon 7 (REACH-FOCUS-1) at
-- 2026-11-04T21:15:31Z and the attention share of mastodon is 0.5 today, so the effective cap is int(7 * (0.5 + 0.5 * 0.5)) = 5; 8 > 5. Not one post was published after the cap change.
-- The drill judged 7 days of history by today's caps and today's attention share. Both change on purpose (the caps by decision, the share every day at 02:00Z, between the floor 0.5 and 1), so
-- every change would turn the drill red for up to a week and reopen the issue, whatever the posting path did: a drill that fails on a decision is not evidence about the control.
-- Change (the probe row of the control only; the drill, the registry and the issue contract are untouched):
--   1. posts published at or before the time the channel caps were last changed are not counted (they were published under the caps then in force, which the history does not keep);
--   2. the weekly count and the cap-derived spacing are compared with the channel's hard cap (base_cap), not with the daily attention-share cap: the share only lowers what the posting path
--      allows, and it moves every day. The incident the drill exists for is kept: two LinkedIn posts 5 h apart under a cap of 7 (spacing 23 h) after the last cap change still read
--      'consecutive Buffer posts violate the channel effective weekly-cap spacing', and a count above the hard cap still reads 'exceed' (migrations/social-weekly-caps-cap-change.test.mjs).
-- Prediction: the next 6-hourly drill reads ok (mastodon posts since the cap change: 0), the contract of 1000610 passes and the issue closes; the drill stays red only for a post made after the
-- last cap change that breaks the hard cap or the spacing. Guard: the drill's alternate probe stays read-only; the zero-cap check is unchanged.

CREATE TABLE IF NOT EXISTS bak_20261105_social_caps_probe AS SELECT control, probe_sql, window_note FROM control_alternate_probes WHERE control = 'social-weekly-caps';

UPDATE control_alternate_probes
SET probe_sql = replace(replace(replace(replace(probe_sql,
    '0.5) AS floor), raw_posts AS (',
    '0.5) AS floor, COALESCE((SELECT updated_at FROM pipeline_flags WHERE key = ''social_channel_caps''), '''') AS caps_at), raw_posts AS ('),
    'AND published_at > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-7 days'')), effective_posts AS (',
    'AND published_at > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-7 days'') AND published_at > config.caps_at), effective_posts AS ('),
    'WHEN EXISTS (SELECT 1 FROM effective_posts WHERE posts_7d > effective_cap) THEN',
    'WHEN EXISTS (SELECT 1 FROM effective_posts WHERE posts_7d > base_cap) THEN'),
    'CAST(604800.0 / effective_cap AS INTEGER) - 3600',
    'CAST(604800.0 / base_cap AS INTEGER) - 3600'),
    window_note = window_note || '; posts published before the channel caps were last changed (pipeline_flags social_channel_caps updated_at) are judged under the caps then in force and are not counted, and the hard weekly cap of the channel is compared, not the daily attention share (CAPS-CHANGE-GRACE-1)'
WHERE control = 'social-weekly-caps' AND instr(probe_sql, 'caps_at') = 0
  AND length(probe_sql) - length(replace(probe_sql, '0.5) AS floor), raw_posts AS (', '')) = length('0.5) AS floor), raw_posts AS (')
  AND length(probe_sql) - length(replace(probe_sql, 'AND published_at > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-7 days'')), effective_posts AS (', '')) = length('AND published_at > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-7 days'')), effective_posts AS (')
  AND length(probe_sql) - length(replace(probe_sql, 'WHEN EXISTS (SELECT 1 FROM effective_posts WHERE posts_7d > effective_cap) THEN', '')) = length('WHEN EXISTS (SELECT 1 FROM effective_posts WHERE posts_7d > effective_cap) THEN')
  AND length(probe_sql) - length(replace(probe_sql, 'CAST(604800.0 / effective_cap AS INTEGER) - 3600', '')) = length('CAST(604800.0 / effective_cap AS INTEGER) - 3600');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:D2-slo-journeys-probes',
  'a drill that fails on a decision (a cap change, a daily attention share) is not evidence about the control it exercises',
  'CAPS-CHANGE-GRACE-1: the social-weekly-caps alternate probe ignores posts published before the caps were last changed and compares the hard weekly cap and its spacing',
  '2026-11-05T03:30Z: buffer-mastodon 8 posts in 7 days under cap 14, cap set to 7 at 2026-11-04T21:15:31Z, share 0.5, effective cap 5, 0 posts since; the drill read red and reopened 1000610',
  'pending', 'one control_alternate_probes row (read-only probe)',
  'restore probe_sql and window_note from bak_20261105_social_caps_probe (Rollback line)',
  'the weekly-cap drill reports the control, not the last cap decision',
  'the next 6-hourly drill reads ok and stays ok across a cap change; a post after the last change that breaks the hard cap or spacing still turns it red',
  'fewer false reopens of the social cap issue',
  'migrations/social-weekly-caps-cap-change.test.mjs on node:sqlite over the probe built by migrations/2026-11-03-social-weekly-caps-probe.sql'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'session:D2-slo-journeys-probes' AND action LIKE 'CAPS-CHANGE-GRACE-1:%');
