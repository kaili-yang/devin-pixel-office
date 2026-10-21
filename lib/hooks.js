'use strict';
// Optional: forwards a few Devin hook events to the office server so a character can
// raise its hand the moment Devin asks for permission. Fails open (curl -m 1, exit 0).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EVENTS = ['PermissionRequest', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'SessionEnd'];
const MARKER = 'DEVIN_PIXEL_OFFICE_HOOK=1';

function userConfigPath(env = process.env) {
  if (env.DEVIN_CONFIG_PATH) return env.DEVIN_CONFIG_PATH;
  if (process.platform === 'win32' && env.APPDATA) return path.join(env.APPDATA, 'devin', 'config.json');
  return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'devin', 'config.json');
}

function hookCommand(port) {
  return `${MARKER} curl -s -m 1 -H 'content-type: application/json' --data-binary @- http://127.0.0.1:${Number(port)}/hook >/dev/null 2>&1; exit 0`;
}

const isOurs = (g) => Array.isArray(g && g.hooks) && g.hooks.some((h) => typeof h.command === 'string' && h.command.includes(MARKER));

function withOfficeHooks(hooks, port) {
  const out = {};
  for (const [ev, groups] of Object.entries(hooks || {})) {
    if (!Array.isArray(groups)) { out[ev] = groups; continue; }
    const kept = groups.filter((g) => !isOurs(g));
    if (kept.length) out[ev] = kept;
  }
  if (port) {
    const entry = { matcher: '', hooks: [{ type: 'command', command: hookCommand(port), timeout: 3 }] };
    for (const ev of EVENTS) out[ev] = [...(out[ev] || []), entry];
  }
  return out;
}

/** port = null uninstalls. Keeps every other setting and hook; writes a backup first. */
function applyHooks(port, env = process.env) {
  const file = userConfigPath(env);
  let doc = {};
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8');
    try { doc = JSON.parse(raw); } catch { throw new Error(`${file} is not plain JSON; add the hooks by hand`); }
    fs.writeFileSync(`${file}.devin-pixel-office.bak`, raw);
  }
  const hooks = withOfficeHooks(doc.hooks, port);
  if (Object.keys(hooks).length) doc.hooks = hooks;
  else delete doc.hooks;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  return file;
}

module.exports = { EVENTS, MARKER, userConfigPath, hookCommand, withOfficeHooks, applyHooks };
