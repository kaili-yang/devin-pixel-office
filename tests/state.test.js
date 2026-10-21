'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { inferStatus, describeTool, activityForTool, looksLikeError, DONE_MS, SLEEP_MS } = require('../lib/state');
const { Office } = require('../lib/office');
const { demoSnapshot, SCRIPT } = require('../lib/demo');

const NOW = 1_800_000_000_000;
const call = (name, args = {}) => ({ id: `c-${name}`, name, arguments: args });
const asst = (ts, ...calls) => ({ role: 'assistant', ts, toolCalls: calls });

test('a pending tool call maps to an activity with a short description', () => {
  assert.deepEqual(inferStatus([asst(NOW - 1000, call('exec', { command: 'npm test\nmore' }))], NOW), { status: 'terminal', tool: 'exec', detail: 'npm test', since: NOW - 1000 });
  assert.equal(inferStatus([asst(NOW, call('edit', { file_path: '/a/b/login.ts' }))], NOW).detail, 'login.ts');
  assert.equal(inferStatus([asst(NOW, call('webfetch', { url: 'https://docs.devin.ai/x' }))], NOW).status, 'browsing');
  assert.equal(inferStatus([asst(NOW, call('webfetch', { url: 'https://docs.devin.ai/x' }))], NOW).detail, 'docs.devin.ai');
  assert.equal(inferStatus([asst(NOW, call('grep', { pattern: 'TODO' }))], NOW).status, 'reading');
  assert.equal(inferStatus([asst(NOW, call('mcp__devin-chrome__navigate'))], NOW).status, 'browsing');
  assert.equal(inferStatus([asst(NOW, call('mcp_call_tool', { tool_name: 'x' }))], NOW).status, 'tool');
});

test('ask_user_question means Devin is waiting for the user, however long ago', () => {
  assert.equal(inferStatus([asst(NOW - 3 * SLEEP_MS, call('ask_user_question'))], NOW).status, 'asking');
});

test('finished turns relax, then sleep, then go home', () => {
  const done = (age) => inferStatus([{ role: 'user', ts: NOW - age - 5 }, { role: 'assistant', ts: NOW - age, toolCalls: [] }], NOW).status;
  assert.equal(done(1000), 'done');
  assert.equal(done(DONE_MS + 1), 'sleeping');
  assert.equal(done(SLEEP_MS + 1), 'gone');
  assert.equal(inferStatus([], NOW).status, 'gone');
});

test('after a prompt or a tool result the model is thinking; errors are flagged', () => {
  assert.deepEqual(inferStatus([{ role: 'user', ts: NOW - 500 }], NOW), { status: 'thinking', since: NOW - 500, error: false });
  assert.equal(inferStatus([asst(NOW - 900, call('exec')), { role: 'tool', ts: NOW - 500, error: true }], NOW).error, true);
  assert.equal(inferStatus([{ role: 'tool', ts: NOW - DONE_MS - 1 }], NOW).status, 'sleeping', 'interrupted session');
});

test('a PermissionRequest hook wins until it is resolved', () => {
  const tail = [asst(NOW - 3000, call('exec', { command: 'rm -rf build' }))];
  const hook = { waitingSince: NOW - 2500, tool: 'exec', detail: 'rm -rf build' };
  assert.equal(inferStatus(tail, NOW, hook).status, 'waiting');
  // a hook older than the latest message is stale
  assert.equal(inferStatus([...tail, { role: 'tool', ts: NOW - 100 }], NOW, hook).status, 'thinking');
});

test('Office.onHook tracks permission requests per session', () => {
  const office = new Office();
  const s = { id: 's1', title: 'T', cwd: '/Users/me/proj', tail: [asst(NOW - 2000, call('exec', { command: 'ls' }))] };
  assert.equal(office.onHook({ hook_event_name: 'PermissionRequest', session_id: 's1', tool_name: 'exec', tool_input: { command: 'ls -la' } }, NOW - 1000), true);
  let snap = office.snapshot([s], NOW);
  assert.equal(snap.sessions[0].status, 'waiting');
  assert.equal(snap.sessions[0].detail, 'ls -la');
  assert.equal(snap.sessions[0].project, 'proj');
  office.onHook({ hook_event_name: 'PostToolUse', session_id: 's1' });
  snap = office.snapshot([s], NOW);
  assert.equal(snap.sessions[0].status, 'terminal');
  assert.equal(office.onHook({ hook_event_name: 'Stop' }), false, 'no session id');
});

test('snapshot hides gone and hidden sessions and temp-dir project names', () => {
  const office = new Office();
  const snap = office.snapshot([
    { id: 'a', title: '', cwd: '/private/var/folders/x/T/tmp1', tail: [{ role: 'user', ts: NOW }] },
    { id: 'b', title: 'old', cwd: '/x', tail: [{ role: 'assistant', ts: NOW - SLEEP_MS * 2, toolCalls: [] }] },
    { id: 'c', title: 'hidden', cwd: '/x', hidden: true, tail: [{ role: 'user', ts: NOW }] },
  ], NOW);
  assert.deepEqual(snap.sessions.map((s) => [s.id, s.title, s.project]), [['a', 'a', '']]);
});

test('helpers', () => {
  assert.equal(activityForTool('apply_patch'), 'typing');
  assert.equal(describeTool({ arguments: { query: 'how to   use\nhooks' } }), 'how to use hooks');
  assert.equal(describeTool({}), '');
  assert.ok(looksLikeError('Output...\n\nExit code: 2'));
  assert.ok(!looksLikeError('Output...\n\nExit code: 0'));
  assert.ok(looksLikeError('<tool_use_error>nope</tool_use_error>'));
});

test('demo cycles through statuses and lets the fifth character walk in', () => {
  const start = NOW;
  assert.equal(demoSnapshot(start + 1000, start).sessions.length, 4);
  assert.equal(demoSnapshot(start + 5000, start).sessions.length, SCRIPT.length);
  const seen = new Set();
  for (let t = 0; t < 60_000; t += 1000) for (const s of demoSnapshot(start + 5000 + t, start).sessions) seen.add(s.status);
  for (const st of ['thinking', 'typing', 'terminal', 'reading', 'browsing', 'waiting', 'asking', 'done', 'sleeping']) assert.ok(seen.has(st), st);
});

test('the browser bundle is valid JavaScript', () => {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync(process.execPath, ['--check', require('node:path').join(__dirname, '..', 'public', 'app.js')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
