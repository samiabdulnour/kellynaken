// Serves the site from docs/ and runs the play-together rounds.
//   node server.mjs            (PORT defaults to 8080)
// No dependencies. One shared room: the two kids join as "ken" and "kel" and take on the bosses from
// config.json one after another. The page listens on a server-sent event stream and posts its moves back.
// Three kinds of round:
//   drums  repeat the boss's rhythm; each kid owns two of the four pads
//   surf   a runner: both surf the same wave, jump the sharks, stay low under boomerangs, share the lives
//   chase  both run around one room collecting flowers while the boss chases them
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(here, 'docs');
const cfg = JSON.parse(fs.readFileSync(path.join(here, 'config.json'), 'utf8'));
const coop = cfg.coop || {};
const env = (k) => Number(process.env[k]) || 0;      // COOP_SECONDS, COOP_ROUNDS, COOP_TARGET shorten a round for testing; COOP_STAGE starts at a later boss
const PORT = env('PORT') || 8080;
const WHO = ['ken', 'kel'];
const PAD_OWNER = ['ken', 'ken', 'kel', 'kel'];
const ROOM = { w: 360, h: 400, top: 74 };            // the chase room, in the page's canvas units
const has = (file) => fs.existsSync(path.join(SITE, file));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const FIRST_STAGE = env('COOP_STAGE');
const BOSSES = (coop.bosses && coop.bosses.length ? coop.bosses : [{ id: 'boss', name: 'Boss', kind: 'drums' }]).map((b) => {
  const full = { kind: 'drums', tip: '', rounds: 4, first: 3, lives: 4, target: 18, flowers: 5, penalty: 1, ease: 2, speed: [80, 128], freeze: 2.2, seconds: 70, ...b };
  if (env('COOP_SECONDS')) full.seconds = env('COOP_SECONDS');
  if (env('COOP_ROUNDS')) full.rounds = env('COOP_ROUNDS');
  if (env('COOP_TARGET')) full.target = env('COOP_TARGET');
  full.faces = ['', 'cool', 'serious', 'happy'].filter((v) => has(`boss-${full.id}${v ? '-' + v : ''}.jpg`));   // which photos exist
  full.cameo = full.cameo ? { name: full.cameo.name, files: (full.cameo.files || []).filter((f) => has(f + '.jpg')) } : null;   // a friend who dashes through
  return full;
});

const streams = { ken: new Set(), kel: new Set() };
const room = { n: 0, fails: {} };
const isHere = (who) => streams[who].size > 0;
const boss = () => BOSSES[room.stage];
const say = (ev) => { room.ev = [...room.ev, { n: ++room.n, ...ev }].slice(-10); };

function loadBoss() {
  const b = boss(), fails = room.fails[room.stage] || 0;      // a round that beat you comes back a little kinder
  Object.assign(room, { left: b.seconds, drum: null, surf: null, chase: null });
  room.best = Math.max(room.best, room.stage);
  if (b.kind === 'drums') {
    room.hp = room.max = b.rounds;
    room.drum = { round: 0, pattern: [], pos: 0, mode: 'pause', step: -1, showId: 0, t: 0.3, fresh: true };
  } else if (b.kind === 'surf') {
    room.hp = room.max = Math.min(7, b.lives + fails);
    const gifts = surfGifts(b);
    room.surf = { t: 0, obs: surfCourse(b, gifts), gifts, hit: { ken: new Set(), kel: new Set() }, jumped: { ken: 0, kel: 0 } };
  } else {
    const target = Math.max(8, b.target - b.ease * fails);
    room.hp = room.max = target;
    room.chase = { l: { x: 180, y: 130 }, p: { ken: { x: 110, y: 330 }, kel: { x: 250, y: 330 } }, frozen: { ken: 0, kel: 0 }, grace: { ken: 0, kel: 0 }, items: [], id: 0, happy: 0, target, rest: 1.5, shout: 0 };
    while (room.chase.items.length < b.flowers) spawnFlower();
  }
}
function reset() {
  Object.assign(room, { phase: 'lobby', stage: Math.min(FIRST_STAGE, BOSSES.length - 1), best: -1, count: 0, pause: 0, hits: { ken: 0, kel: 0 }, ev: [], fails: {} });
  loadBoss(); room.best = -1;
}
reset();

