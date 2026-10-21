'use strict';
// Scripted sessions for `--demo`: lets anyone see the office without Devin data.

const SCRIPT = [
  { id: 'demo-1', title: 'Fix login redirect bug', project: 'webapp', steps: [['thinking'], ['reading', 'read', 'auth.ts'], ['typing', 'edit', 'auth.ts'], ['terminal', 'exec', 'npm test'], ['done']] },
  { id: 'demo-2', title: 'Add Stripe webhooks', project: 'billing', steps: [['browsing', 'web_search', 'stripe webhook signature'], ['typing', 'write', 'webhooks.py'], ['waiting', 'exec', 'pip install stripe'], ['terminal', 'exec', 'pytest -q']] },
  { id: 'demo-3', title: 'Refactor payments module', project: 'payments', steps: [['planning', 'todo_write', ''], ['delegating', 'run_subagent', 'explore codebase'], ['typing', 'edit', 'ledger.go'], ['thinking', null, null, true]] },
  { id: 'demo-4', title: 'Write release notes', project: 'docs', steps: [['asking', 'ask_user_question', 'Which version?'], ['typing', 'edit', 'CHANGELOG.md'], ['done'], ['sleeping']] },
  { id: 'demo-5', title: 'Upgrade to React 20', project: 'dashboard', steps: [['terminal', 'exec', 'pnpm up react'], ['reading', 'grep', 'useEffect'], ['typing', 'edit', 'App.tsx'], ['terminal', 'exec', 'pnpm build']] },
];

const STEP_MS = 7000;

function demoSnapshot(now = Date.now(), start = 0) {
  const elapsed = now - start;
  const sessions = SCRIPT.map((s, i) => {
    const k = Math.floor(elapsed / STEP_MS + i * 0.37) % s.steps.length;
    const [status, tool, detail, error] = s.steps[k];
    return { id: s.id, title: s.title, project: s.project, status, tool: tool || undefined, detail: detail || '', error: !!error, since: now - (elapsed % STEP_MS), lastActivity: now };
  });
  // the fifth character walks in after a few seconds, so the entrance animation is visible
  return { now, demo: true, sessions: elapsed < 4000 ? sessions.slice(0, 4) : sessions };
}

module.exports = { SCRIPT, demoSnapshot };
