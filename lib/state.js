'use strict';
// What is a session doing right now? Inferred from the tail of its messages
// (plus PermissionRequest hooks when installed). Pure, so it is easy to test.

const path = require('node:path');

const DONE_MS = 10 * 60_000; // finished recently: relaxing at the desk
const SLEEP_MS = 60 * 60_000; // idle: asleep; after this the character goes home
const STALE_THINKING_MS = 10 * 60_000; // "thinking" this long means the session was interrupted

const TOOL_ACTIVITY = {
  edit: 'typing', write: 'typing', apply_patch: 'typing', notebook_edit: 'typing',
  exec: 'terminal', get_output: 'terminal', write_to_process: 'terminal', kill_shell: 'terminal',
  read: 'reading', grep: 'reading', glob: 'reading', find_file_by_name: 'reading', notebook_read: 'reading', code_search: 'reading',
  web_search: 'browsing', webfetch: 'browsing',
  run_subagent: 'delegating', read_subagent: 'delegating',
  todo_write: 'planning', exit_plan_mode: 'planning',
  ask_user_question: 'asking',
};

function activityForTool(name) {
  if (TOOL_ACTIVITY[name]) return TOOL_ACTIVITY[name];
  if (/browser|chrome|playwright|navigate|screenshot/i.test(name)) return 'browsing';
  return 'tool';
}

function clip(s, n) {
  const a = [...String(s).replace(/\s+/g, ' ').trim()];
  return a.length > n ? `${a.slice(0, n - 1).join('')}…` : a.join('');
}

/** A short human description of a tool call, e.g. "npm test", "login.ts", "github.com". */
function describeTool(call) {
  const a = (call && call.arguments) || {};
  if (typeof a.command === 'string') return clip(a.command.split('\n')[0], 48);
  for (const k of ['file_path', 'path', 'notebook_path']) if (typeof a[k] === 'string') return path.basename(a[k]);
  if (typeof a.url === 'string') {
    try { return new URL(a.url).host; } catch { return clip(a.url, 40); }
  }
  if (typeof a.query === 'string') return clip(a.query, 40);
  if (typeof a.pattern === 'string') return clip(a.pattern, 40);
  if (typeof a.title === 'string') return clip(a.title, 40);
  if (typeof a.tool_name === 'string') return a.tool_name;
  return '';
}

/**
 * @param {Array<{ role: string, ts: number, toolCalls?: Array<{ id, name, arguments }>, toolCallId?: string, error?: boolean }>} tail oldest first
 * @param {number} now
 * @param {{ waitingSince?: number, tool?: string, detail?: string } | null} hook PermissionRequest seen and not yet resolved
 * @returns {{ status: string, tool?: string, detail?: string, since: number, error?: boolean }}
 */
function inferStatus(tail, now, hook = null) {
  const last = tail[tail.length - 1];
  if (!last) return { status: 'gone', since: 0 };
  if (hook && hook.waitingSince && hook.waitingSince >= last.ts - 2000) {
    return { status: 'waiting', tool: hook.tool, detail: hook.detail || '', since: hook.waitingSince };
  }
  const age = now - last.ts;
  if (last.role === 'assistant' && last.toolCalls && last.toolCalls.length) {
    const call = last.toolCalls[0];
    const activity = activityForTool(call.name);
    if (activity === 'asking') return { status: 'asking', tool: call.name, detail: describeTool(call), since: last.ts };
    if (age > SLEEP_MS) return { status: 'gone', since: last.ts };
    return { status: activity, tool: call.name, detail: describeTool(call), since: last.ts };
  }
  if (last.role === 'assistant') {
    if (age < DONE_MS) return { status: 'done', since: last.ts };
    if (age < SLEEP_MS) return { status: 'sleeping', since: last.ts };
    return { status: 'gone', since: last.ts };
  }
  // last message is the user's prompt or a tool result: the model is generating
  if (age > SLEEP_MS) return { status: 'gone', since: last.ts };
  if (age > STALE_THINKING_MS) return { status: 'sleeping', since: last.ts };
  return { status: 'thinking', since: last.ts, error: last.role === 'tool' && !!last.error };
}

/** Exit code / error markers in a tool result. */
function looksLikeError(content) {
  return typeof content === 'string' && /(^|\n)Exit code: [1-9]\d*\s*$|^(Error|error):|<tool_use_error>/m.test(content.slice(-2000));
}

module.exports = { TOOL_ACTIVITY, DONE_MS, SLEEP_MS, activityForTool, describeTool, inferStatus, looksLikeError };
