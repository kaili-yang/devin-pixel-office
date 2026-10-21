'use strict';
// Combines store tails and hook events into the snapshot the browser renders.

const path = require('node:path');
const { inferStatus, describeTool } = require('./state');

const TEMP_DIR_RE = /^(\/private)?\/(tmp|var\/folders)\/|[\\/]Temp[\\/]/i;

class Office {
  constructor() {
    this.hooks = new Map(); // sessionId -> { waitingSince, tool, detail }
  }

  /** Devin hook payloads (optional, via `install-hooks`): PermissionRequest makes a character raise its hand. */
  onHook(payload, now = Date.now()) {
    const id = payload && payload.session_id;
    if (!id) return false;
    switch (payload.hook_event_name) {
      case 'PermissionRequest':
        this.hooks.set(id, { waitingSince: now, tool: payload.tool_name, detail: describeTool({ arguments: payload.tool_input || {} }) });
        return true;
      case 'PreToolUse': // a PreToolUse after approval means the tool is about to run
      case 'PostToolUse':
      case 'UserPromptSubmit':
      case 'Stop':
      case 'SessionEnd':
        return this.hooks.delete(id);
      default:
        return false;
    }
  }

  /** @param {Iterable<{ id, title, cwd, hidden, tail }>} sessions */
  snapshot(sessions, now = Date.now()) {
    const out = [];
    for (const s of sessions) {
      if (s.hidden) continue;
      const st = inferStatus(s.tail, now, this.hooks.get(s.id));
      if (st.status === 'gone') continue;
      const last = s.tail[s.tail.length - 1];
      out.push({
        id: s.id,
        title: s.title || s.id,
        project: s.cwd && !TEMP_DIR_RE.test(s.cwd) ? path.basename(s.cwd) : '',
        ...st,
        lastActivity: last ? last.ts : 0,
      });
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return { now, sessions: out };
  }
}

module.exports = { Office };
