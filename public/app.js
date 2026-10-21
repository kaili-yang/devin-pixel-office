'use strict';
// Devin Pixel Office renderer: everything is drawn procedurally on a 320x200 canvas
// (no image assets), with a second full-resolution canvas for crisp name tags.

(() => {
  const W = 320;
  const H = 200;
  const T = { thinking: 'Thinking', typing: 'Editing', terminal: 'Running a command', reading: 'Reading code', browsing: 'Browsing the web', delegating: 'Delegating', planning: 'Planning', asking: 'Has a question', waiting: 'Needs your approval', tool: 'Using a tool', done: 'Done', sleeping: 'Idle', summary: (n, w) => `${n} session${n === 1 ? '' : 's'}${w ? ` · ${w} waiting for you` : ''}`, empty: 'No Devin sessions in the last 2 hours. Start one!', notifyOn: 'Notify: on', notifyOff: 'Notify: off', more: (n) => `+${n} more`, reconnect: 'reconnecting…', demo: 'demo', error: 'hit an error' };

  const stage = document.getElementById('stage');
  const px = document.getElementById('px');
  const txt = document.getElementById('txt');
  const g = px.getContext('2d');
  const tg = txt.getContext('2d');
  px.width = W;
  px.height = H;
  let scale = 3;

  function resize() {
    const r = stage.getBoundingClientRect();
    const fit = Math.min(r.width / W, r.height / H);
    scale = fit >= 1 ? Math.floor(fit) : fit;
    const cw = W * scale;
    const ch = H * scale;
    for (const c of [px, txt]) { c.style.width = `${cw}px`; c.style.height = `${ch}px`; }
    const dpr = window.devicePixelRatio || 1;
    txt.width = Math.round(cw * dpr);
    txt.height = Math.round(ch * dpr);
    tg.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- helpers ----------
  const r = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), w, h); };
  function hash(s) {
    let h = 2166136261;
    for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
  }
  const noise = (n) => ((Math.sin(n * 127.1) * 43758.5453) % 1 + 1) % 1;
  const HAIR = ['#2b1d16', '#5a3825', '#d8a657', '#1c1c28', '#a64b2a', '#e8e1d0', '#6b4bd1'];
  const SKIN = ['#f6d0b1', '#e7b48f', '#c98e66', '#a86b4a', '#f2c6a0'];
  const GLYPH = {
    '!': ['1', '1', '1', '0', '1'],
    '?': ['111', '001', '010', '000', '010'],
    Z: ['111', '001', '010', '100', '111'],
    v: ['00001', '00010', '10100', '01000'],
    x: ['101', '010', '101'],
  };
  function glyph(ch, x, y, c) {
    GLYPH[ch].forEach((row, j) => [...row].forEach((b, i) => { if (b === '1') r(x + i, y + j, 1, 1, c); }));
  }
  function line(x0, y0, x1, y1, c) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1;
    for (let i = 0; i <= n; i++) r(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, 1, 1, c);
  }

  // ---------- room ----------
  const SLOTS = [];
  for (const oy of [88, 162]) for (const ox of [30, 104, 178, 252]) SLOTS.push({ ox, oy });
  const DOOR = { x: 6, y: 34 };

  function sky(hour) {
    if (hour >= 7 && hour < 17) return ['#7ec8ff', '#bfe6ff', 'sun'];
    if (hour >= 17 && hour < 20) return ['#ff9a62', '#ffd39a', 'sun'];
    if (hour >= 5 && hour < 7) return ['#9aa7ff', '#ffc3a6', 'sun'];
    return ['#14183a', '#27306a', 'moon'];
  }

  function drawWindow(x, y, now) {
    const d = new Date(now);
    const [top, bottom, body] = sky(d.getHours());
    r(x - 2, y - 2, 60, 34, '#2a2545');
    for (let j = 0; j < 30; j++) r(x, y + j, 56, 1, j < 15 ? top : bottom);
    if (body === 'moon') {
      for (let i = 0; i < 7; i++) if ((Math.floor(now / 900) + i) % 5) r(x + 4 + noise(i + x) * 48, y + 2 + noise(i * 3 + x) * 22, 1, 1, '#ffffff');
      r(x + 40, y + 5, 6, 6, '#f4f1c9');
      r(x + 42, y + 5, 4, 4, top);
    } else {
      r(x + 8, y + 6, 7, 7, '#fff3a3');
      r(x + 30 + ((now / 400) % 40) - 20, y + 18, 14, 4, '#ffffff');
    }
    r(x + 27, y, 2, 30, '#2a2545');
    r(x, y + 14, 56, 2, '#2a2545');
    r(x - 4, y + 30, 64, 3, '#5a5280');
  }

  function drawClock(cx, cy, now) {
    r(cx - 9, cy - 7, 18, 14, '#f5f0e6');
    r(cx - 7, cy - 9, 14, 18, '#f5f0e6');
    r(cx - 8, cy - 8, 16, 16, '#f5f0e6');
    const d = new Date(now);
    const hA = ((d.getHours() % 12) + d.getMinutes() / 60) * (Math.PI / 6);
    const mA = d.getMinutes() * (Math.PI / 30);
    line(cx, cy, Math.round(cx + Math.sin(hA) * 4), Math.round(cy - Math.cos(hA) * 4), '#2a2545');
    line(cx, cy, Math.round(cx + Math.sin(mA) * 7), Math.round(cy - Math.cos(mA) * 7), '#5a5280');
    r(cx, cy, 1, 1, '#ff5d73');
  }

  function drawRoom(now) {
    r(0, 0, W, 56, '#3d3760');
    for (let x = 0; x < W; x += 8) r(x, 0, 1, 54, '#433c68');
    r(0, 53, W, 4, '#2a2545');
    for (let y = 57; y < H; y += 8) {
      r(0, y, W, 8, (y / 8) % 2 ? '#d9b886' : '#d2b07e');
      const off = ((y / 8) % 3) * 23;
      for (let x = off; x < W; x += 64) r(x, y, 1, 8, '#c39f6e');
    }
    drawWindow(40, 12, now);
    drawWindow(224, 12, now);
    drawClock(160, 24, now);
    // poster
    r(118, 12, 24, 30, '#1d1a2e');
    r(121, 15, 18, 12, '#2ee6c5');
    r(125, 19, 10, 4, '#a77bff');
    r(121, 30, 18, 2, '#ff6bb5');
    r(121, 34, 12, 2, '#9a94bf');
    r(178, 12, 24, 30, '#1d1a2e');
    for (let i = 0; i < 4; i++) r(181, 15 + i * 6, 6 + noise(i) * 12, 3, ['#ffd166', '#2ee6c5', '#ff6bb5', '#a77bff'][i]);
    // door
    r(DOOR.x - 2, 20, 20, 36, '#2a2545');
    r(DOOR.x, 22, 16, 34, '#8a5a3b');
    r(DOOR.x + 2, 24, 12, 13, '#9c6a48');
    r(DOOR.x + 2, 40, 12, 13, '#9c6a48');
    r(DOOR.x + 12, 39, 2, 2, '#ffd166');
    // plants and coffee machine
    plant(300, 60);
    plant(8, 176);
    r(298, 120, 18, 26, '#3a3a4c');
    r(301, 124, 12, 8, '#22222e');
    r(304, 134, 6, 6, '#ffffff');
    r(312, 126, 2, 2, (Math.floor(now / 500) % 2) ? '#2ee6c5' : '#1f7f7a');
  }

  function plant(x, y) {
    r(x + 2, y + 10, 10, 9, '#b5543b');
    r(x + 1, y + 9, 12, 2, '#c9674d');
    r(x + 6, y, 2, 10, '#2f7a3e');
    r(x + 2, y + 2, 4, 3, '#3fa152');
    r(x + 8, y + 1, 4, 3, '#3fa152');
    r(x + 3, y + 6, 4, 3, '#4fbf62');
    r(x + 8, y + 5, 3, 3, '#4fbf62');
  }

  // ---------- desks ----------
  function drawMonitor(ox, oy, status, t, ent) {
    const x = ox + 2;
    const y = oy - 17;
    r(x, y, 18, 14, '#2a2a3a');
    r(x + 7, oy - 3, 4, 3, '#2a2a3a');
    const sx = x + 1;
    const sy = y + 1;
    const fill = (c) => r(sx, sy, 16, 11, c);
    const k = Math.floor(t * 3);
    switch (status) {
      case 'terminal':
        fill('#0d1117');
        for (let i = 0; i < 5; i++) r(sx + 1, sy + 1 + i * 2, 2 + Math.floor(noise(i + k + ent.seed) * 12), 1, i === 4 ? '#7ee787' : '#3fb950');
        break;
      case 'typing':
        fill('#1e1e2e');
        for (let i = 0; i < 5; i++) {
          const w = i === 4 ? (k % 10) + 1 : 3 + Math.floor(noise(i + ent.seed) * 11);
          r(sx + 1 + (i % 2) * 2, sy + 1 + i * 2, w, 1, ['#c792ea', '#82aaff', '#c3e88d', '#ffcb6b', '#89ddff'][i]);
        }
        if (k % 2) r(sx + 2 + (k % 10) + 1, sy + 9, 1, 1, '#ffffff');
        break;
      case 'reading':
        fill('#1e1e2e');
        for (let i = 0; i < 5; i++) r(sx + 1, sy + 1 + i * 2, 4 + Math.floor(noise(i * 7 + ent.seed) * 10), 1, '#6c7086');
        r(sx, sy + 1 + (k % 5) * 2, 16, 1, '#f9e2af');
        break;
      case 'browsing':
        fill('#eef4ff');
        r(sx, sy, 16, 2, '#4a7dff');
        r(sx + 5, sy + 3, 6, 6, '#3ccf91');
        r(sx + 6, sy + 4, 2, 2, '#2a8fd6');
        r(sx + 9, sy + 6, 2, 2, '#2a8fd6');
        r(sx + 2, sy + 10 - (k % 2), 12, 1, '#b8c6e8');
        break;
      case 'planning':
        fill('#fbfbf7');
        for (let i = 0; i < 4; i++) {
          r(sx + 1, sy + 1 + i * 3, 2, 2, i < (k % 5) ? '#2ee6c5' : '#c8c8d0');
          r(sx + 4, sy + 1 + i * 3, 8 + (i % 2) * 3, 1, '#8a8aa0');
        }
        break;
      case 'delegating':
        fill('#1e1e2e');
        r(sx + 2, sy + 3, 3, 5, '#a77bff');
        r(sx + 11, sy + 3, 3, 5, '#2ee6c5');
        for (let i = 0; i < 4; i++) r(sx + 5 + ((i + k) % 6), sy + 5, 1, 1, '#ffffff');
        break;
      case 'waiting':
      case 'asking':
        fill(k % 2 ? '#5a1626' : '#3a1520');
        glyph(status === 'waiting' ? '!' : '?', status === 'waiting' ? sx + 7 : sx + 6, sy + 3, '#ffffff');
        break;
      case 'thinking':
      case 'tool':
        fill('#1e1e2e');
        for (let i = 0; i < 3; i++) r(sx + 4 + i * 3, sy + 5, 2, 2, i === k % 3 ? '#ffffff' : '#585b70');
        break;
      case 'done':
        fill('#13221f');
        glyph('v', sx + 5, sy + 3, '#2ee6c5');
        break;
      default:
        fill('#151522');
    }
  }

  function drawDesk(ox, oy) {
    r(ox, oy, 44, 12, '#8a5a3b');
    r(ox, oy, 44, 2, '#a5704d');
    r(ox, oy + 12, 44, 10, '#6d4630');
    r(ox + 2, oy + 22, 3, 3, '#4d3122');
    r(ox + 39, oy + 22, 3, 3, '#4d3122');
    r(ox + 23, oy + 6, 14, 3, '#3a3a4c'); // keyboard
  }

  function drawChair(ox, oy) {
    r(ox + 22, oy - 18, 16, 16, '#38344f');
    r(ox + 23, oy - 17, 14, 2, '#46416a');
  }

  // ---------- characters ----------
  function look(id) {
    const h = hash(id);
    return {
      hair: HAIR[h % HAIR.length],
      skin: SKIN[(h >> 4) % SKIN.length],
      shirt: `hsl(${(h >> 8) % 360} 62% 56%)`,
      shirtDark: `hsl(${(h >> 8) % 360} 55% 42%)`,
      pants: '#2f3550',
      seed: (h % 97) / 7,
    };
  }

  function drawHead(x, y, lk, { blink, down, smile } = {}) {
    const dy = down ? 3 : 0;
    r(x + 1, y + dy, 10, 3, lk.hair);
    r(x, y + 1 + dy, 1, 4, lk.hair);
    r(x + 11, y + 1 + dy, 1, 4, lk.hair);
    r(x + 1, y + 3 + dy, 10, 6, lk.skin);
    r(x + 1, y + 3 + dy, 10, 1, lk.hair);
    if (blink || down) {
      r(x + 3, y + 5 + dy, 2, 1, '#2a2030');
      r(x + 7, y + 5 + dy, 2, 1, '#2a2030');
    } else {
      r(x + 3, y + 5, 1, 2, '#2a2030');
      r(x + 8, y + 5, 1, 2, '#2a2030');
    }
    if (smile) r(x + 5, y + 7 + dy, 2, 1, '#c0566b');
  }

  /** Seated body (behind the desk). Pose-specific arms that rest on the desk are drawn later. */
  function drawSeated(ox, oy, ent, status, t) {
    const x = ox + 24;
    const y = oy - 22;
    const lk = ent.look;
    const blink = (Math.floor(t * 10 + lk.seed * 13) % 37) === 0;
    r(x + 1, y + 9, 10, 9, lk.shirt);
    r(x + 5, y + 9, 2, 2, '#ffffff');
    if (status === 'waiting' || status === 'asking') {
      const up = Math.floor(t * 4) % 2;
      r(x + 11, y - 3 - up, 2, 13, lk.shirtDark);
      r(x + 11, y - 5 - up, 2, 2, lk.skin);
    }
    drawHead(x, y, lk, { blink, down: status === 'sleeping', smile: status === 'done' });
  }

  function drawOnDesk(ox, oy, ent, status, t) {
    const x = ox + 24;
    const lk = ent.look;
    const k = Math.floor(t * 8);
    if (status === 'typing' || status === 'terminal') {
      r(x - 1, oy - 6, 2, 7, lk.shirtDark);
      r(x + 11, oy - 6, 2, 7, lk.shirtDark);
      r(x + (k % 2 ? 0 : 1), oy + 3, 3, 2, lk.skin);
      r(x + 9 + (k % 2 ? 1 : 0), oy + 3 - (k % 3 === 0 ? 1 : 0), 3, 2, lk.skin);
    } else if (status === 'reading') {
      r(x - 1, oy - 6, 2, 6, lk.shirtDark);
      r(x + 11, oy - 6, 2, 6, lk.shirtDark);
      r(x, oy - 4, 12, 7, '#c0392b');
      r(x + 1, oy - 3, 4, 5, '#fdf6e3');
      r(x + 7, oy - 3, 4, 5, '#fdf6e3');
    } else if (status === 'sleeping') {
      r(x - 2, oy - 3, 16, 4, lk.shirtDark);
    } else if (status === 'done') {
      r(x - 1, oy - 6, 2, 7, lk.shirtDark);
      r(x + 15, oy - 3, 4, 5, '#ffffff');
      r(x + 19, oy - 2, 1, 2, '#ffffff');
      r(x + 16, oy - 2, 2, 1, '#6f4e37');
      if (Math.floor(t * 2) % 2) r(x + 16, oy - 6, 1, 2, '#e6e6f0');
    } else if (status !== 'waiting' && status !== 'asking') {
      r(x - 1, oy - 6, 2, 6, lk.shirtDark);
      r(x + 11, oy - 6, 2, 6, lk.shirtDark);
    }
  }

  function bubble(cx, top, fill, draw) {
    r(cx - 7, top, 14, 9, fill);
    r(cx - 8, top + 1, 16, 7, fill);
    r(cx - 1, top + 9, 2, 2, fill);
    draw(cx, top);
  }

  function drawBubble(ox, oy, s, t, now) {
    const cx = ox + 30;
    const top = oy - 36;
    const bob = Math.floor(t * 3) % 2;
    switch (s.status) {
      case 'thinking':
        if (s.error) {
          for (let i = 0; i < 3; i++) r(cx - 4 + i * 4, top + 4 - ((Math.floor(t * 6) + i * 2) % 6), 3, 3, '#9a94bf');
          bubble(cx + 9, top - 4, '#ff5d73', (x, y) => glyph('x', x - 1, y + 3, '#ffffff'));
        } else {
          bubble(cx, top, '#ffffff', (x, y) => { for (let i = 0; i < 3; i++) r(x - 5 + i * 4, y + 4, 2, 2, i === Math.floor(t * 3) % 3 ? '#2a2545' : '#b4aed6'); });
        }
        break;
      case 'waiting':
        bubble(cx, top - bob, '#ff5d73', (x, y) => glyph('!', x, y + 2, '#ffffff'));
        break;
      case 'asking':
        bubble(cx, top - bob, '#ffd166', (x, y) => glyph('?', x - 1, y + 2, '#2a2545'));
        break;
      case 'sleeping':
        for (let i = 0; i < 3; i++) {
          const p = ((t * 0.6 + i / 3) % 1);
          glyph('Z', cx + 4 + p * 10, top + 8 - p * 14, `rgba(255,255,255,${(1 - p).toFixed(2)})`);
        }
        break;
      case 'done':
        if (now - s.since < 30_000) bubble(cx, top - bob, '#2ee6c5', (x, y) => glyph('v', x - 2, y + 2, '#08201c'));
        break;
      default:
    }
  }

  function drawStanding(x, y, lk, t) {
    const step = Math.floor(t * 8) % 2;
    drawHead(x, y, lk, {});
    r(x + 1, y + 9, 10, 8, lk.shirt);
    r(x - 1, y + 10, 2, 6, lk.shirtDark);
    r(x + 11, y + 10, 2, 6, lk.shirtDark);
    r(x + 2, y + 17, 3, 5 - step, lk.pants);
    r(x + 7, y + 17, 3, 4 + step, lk.pants);
  }

  // ---------- world state ----------
  const ents = new Map(); // id -> { slot, look, seed, phase: 'in'|'seated'|'out', t0, from, to }
  let snapshot = { now: Date.now(), sessions: [] };
  let selected = null;

  function seatPos(slot) {
    const s = SLOTS[slot];
    return { x: s.ox + 24, y: s.oy - 22 };
  }

  function path(a, b) {
    // along the corridor under the wall, then down to the chair
    return [a, { x: b.x, y: a.y }, b];
  }

  function along(points, d) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (d <= len) return { x: a.x + ((b.x - a.x) * d) / (len || 1), y: a.y + ((b.y - a.y) * d) / (len || 1), done: false };
      d -= len;
    }
    const last = points[points.length - 1];
    return { ...last, done: true };
  }

  const pathLength = (pts) => pts.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);
  const SPEED = 70; // px per second
  const DOOR_POS = { x: DOOR.x + 2, y: 36 };

  function apply(snap) {
    snapshot = snap;
    const ids = new Set(snap.sessions.map((s) => s.id));
    for (const [id, e] of ents) {
      if (!ids.has(id) && e.phase !== 'out') {
        const from = seatPos(e.slot);
        e.phase = 'out';
        e.t0 = performance.now();
        e.path = [from, { x: from.x, y: DOOR_POS.y }, DOOR_POS]; // up to the corridor, then out the door
      }
    }
    for (const s of snap.sessions) {
      if (ents.has(s.id) && ents.get(s.id).phase !== 'out') continue;
      const used = new Set([...ents.values()].map((e) => e.slot)); // a leaving character keeps its desk until it is out
      const slot = SLOTS.findIndex((_, i) => !used.has(i));
      if (slot < 0) continue;
      const lk = look(s.id);
      const first = !document.body.dataset.started;
      ents.set(s.id, { slot, look: lk, seed: lk.seed, phase: first ? 'seated' : 'in', t0: performance.now(), path: path(DOOR_POS, seatPos(slot)) });
    }
    document.body.dataset.started = '1';
    renderList();
    notifyChanges(snap);
  }

  // ---------- frame ----------
  function frame(ts) {
    const t = ts / 1000;
    const now = snapshot.now + (Date.now() - (snapshot.receivedAt || Date.now()));
    drawRoom(Date.now());
    const byId = new Map(snapshot.sessions.map((s) => [s.id, s]));
    const walkers = [];
    for (const [id, e] of ents) {
      if (e.phase === 'seated') continue;
      const p = along(e.path, ((ts - e.t0) / 1000) * SPEED);
      if (p.done) {
        if (e.phase === 'in') e.phase = 'seated';
        else { ents.delete(id); continue; }
      } else walkers.push({ e, p });
    }
    for (let i = 0; i < SLOTS.length; i++) {
      const { ox, oy } = SLOTS[i];
      const entry = [...ents.entries()].find(([, e]) => e.slot === i && e.phase === 'seated');
      const s = entry && byId.get(entry[0]);
      const status = s ? s.status : 'off';
      if (s && (status === 'waiting' || status === 'asking')) {
        g.globalAlpha = 0.25 + 0.2 * Math.sin(t * 6);
        r(ox - 4, oy - 26, 52, 54, status === 'waiting' ? '#ff5d73' : '#ffd166');
        g.globalAlpha = 1;
      }
      if (s && selected === s.id) {
        g.globalAlpha = 0.18;
        r(ox - 4, oy - 26, 52, 54, '#2ee6c5');
        g.globalAlpha = 1;
      }
      drawChair(ox, oy);
      if (s) drawSeated(ox, oy, entry[1], status, t);
      drawDesk(ox, oy);
      drawMonitor(ox, oy, s ? status : 'off', t, entry ? entry[1] : { seed: i });
      if (s) {
        drawOnDesk(ox, oy, entry[1], status, t);
        drawBubble(ox, oy, s, t, now);
      }
    }
    walkers.sort((a, b) => a.p.y - b.p.y).forEach(({ e, p }) => drawStanding(p.x, p.y, e.look, t));
    drawLabels(byId);
    requestAnimationFrame(frame);
  }

  function drawLabels(byId) {
    tg.clearRect(0, 0, W, H);
    tg.textAlign = 'center';
    tg.textBaseline = 'middle';
    tg.font = '600 5px -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans CJK SC", sans-serif';
    for (const [id, e] of ents) {
      if (e.phase !== 'seated') continue;
      const s = byId.get(id);
      if (!s) continue;
      const { ox, oy } = SLOTS[e.slot];
      const label = clip(s.title, 16);
      const w = Math.min(64, tg.measureText(label).width + 6);
      tg.fillStyle = 'rgba(20,18,31,0.78)';
      roundRect(ox + 22 - w / 2, oy + 27, w, 8, 3);
      tg.fillStyle = s.status === 'waiting' || s.status === 'asking' ? '#ff8a9a' : '#ffffff';
      tg.fillText(label, ox + 22, oy + 31.2, 62);
    }
    const hidden = snapshot.sessions.length - [...ents.values()].filter((e) => e.phase !== 'out').length;
    if (hidden > 0) {
      tg.fillStyle = '#ffffff';
      tg.textAlign = 'right';
      tg.fillText(T.more(hidden), W - 6, H - 6);
    }
    if (!snapshot.sessions.length) {
      tg.fillStyle = 'rgba(20,18,31,0.8)';
      roundRect(60, 120, 200, 18, 4);
      tg.fillStyle = '#ffffff';
      tg.textAlign = 'center';
      tg.font = '600 6px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
      tg.fillText(T.empty, 160, 129.5, 192);
    }
  }

  function roundRect(x, y, w, h, rad) {
    tg.beginPath();
    tg.roundRect ? tg.roundRect(x, y, w, h, rad) : tg.rect(x, y, w, h);
    tg.fill();
  }

  function clip(s, n) {
    const a = [...String(s)];
    return a.length > n ? `${a.slice(0, n - 1).join('')}…` : a.join('');
  }

  // ---------- side panel ----------
  const list = document.getElementById('list');
  const summary = document.getElementById('summary');

  function ago(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    return `${Math.floor(s / 3600)}h`;
  }

  function renderList() {
    const sessions = snapshot.sessions;
    const waiting = sessions.filter((s) => s.status === 'waiting' || s.status === 'asking').length;
    summary.textContent = T.summary(sessions.length, waiting) + (snapshot.demo ? ` · ${T.demo}` : '');
    document.title = `${waiting ? `(${waiting}) ` : ''}Devin Pixel Office`;
    if (!sessions.length) {
      list.innerHTML = `<div class="empty">${escapeHtml(T.empty)}</div>`;
      return;
    }
    const order = { waiting: 0, asking: 0 };
    const sorted = [...sessions].sort((a, b) => (order[a.status] ?? 1) - (order[b.status] ?? 1) || b.lastActivity - a.lastActivity);
    list.innerHTML = sorted.map((s) => {
      const lk = look(s.id);
      const label = s.error && s.status === 'thinking' ? T.error : T[s.status] || s.status;
      const meta = [s.project, s.detail].filter(Boolean).join(' · ');
      return `<div class="item${selected === s.id ? ' sel' : ''}" data-id="${escapeHtml(s.id)}">
        <div class="dot" style="background:${lk.shirt}"></div>
        <div class="title" title="${escapeHtml(s.title)}">${escapeHtml(s.title)}</div>
        <div class="age">${ago(Date.now() - (s.since || s.lastActivity))}</div>
        <div class="meta"><span class="chip ${s.status}">${escapeHtml(label)}</span>${escapeHtml(meta)}</div>
      </div>`;
    }).join('');
  }

  list.addEventListener('click', (ev) => {
    const item = ev.target.closest('.item');
    if (!item) return;
    selected = selected === item.dataset.id ? null : item.dataset.id;
    renderList();
  });

  txt.addEventListener('click', (ev) => {
    const b = txt.getBoundingClientRect();
    const x = ((ev.clientX - b.left) / b.width) * W;
    const y = ((ev.clientY - b.top) / b.height) * H;
    for (const [id, e] of ents) {
      const { ox, oy } = SLOTS[e.slot];
      if (x >= ox - 4 && x <= ox + 48 && y >= oy - 30 && y <= oy + 36) { selected = selected === id ? null : id; renderList(); return; }
    }
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- notifications ----------
  const notifyBtn = document.getElementById('notify');
  let notifyOn = localStorage.getItem('dpo-notify') === '1';
  const prev = new Map();
  if ('Notification' in window) {
    notifyBtn.hidden = false;
    const paint = () => { notifyBtn.textContent = notifyOn ? T.notifyOn : T.notifyOff; };
    paint();
    notifyBtn.onclick = async () => {
      if (!notifyOn && Notification.permission !== 'granted') await Notification.requestPermission();
      notifyOn = !notifyOn && Notification.permission === 'granted';
      localStorage.setItem('dpo-notify', notifyOn ? '1' : '0');
      paint();
    };
  }

  function notifyChanges(snap) {
    for (const s of snap.sessions) {
      const before = prev.get(s.id);
      if (notifyOn && before && before !== s.status && ['waiting', 'asking', 'done'].includes(s.status) && Notification.permission === 'granted') {
        new Notification(`Devin · ${T[s.status]}`, { body: s.title, tag: s.id });
      }
      prev.set(s.id, s.status);
    }
  }

  // ---------- data ----------
  function connect() {
    const es = new EventSource('events');
    es.onmessage = (ev) => {
      const snap = JSON.parse(ev.data);
      snap.receivedAt = Date.now();
      apply(snap);
    };
    es.onerror = () => { summary.textContent = T.reconnect; };
  }
  setInterval(renderList, 5000);
  connect();
  requestAnimationFrame(frame);
})();
