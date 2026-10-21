'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { StorePoller, toEntry } = require('../lib/store');
const { Office } = require('../lib/office');
const { createServer } = require('../lib/server');
const { withOfficeHooks, applyHooks, EVENTS } = require('../lib/hooks');

function makeStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dpo-test-'));
  const file = path.join(dir, 'sessions.db');
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, working_directory TEXT NOT NULL, backend_type TEXT NOT NULL, model TEXT NOT NULL, agent_mode TEXT NOT NULL,
      created_at INTEGER NOT NULL, last_activity_at INTEGER NOT NULL, title TEXT, hidden INTEGER NOT NULL DEFAULT 0, metadata TEXT);
    CREATE TABLE message_nodes (row_id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, node_id INTEGER NOT NULL, parent_node_id INTEGER,
      chat_message TEXT NOT NULL, created_at INTEGER NOT NULL, metadata TEXT);`);
  const now = Math.floor(Date.now() / 1000);
  let node = 0;
  const api = {
    dir,
    file,
    session: (id, title, ageSec = 10) => db.prepare("INSERT INTO sessions VALUES (?, '/Users/me/app', 'windsurf', 'm', 'x', ?, ?, ?, 0, NULL)").run(id, now - ageSec, now - ageSec, title),
    msg: (sid, m, ageSec = 0) => db.prepare('INSERT INTO message_nodes (session_id, node_id, chat_message, created_at) VALUES (?, ?, ?, ?)').run(sid, node++, JSON.stringify(m), now - ageSec),
    rename: (id, title) => db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, id),
    close: () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
  return api;
}

test('toEntry keeps prompts, replies and tool results, flags failed commands', () => {
  assert.equal(toEntry(JSON.stringify({ role: 'system', content: 'x' }), 1), null);
  assert.equal(toEntry(JSON.stringify({ role: 'user', content: 'injected', metadata: {} }), 1), null);
  assert.equal(toEntry('nope', 1), null);
  const e = toEntry(JSON.stringify({ message_id: 'm', role: 'tool', tool_call_id: 'c', content: 'boom\nExit code: 1' }), 5);
  assert.deepEqual([e.role, e.ts, e.error], ['tool', 5000, true]);
});

test('StorePoller loads recent sessions and follows new rows', (t) => {
  const s = makeStore();
  t.after(s.close);
  s.session('recent', 'Fix bug');
  s.session('ancient', 'Old', 10 * 3600);
  s.msg('recent', { message_id: 'u1', role: 'user', content: 'fix it', metadata: { is_user_input: true } }, 5);
  s.msg('ancient', { message_id: 'u0', role: 'user', content: 'old', metadata: { is_user_input: true } }, 10 * 3600);
  const p = new StorePoller({ file: s.file }).open();
  t.after(() => p.close());
  assert.deepEqual([...p.sessions.keys()], ['recent']);
  assert.equal(p.sessions.get('recent').title, 'Fix bug');

  s.msg('recent', { message_id: 'a1', role: 'assistant', tool_calls: [{ id: 'c1', name: 'exec', arguments: { command: 'npm test' } }] });
  s.msg('recent', { message_id: 'a1', role: 'assistant', tool_calls: [] }); // same message on another branch
  s.session('new', 'Brand new');
  s.msg('new', { message_id: 'u2', role: 'user', content: 'hi', metadata: { is_user_input: true } });
  s.rename('recent', 'Fix login bug');
  assert.equal(p.poll(), 3);
  assert.equal(p.sessions.get('recent').tail.length, 2);
  assert.equal(p.sessions.get('recent').title, 'Fix login bug');
  assert.equal(p.sessions.get('new').title, 'Brand new');
  assert.equal(p.poll(), 0);

  const snap = new Office().snapshot(p.sessions.values());
  const byId = Object.fromEntries(snap.sessions.map((x) => [x.id, x]));
  assert.equal(byId.recent.status, 'terminal');
  assert.equal(byId.recent.detail, 'npm test');
  assert.equal(byId.new.status, 'thinking');
});

test('missing store gives a helpful error', () => {
  assert.throws(() => new StorePoller({ file: '/definitely/missing.db' }).open(), /--demo/);
});

function request(port, { method = 'GET', pathName = '/', host = '127.0.0.1', body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, method, path: pathName, headers: { host: `${host}:${port}`, 'content-type': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (c) => {
        data += c;
        if (pathName === '/events' && data.includes('\n\n')) { req.destroy(); resolve({ status: res.statusCode, body: data, headers: res.headers }); }
      });
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', (e) => (pathName === '/events' ? undefined : reject(e)));
    if (body) req.write(body);
    req.end();
  });
}

test('server: page, SSE snapshot, hooks, host check, no path traversal', async (t) => {
  const office = new Office();
  const NOW = Date.now();
  const sessions = [{ id: 's1', title: 'Deploy', cwd: '/x/site', tail: [{ role: 'assistant', ts: NOW, toolCalls: [{ id: 'c', name: 'exec', arguments: { command: 'ls' } }] }] }];
  const server = createServer({ getSnapshot: () => office.snapshot(sessions), onHook: (p) => office.onHook(p) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const port = server.address().port;

  const page = await request(port);
  assert.equal(page.status, 200);
  assert.match(page.body, /DEVIN PIXEL OFFICE/);
  assert.equal((await request(port, { pathName: '/app.js' })).status, 200);
  assert.equal((await request(port, { pathName: '/../lib/server.js' })).status, 404);
  assert.equal((await request(port, { host: 'evil.example' })).status, 403);

  const ev = await request(port, { pathName: '/events' });
  assert.match(ev.headers['content-type'], /text\/event-stream/);
  assert.equal(JSON.parse(ev.body.replace(/^data: /, '')).sessions[0].status, 'terminal');

  const hook = await request(port, { method: 'POST', pathName: '/hook', body: JSON.stringify({ hook_event_name: 'PermissionRequest', session_id: 's1', tool_name: 'exec', tool_input: { command: 'ls' } }) });
  assert.equal(hook.status, 204);
  const snap = JSON.parse((await request(port, { pathName: '/snapshot' })).body);
  assert.equal(snap.sessions[0].status, 'waiting');
  assert.equal((await request(port, { method: 'POST', pathName: '/hook', body: 'not json' })).status, 204);
});

test('hooks install keeps other hooks and settings, uninstall restores', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dpo-hooks-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'config.json');
  const other = { matcher: '', hooks: [{ type: 'command', command: 'echo other' }] };
  fs.writeFileSync(file, JSON.stringify({ theme: 'dark', hooks: { Stop: [other] } }));
  applyHooks(4777, { DEVIN_CONFIG_PATH: file });
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(doc.theme, 'dark');
  assert.deepEqual(Object.keys(doc.hooks).sort(), [...EVENTS].sort());
  assert.equal(doc.hooks.Stop.length, 2);
  assert.match(doc.hooks.PermissionRequest[0].hooks[0].command, /127\.0\.0\.1:4777\/hook.*exit 0$/);
  assert.deepEqual(withOfficeHooks(doc.hooks, 4777), doc.hooks, 'idempotent');
  applyHooks(null, { DEVIN_CONFIG_PATH: file });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { theme: 'dark', hooks: { Stop: [other] } });
});
