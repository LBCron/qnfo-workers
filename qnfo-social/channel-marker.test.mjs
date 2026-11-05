// ART50-CHANNEL-DRAIN-MARKER-1 (qnfo-social 0.21.1): the channel drain marks its text, and the stored 200-character preview keeps the marker.
// Run: node qnfo-social/channel-marker.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');
let pass = 0; const ok = (n) => { pass++; console.log('ok - ' + n); };
assert.ok(/const text = withAutomationMarker\(utmTagText\(channelText\(channel, cg\.texts, link, row\.title\)/.test(src)); ok('the drain text passes through withAutomationMarker before channelCreate');
assert.ok(/CHANNEL_MAX_CHARS\[channel\] \|\| 280\);\s*\n\s*const res = await channelCreate\(env, ch, channel, text, liMode\);/.test(src)); ok('the limit is the channel limit');
const m = src.match(/function previewKeepingMarker\(text\) \{[\s\S]*?\n\}/);
assert.ok(m); const AUTOMATION_MARKER = ' [AI-generated]';
const previewKeepingMarker = new Function('AUTOMATION_MARKER', m[0] + '; return previewKeepingMarker;')(AUTOMATION_MARKER);
const long = 'x'.repeat(400) + AUTOMATION_MARKER;
assert.equal(previewKeepingMarker(long).length, 200); assert.ok(previewKeepingMarker(long).endsWith(AUTOMATION_MARKER)); ok('a long marked post keeps the marker in a 200-character preview');
assert.equal(previewKeepingMarker('y'.repeat(400)), 'y'.repeat(200)); ok('an unmarked long post is cut as before');
assert.equal(previewKeepingMarker('short' + AUTOMATION_MARKER), 'short' + AUTOMATION_MARKER); ok('a short post is stored whole');
assert.ok(/recordChannelPost[\s\S]{0,1400}previewKeepingMarker\(typeof res\.text === 'string' && res\.text \? res\.text : text\)/.test(src)); ok('recordChannelPost stores the marker-keeping preview of the text that was sent');
// BP26-LABEL-LEDGER-2: run recordChannelPost itself against a stub database: the roll-up passes the pre-marker note, bufferCreate returns the marked text, the ledger keeps the marked one
const rm = src.match(/async function recordChannelPost\([\s\S]*?\n\}\n/);
assert.ok(rm);
const bound = [];
const stubEnv = { DB: { prepare: () => ({ bind: (...a) => { bound.push(a); return { run: async () => ({}) }; } }) } };
const run = new Function('ensureChannelSchema', 'BUFFER_UTM_SOURCE', 'CHANNEL_PLATFORM', 'previewKeepingMarker', 'crypto', rm[0] + '; return recordChannelPost;')(async () => {}, { substack: 'substack' }, { substack: 'buffer-substack' }, previewKeepingMarker, { randomUUID: () => 'abcdefabcdef-0000' });
await run(stubEnv, 'substack', 'rollup-x', { post_id: 'p1', status: 'ok', text: 'New open-access paper from QNFO:\n\n1. T - https://p' + AUTOMATION_MARKER }, 'New open-access paper from QNFO:\n\n1. T - https://p', 'rollup:1');
assert.ok(bound[0][3].endsWith(AUTOMATION_MARKER)); ok('a roll-up Note is recorded with the marker bufferCreate put on it');
await run(stubEnv, 'substack', 'slug', { post_id: 'p2', status: 'ok' }, 'plain text', 'channel-drain');
assert.equal(bound[1][3], 'plain text'); ok('a result without text falls back to the caller text');
await run(stubEnv, 'substack', 'slug', { post_id: 'p3', status: 'ok', text: 'z'.repeat(400) + AUTOMATION_MARKER }, 'z'.repeat(400), 'cross-post');
assert.equal(bound[2][3].length, 200); assert.ok(bound[2][3].endsWith(AUTOMATION_MARKER)); ok('a long sent text keeps the marker inside the 200-character preview');
console.log(pass + ' passed, 0 failed');