function snapshot() {
  const b = boss(), d = room.drum, s = room.surf, c = room.chase, inLobby = room.phase === 'lobby';
  return JSON.stringify({
    phase: room.phase, here: { ken: isHere('ken'), kel: isHere('kel') },
    stage: room.stage, total: BOSSES.length,
    seen: BOSSES.slice(0, room.best + 1).map((x) => x.name),            // names stay hidden until a boss has appeared
    boss: inLobby ? null : { id: b.id, name: b.name, faces: b.faces, kind: b.kind, tip: b.tip, cameo: b.cameo },
    hp: room.hp, max: room.max, left: Math.max(0, Math.ceil(room.left)), count: Math.ceil(room.count), hits: room.hits, ev: room.ev,
    ...(d && !inLobby ? { drum: { mode: d.mode, len: d.pattern.length, pos: d.pos, round: d.round, showId: d.showId, step: d.step, pad: d.mode === 'show' && d.step >= 0 ? d.pattern[d.step] : -1 } } : {}),
    ...(s && !inLobby ? { surf: { t: Math.round(s.t * 100) / 100, total: b.seconds, obs: s.obs, pass: PASS, gifts: s.gifts.map((g) => [g.t, g.got ? 1 : 0]) } } : {}),
    ...(c && !inLobby ? { chase: { l: [Math.round(c.l.x), Math.round(c.l.y)], p: Object.fromEntries(WHO.map((w) => [w, [Math.round(c.p[w].x), Math.round(c.p[w].y), c.frozen[w] > 0 ? 1 : 0]])), items: c.items.map((i) => [i.id, i.x, i.y]), happy: c.happy, target: c.target, shout: c.shout > 0 } } : {}),
    ...(room.phase === 'won' ? { win: { heading: '', lines: [], ...(coop.win || {}), photo: has('truhla.jpg') } } : {}),
  });
}
function broadcast() {
  const msg = `data: ${snapshot()}\n\n`;
  for (const who of WHO) for (const res of streams[who]) res.write(msg);
}

// Start, retry the boss that beat you, or play again from the first boss after a win.
function start() {
  if (!['lobby', 'won', 'lost'].includes(room.phase) || !isHere('ken') || !isHere('kel')) return false;
  if (room.phase !== 'lost') { room.stage = Math.min(FIRST_STAGE, BOSSES.length - 1); room.hits = { ken: 0, kel: 0 }; room.fails = {}; }
  loadBoss();
  room.phase = 'count'; room.count = 3;
  broadcast(); return true;
}
function bossDown() {
  if (room.stage === BOSSES.length - 1) room.phase = 'won';
  else { room.phase = 'down'; room.pause = 2.8; }
}
function lose() { room.phase = 'lost'; room.fails[room.stage] = (room.fails[room.stage] || 0) + 1; }

// ---- drums: the boss plays a pattern on four pads, the kids repeat it in the same order ----
function drumPattern(len) {
  const p = [];
  while (p.length < len) {
    const pad = Math.floor(Math.random() * 4), n = p.length;
    if (n >= 2 && p[n - 1] === pad && p[n - 2] === pad) continue;      // never the same pad three times running
    if (n >= 1 && p[n - 1] === pad && Math.random() < 0.6) continue;
    p.push(pad);
  }
  if (!p.some((x) => x < 2)) p[0] = Math.floor(Math.random() * 2);                    // both kids always have something to play
  if (!p.some((x) => x >= 2)) p[p.length - 1] = 2 + Math.floor(Math.random() * 2);
  return p;
}
function drumShow(fresh) {
  const d = room.drum;
  if (fresh) d.pattern = drumPattern(boss().first + d.round);
  Object.assign(d, { pos: 0, mode: 'show', step: -1, t: 0.9, fresh: false, showId: d.showId + 1 });
}
function drumTick(dt) {
  const d = room.drum;
  if ((d.t -= dt) > 0) return;
  if (d.mode === 'pause') drumShow(d.fresh);
  else if (d.mode === 'show') { d.step++; if (d.step >= d.pattern.length) { d.mode = 'input'; d.step = -1; } else d.t = 0.62; }
}
function drum(who, pad) {
  const d = room.drum;
  if (room.phase !== 'play' || !d || d.mode !== 'input' || PAD_OWNER[pad] !== who) return false;
  if (pad !== d.pattern[d.pos]) { say({ who, pad, wrong: true }); Object.assign(d, { mode: 'pause', t: 1.3, fresh: false }); broadcast(); return true; }
  d.pos++;
  say({ who, pad });
  if (d.pos === d.pattern.length) {
    room.hp--; room.hits[who]++;
    say({ who, dmg: 1 });
    if (room.hp === 0) bossDown();
    else { d.round++; Object.assign(d, { mode: 'pause', t: 1.3, fresh: true }); }
  }
  broadcast(); return true;
}

