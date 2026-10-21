'use strict';
// Local-only HTTP server: the page, a Server-Sent Events stream of snapshots, and a hook endpoint.

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const MAX_HOOK_BYTES = 256 * 1024;

/**
 * @param {{ getSnapshot: () => object, onHook?: (payload) => void, tickMs?: number }} opts
 * @returns {http.Server & { broadcast: () => void }}
 */
function createServer({ getSnapshot, onHook = () => {}, tickMs = 1000 }) {
  const clients = new Set();
  let last = '';

  const broadcast = (force = false) => {
    const data = JSON.stringify(getSnapshot());
    if (!force && data === last) return;
    last = data;
    for (const res of clients) res.write(`data: ${data}\n\n`);
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    // Only same-machine pages may talk to us (blocks DNS-rebinding style access).
    const host = (req.headers.host || '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
      res.writeHead(403).end();
      return;
    }
    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(getSnapshot())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/snapshot') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(getSnapshot()));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/hook') {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (c) => {
        body += c;
        if (body.length > MAX_HOOK_BYTES) req.destroy();
      });
      req.on('end', () => {
        try { onHook(JSON.parse(body)); } catch { /* ignore malformed hook payloads */ }
        res.writeHead(204).end();
        broadcast();
      });
      return;
    }
    if (req.method === 'GET') {
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const file = path.join(PUBLIC, name);
      if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      fs.createReadStream(file).pipe(res);
      return;
    }
    res.writeHead(405).end();
  });

  const timer = setInterval(() => broadcast(), tickMs);
  timer.unref();
  // keep-alive comments so proxies / browsers keep the stream open
  const ping = setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 15000);
  ping.unref();
  server.on('close', () => {
    clearInterval(timer);
    clearInterval(ping);
    for (const res of clients) res.end();
  });
  server.broadcast = broadcast;
  return server;
}

module.exports = { createServer };
