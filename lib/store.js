'use strict';
// Follows Devin's local session store (shared by Devin CLI and Devin Desktop) by
// polling for new message rows. Read-only; no hooks or Devin changes needed.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { looksLikeError } = require('./state');

const TAIL = 12;

function defaultDbPath(env = process.env) {
  if (env.DEVIN_SESSIONS_DB) return env.DEVIN_SESSIONS_DB;
  const base = process.platform === 'win32' && env.LOCALAPPDATA
    ? path.join(env.LOCALAPPDATA, 'devin')
    : path.join(env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'devin');
  return path.join(base, 'cli', 'sessions.db');
}

function toEntry(json, createdAt) {
  let m;
  try { m = JSON.parse(json); } catch { return null; }
  if (!m || !['user', 'assistant', 'tool'].includes(m.role)) return null;
  if (m.role === 'user' && !(m.metadata && m.metadata.is_user_input)) return null;
  return {
    id: m.message_id,
    role: m.role,
    ts: createdAt * 1000,
    toolCalls: Array.isArray(m.tool_calls) ? m.tool_calls.map((c) => ({ id: c.id, name: String(c.name || ''), arguments: c.arguments || {} })) : [],
    toolCallId: m.tool_call_id,
    error: m.role === 'tool' ? looksLikeError(m.content) : false,
  };
}

class StorePoller {
  /** @param {{ file?: string, windowMs?: number }} opts */
  constructor({ file = defaultDbPath(), windowMs = 2 * 3600_000 } = {}) {
    this.file = file;
    this.windowMs = windowMs;
    this.sessions = new Map(); // id -> { id, title, cwd, tail: [] }
    this.lastRowId = 0;
    this.db = null;
  }

  open() {
    if (!fs.existsSync(this.file)) throw new Error(`no Devin session store at ${this.file} (use --db <path>, or --demo)`);
    const { DatabaseSync } = require('node:sqlite');
    this.db = new DatabaseSync(this.file, { readOnly: true });
    const since = Math.floor((Date.now() - this.windowMs) / 1000);
    const recent = this.db.prepare('SELECT id FROM sessions WHERE last_activity_at >= ? AND hidden = 0').all(since);
    const tailStmt = this.db.prepare('SELECT row_id, chat_message, created_at FROM message_nodes WHERE session_id = ? ORDER BY row_id DESC LIMIT 60');
    for (const { id } of recent) {
      const rows = tailStmt.all(id).reverse();
      for (const r of rows) this.push(id, toEntry(r.chat_message, r.created_at));
    }
    this.lastRowId = Number(this.db.prepare('SELECT COALESCE(MAX(row_id), 0) AS m FROM message_nodes').get().m);
    this.refreshMeta();
    return this;
  }

  push(sessionId, entry) {
    if (!entry) return;
    let s = this.sessions.get(sessionId);
    if (!s) {
      s = { id: sessionId, title: '', cwd: '', tail: [] };
      this.sessions.set(sessionId, s);
    }
    if (entry.id && s.tail.some((e) => e.id === entry.id)) return; // same message on another branch
    s.tail.push(entry);
    if (s.tail.length > TAIL) s.tail.splice(0, s.tail.length - TAIL);
  }

  refreshMeta() {
    if (!this.sessions.size) return;
    const stmt = this.db.prepare('SELECT title, working_directory AS cwd, hidden FROM sessions WHERE id = ?');
    for (const s of this.sessions.values()) {
      const row = stmt.get(s.id);
      if (!row) continue;
      s.title = row.title || '';
      s.cwd = row.cwd || '';
      s.hidden = !!row.hidden;
    }
  }

  /** Reads rows added since the last poll. Returns how many were applied. */
  poll() {
    const rows = this.db.prepare('SELECT row_id, session_id, chat_message, created_at FROM message_nodes WHERE row_id > ? ORDER BY row_id').all(this.lastRowId);
    let newSession = false;
    for (const r of rows) {
      this.lastRowId = Math.max(this.lastRowId, Number(r.row_id));
      if (!this.sessions.has(r.session_id)) newSession = true;
      this.push(r.session_id, toEntry(r.chat_message, r.created_at));
    }
    if (rows.length || newSession) this.refreshMeta();
    return rows.length;
  }

  close() {
    if (this.db) this.db.close();
    this.db = null;
  }
}

module.exports = { defaultDbPath, toEntry, StorePoller };
