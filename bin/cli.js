#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const { parseArgs } = require('node:util');
const { StorePoller, defaultDbPath } = require('../lib/store');
const { Office } = require('../lib/office');
const { demoSnapshot } = require('../lib/demo');
const { createServer } = require('../lib/server');
const { applyHooks } = require('../lib/hooks');

const HELP = `devin-pixel-office — your Devin sessions as pixel characters in a tiny office

Usage: npx devin-pixel-office [options]
       npx devin-pixel-office install-hooks | uninstall-hooks [--port <n>]

  --port <n>        port on 127.0.0.1 (default 4777)
  --window <min>    show sessions active in the last <min> minutes (default 120)
  --db <path>       Devin session store (default: ${defaultDbPath()})
  --demo            scripted sessions, no Devin data needed
  --no-open         do not open the browser
  -h, --help

install-hooks adds optional Devin hooks so a character raises its hand the moment Devin
asks for permission (without them, approvals look like a long-running tool).`;

function openUrl(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: 'string', default: '4777' }, window: { type: 'string', default: '120' }, db: { type: 'string' },
      demo: { type: 'boolean' }, 'no-open': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) return console.log(HELP);
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port must be a port number');

  if (positionals[0] === 'install-hooks' || positionals[0] === 'uninstall-hooks') {
    const file = applyHooks(positionals[0] === 'install-hooks' ? port : null);
    return console.log(`${positionals[0] === 'install-hooks' ? 'added hooks to' : 'removed hooks from'} ${file}${positionals[0] === 'install-hooks' ? '\nRestart Devin to load them.' : ''}`);
  }
  if (positionals.length) throw new Error(`unknown command "${positionals[0]}"`);

  const office = new Office();
  let getSnapshot;
  let poller = null;
  if (values.demo) {
    const start = Date.now();
    getSnapshot = () => demoSnapshot(Date.now(), start);
  } else {
    poller = new StorePoller({ file: values.db || defaultDbPath(), windowMs: Number(values.window) * 60_000 }).open();
    getSnapshot = () => office.snapshot(poller.sessions.values());
    setInterval(() => {
      try { poller.poll(); } catch { /* the store may be busy for a moment; try again next tick */ }
    }, 700).unref();
  }

  const server = createServer({ getSnapshot, onHook: (p) => office.onHook(p) });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}/`;
    console.log(`Devin Pixel Office: ${url}${values.demo ? '  (demo)' : ''}\nCtrl+C to close.`);
    if (!values['no-open']) openUrl(url);
  });
  const stop = () => {
    server.close();
    if (poller) poller.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

try {
  main();
} catch (e) {
  process.stderr.write(`devin-pixel-office: ${e.message}\n`);
  process.exit(1);
}