// ---- surf: obstacles are fixed moments on a shared clock, so both phones see the same wave ----
// The friend dashes through on a fixed beat and throws a heart each time: jump to catch it and win a life back.
const PASS = { first: 4.2, every: 8.5, len: 3.6, throwAt: 2.1 };
function surfGifts(b) {
  const gifts = [];
  if (b.cameo && b.cameo.files.length) for (let start = PASS.first; start <= b.seconds - 7; start += PASS.every) gifts.push({ t: Math.round((start + PASS.throwAt) * 100) / 100, got: false });
  return gifts;
}
function surfCourse(b, gifts) {
  const obs = [];
  let t = 3.4;
  while (t < b.seconds - 3) {
    const near = gifts.find((g) => Math.abs(g.t - t) < 1.05);          // keep the water clear around a heart
    if (near) { t = near.t + 1.1; continue; }                         // lands clearly outside the window, so this cannot loop
    obs.push({ t: Math.round(t * 100) / 100, k: obs.length > 1 && Math.random() < 0.3 ? 1 : 0 });   // k 0: a shark to jump, 1: a boomerang to stay under
    t += Math.max(1.08, (2.0 - (t / b.seconds) * 0.8) * (0.75 + Math.random() * 0.5));
  }
  return obs;
}
function surfTick(dt, b) {
  room.surf.t += dt;
  room.left = b.seconds - room.surf.t;
  if (room.surf.t >= b.seconds) bossDown();
}
function crash(who, i) {
  const s = room.surf;
  if (room.phase !== 'play' || !s || !Number.isInteger(i) || !s.obs[i] || s.hit[who].has(i)) return false;
  if (Math.abs(s.obs[i].t - s.t) > 1.5) return false;                 // only an obstacle that is actually passing
  s.hit[who].add(i);
  room.hp = Math.max(0, room.hp - 1);
  say({ who, crash: true });
  if (room.hp === 0) lose();
  broadcast(); return true;
}
function gift(who, i) {
  const s = room.surf;
  if (room.phase !== 'play' || !s || !Number.isInteger(i) || !s.gifts[i] || s.gifts[i].got || Math.abs(s.gifts[i].t - s.t) > 1.5) return false;
  s.gifts[i].got = true;
  room.hp = Math.min(7, room.hp + 1); room.max = Math.max(room.max, room.hp);
  room.hits[who]++;
  say({ who, gift: true });
  broadcast(); return true;
}
function jump(who) {
  const s = room.surf, now = Date.now();
  if (room.phase !== 'play' || !s || now - s.jumped[who] < 250) return false;
  s.jumped[who] = now;
  say({ who, jump: true });
  broadcast(); return true;
}

// ---- chase: both kids run around one room picking flowers while the boss chases whoever is nearest ----
function spawnFlower() {
  const c = room.chase;
  for (let tries = 0; tries < 20; tries++) {
    const x = Math.round(28 + Math.random() * (ROOM.w - 56)), y = Math.round(ROOM.top + 22 + Math.random() * (ROOM.h - ROOM.top - 44));
    if (Math.hypot(x - c.l.x, y - c.l.y) < 70 && tries < 19) continue;
    if (c.items.some((i) => Math.hypot(x - i.x, y - i.y) < 44) && tries < 19) continue;
    c.items.push({ id: ++c.id, x, y }); return;
  }
}
function move(who, x, y) {
  const c = room.chase;
  if (room.phase !== 'play' || !c || c.frozen[who] > 0 || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  c.p[who] = { x: clamp(x, 14, ROOM.w - 14), y: clamp(y, ROOM.top, ROOM.h - 12) };
  return true;
}
function chaseTick(dt, b) {
  const c = room.chase;
  for (const w of WHO) {
    if (c.frozen[w] > 0) { c.frozen[w] -= dt; if (c.frozen[w] <= 0) c.grace[w] = 1.6; }      // just released: a short head start
    else if (c.grace[w] > 0) c.grace[w] -= dt;
  }
  if (c.shout > 0) c.shout -= dt;
  let picked = false;
  for (const w of WHO) {
    if (!isHere(w) || c.frozen[w] > 0) continue;
    for (const it of c.items) if (!it.gone && Math.hypot(it.x - c.p[w].x, it.y - c.p[w].y) < 26) { it.gone = picked = true; c.happy++; room.hits[w]++; say({ who: w, got: true }); }
  }
  if (picked) {
    c.items = c.items.filter((i) => !i.gone);
    while (c.items.length < b.flowers) spawnFlower();
    room.hp = Math.max(0, c.target - c.happy);
    if (c.happy >= c.target) return bossDown();
  }
  if (c.rest > 0) { c.rest -= dt; return; }
  const far = (w) => Math.hypot(c.p[w].x - c.l.x, c.p[w].y - c.l.y);
  const prey = WHO.filter((w) => isHere(w) && c.frozen[w] <= 0 && c.grace[w] <= 0).sort((a, z) => far(a) - far(z))[0];
  if (!prey) return;
  const p = c.p[prey], d = far(prey);
  if (d < 28) {                                                   // caught: a moment in the chair, and one flower wilts
    c.frozen[prey] = b.freeze; c.rest = 1.0; c.shout = 1.8;
    c.happy = Math.max(0, c.happy - b.penalty); room.hp = c.target - c.happy;
    say({ who: prey, caught: true });
    return;
  }
  const speed = b.speed[0] + (c.happy / c.target) * (b.speed[1] - b.speed[0]);
  c.l.x += ((p.x - c.l.x) / d) * Math.min(d, speed * dt);
  c.l.y += ((p.y - c.l.y) / d) * Math.min(d, speed * dt);
}

const TICK = 50;
let sinceSend = 0;
setInterval(() => {
  const dt = TICK / 1000, b = boss();
  if (room.phase === 'count') { room.count -= dt; if (room.count <= 0) room.phase = 'play'; }
  else if (room.phase === 'down') {
    room.pause -= dt;
    if (room.pause <= 0) { room.stage++; loadBoss(); room.phase = 'count'; room.count = 3; }
  } else if (room.phase === 'play') {
    if (b.kind === 'surf') surfTick(dt, b);
    else {
      room.left -= dt;
      if (b.kind === 'drums') drumTick(dt); else chaseTick(dt, b);
      if (room.phase === 'play' && room.left <= 0) lose();
    }
  }
  sinceSend += TICK;
  const busy = ['count', 'play', 'down'].includes(room.phase);
  if (sinceSend >= (busy ? 100 : 3000)) { sinceSend = 0; broadcast(); }
}, TICK);
setInterval(() => { for (const who of WHO) for (const res of streams[who]) res.write(': ping\n\n'); }, 15000);

// ---- http ----
const CORS = { 'Access-Control-Allow-Origin': '*' };
const MIME = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ico': 'image/x-icon' };
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS }); res.end(JSON.stringify(obj)); };
function readBody(req, done) {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 2000) req.destroy(); });
  req.on('end', () => { let b = {}; try { b = JSON.parse(body || '{}'); } catch (e) {} done(b && typeof b === 'object' ? b : {}); });
}
function serveFile(res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { res.writeHead(400); return res.end('Bad request'); }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(SITE, path.normalize(rel));
  if (!file.startsWith(SITE + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' });
    res.end(buf);
  });
}
const MOVES = {
  start: () => start(),
  drum: (b) => [0, 1, 2, 3].includes(b.pad) && drum(b.who, b.pad),
  crash: (b) => crash(b.who, b.i),
  gift: (b) => gift(b.who, b.i),
  jump: (b) => jump(b.who),
  move: (b) => move(b.who, b.x, b.y),
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/coop/ping') return json(res, 200, { ok: true, total: BOSSES.length });
  if (url.pathname === '/coop/stream' && req.method === 'GET') {
    const who = url.searchParams.get('who');
    if (!WHO.includes(who)) return json(res, 400, { error: 'who must be ken or kel' });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...CORS });
    res.write('retry: 1500\n\n');
    streams[who].add(res);
    broadcast();
    req.on('close', () => {
      streams[who].delete(res);
      if (!isHere('ken') && !isHere('kel')) reset();     // everyone left: clear the round
      broadcast();
    });
    return;
  }
  const action = MOVES[url.pathname.replace('/coop/', '')];
  if (url.pathname.startsWith('/coop/') && action && req.method === 'POST') {
    return readBody(req, (b) => json(res, 200, { ok: (url.pathname === '/coop/start' || WHO.includes(b.who)) && !!action(b) }));
  }
  if (url.pathname.startsWith('/coop/')) return json(res, 404, { error: 'unknown' });
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveFile(res, url.pathname);
}).listen(PORT, () => console.log(`Tajné operace on http://localhost:${PORT} (${BOSSES.map((b) => `${b.name}: ${b.kind}`).join(', ')})`));
