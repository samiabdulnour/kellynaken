// Serves the site from docs/ and runs the play-together rounds.
//   node server.mjs            (PORT defaults to 8080)
// No dependencies. One shared room: the two kids join as "ken" and "kel" and take on the bosses from
// config.json one after another. The page listens on a server-sent event stream and posts its moves back.
// Two kinds of round: "drums" (repeat the boss's rhythm, each kid owns two pads) and "fight" (both tap the
// boss, one shared health bar, hits close together count triple).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(here, 'docs');
const cfg = JSON.parse(fs.readFileSync(path.join(here, 'config.json'), 'utf8'));
const coop = cfg.coop || {};
const env = (k) => Number(process.env[k]) || 0;      // COOP_SECONDS, COOP_HP, COOP_ROUNDS shorten a round for testing
const PORT = env('PORT') || 8080;
const COMBO_MS = 1200;          // two hits this close together count as a combo
const WHO = ['ken', 'kel'];
const PAD_OWNER = ['ken', 'ken', 'kel', 'kel'];
const other = (who) => (who === 'ken' ? 'kel' : 'ken');
const BOSSES = (coop.bosses && coop.bosses.length ? coop.bosses : [{ id: 'boss', name: 'Boss' }]).map((b) => {
  const full = { kind: 'fight', theme: '', blurb: '', tip: '', speed: [70, 130], hp: 40, rounds: 4, first: 3, seconds: coop.seconds || 70, ...b };
  if (env('COOP_SECONDS')) full.seconds = env('COOP_SECONDS');
  if (env('COOP_HP')) full.hp = env('COOP_HP');
  if (env('COOP_ROUNDS')) full.rounds = env('COOP_ROUNDS');
  full.photo = fs.existsSync(path.join(SITE, `boss-${full.id}.jpg`));
  return full;
});

const streams = { ken: new Set(), kel: new Set() };
const room = { n: 0, fails: {} };
const isHere = (who) => streams[who].size > 0;
const boss = () => BOSSES[room.stage];
const say = (ev) => { room.ev = [...room.ev, { n: ++room.n, ...ev }].slice(-8); };

function loadBoss() {
  const b = boss();
  const tired = Math.max(0.5, 1 - 0.12 * (room.fails[room.stage] || 0));     // a boss that beat you comes back a little weaker
  const hp = b.kind === 'drums' ? b.rounds : Math.max(1, Math.round(b.hp * tired));
  Object.assign(room, {
    hp, max: hp, x: 180, target: 250, left: b.seconds, stun: 0, dash: 0, shield: false, shieldT: b.shield ? b.shield[0] : 0,
    last: { ken: { t: 0, used: true }, kel: { t: 0, used: true } },
    drum: b.kind === 'drums' ? { round: 0, pattern: [], pos: 0, mode: 'pause', step: -1, showId: 0, t: 0.3, fresh: true } : null,
  });
}
function reset() {
  Object.assign(room, { phase: 'lobby', stage: 0, count: 0, pause: 0, hits: { ken: 0, kel: 0 }, ev: [], fails: {} });
  loadBoss();
}
reset();

function snapshot() {
  const b = boss(), d = room.drum;
  return JSON.stringify({
    phase: room.phase, here: { ken: isHere('ken'), kel: isHere('kel') },
    stage: room.stage, total: BOSSES.length, boss: { id: b.id, name: b.name, photo: b.photo, kind: b.kind, theme: b.theme, tip: b.tip },
    hp: room.hp, max: room.max, x: Math.round(room.x), left: Math.max(0, Math.ceil(room.left)), count: Math.ceil(room.count),
    stun: room.stun > 0, shield: room.shield, dash: room.dash > 0, hits: room.hits, ev: room.ev,
    ...(d ? { drum: { mode: d.mode, len: d.pattern.length, pos: d.pos, round: d.round, showId: d.showId, step: d.step, pad: d.mode === 'show' && d.step >= 0 ? d.pattern[d.step] : -1 } } : {}),
    ...(room.phase === 'won' ? { win: coop.win || { heading: 'Vyhráli jste!', lines: [] } } : {}),
  });
}
function broadcast() {
  const msg = `data: ${snapshot()}\n\n`;
  for (const who of WHO) for (const res of streams[who]) res.write(msg);
}

// Start, retry the boss that beat you, or play again from the first boss after a win.
function start() {
  if (!['lobby', 'won', 'lost'].includes(room.phase) || !isHere('ken') || !isHere('kel')) return false;
  if (room.phase !== 'lost') { room.stage = 0; room.hits = { ken: 0, kel: 0 }; room.fails = {}; }
  loadBoss();
  room.phase = 'count'; room.count = 3;
  broadcast(); return true;
}
function bossDown() {
  if (room.stage === BOSSES.length - 1) room.phase = 'won';
  else { room.phase = 'down'; room.pause = 2.6; }
}

// ---- fight rounds ----
function hit(who) {
  const b = boss();
  if (room.phase !== 'play' || b.kind !== 'fight') return false;
  const now = Date.now(), mine = room.last[who], theirs = room.last[other(who)];
  if (now - mine.t < 250) return false;                       // one hit per shot
  if (room.shield) { room.last[who] = { t: now, used: true }; say({ who, dmg: 0, blocked: true }); broadcast(); return true; }
  const combo = !theirs.used && now - theirs.t < COMBO_MS;
  if (combo) { theirs.used = true; room.stun = 1; }
  room.last[who] = { t: now, used: combo };
  const dmg = combo ? 3 : 1;
  room.hp = Math.max(0, room.hp - dmg);
  room.hits[who]++;
  say({ who, dmg, combo });
  if (b.dash && !combo) { room.dash = 0.45; room.target = room.x < 180 ? 230 + Math.random() * 80 : 50 + Math.random() * 80; }   // she darts away when hit
  if (room.hp === 0) bossDown();
  broadcast(); return true;
}
function fightTick(dt, b) {
  if (b.shield && (room.shieldT -= dt) <= 0) { room.shield = !room.shield; room.shieldT = b.shield[room.shield ? 1 : 0]; }
  if (room.dash > 0) room.dash -= dt;
  if (room.stun > 0) { room.stun -= dt; return; }
  if (Math.abs(room.target - room.x) < 3) { let n; do { n = 50 + Math.random() * 260; } while (Math.abs(n - room.x) < 60); room.target = n; }
  const speed = (b.speed[0] + (1 - room.hp / room.max) * (b.speed[1] - b.speed[0])) * (room.dash > 0 ? 2.6 : 1);
  room.x += Math.sign(room.target - room.x) * Math.min(Math.abs(room.target - room.x), speed * dt);
}

// ---- drum rounds: the boss plays a pattern on four pads, the kids repeat it in the same order ----
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

const TICK = 50;
let sinceSend = 0;
setInterval(() => {
  const dt = TICK / 1000, b = boss();
  if (room.phase === 'count') { room.count -= dt; if (room.count <= 0) room.phase = 'play'; }
  else if (room.phase === 'down') {
    room.pause -= dt;
    if (room.pause <= 0) { room.stage++; loadBoss(); room.phase = 'count'; room.count = 3; }
  } else if (room.phase === 'play') {
    room.left -= dt;
    if (b.kind === 'drums') drumTick(dt); else fightTick(dt, b);
    if (room.left <= 0) { room.phase = 'lost'; room.fails[room.stage] = (room.fails[room.stage] || 0) + 1; }
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
  req.on('end', () => { try { done(JSON.parse(body || '{}')); } catch (e) { done({}); } });
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

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const isPost = req.method === 'POST';
  if (url.pathname === '/coop/ping') return json(res, 200, { ok: true, bosses: BOSSES.map((b) => ({ name: b.name, blurb: b.blurb })) });
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
  if (url.pathname === '/coop/start' && isPost) return readBody(req, () => json(res, 200, { ok: start() }));
  if (url.pathname === '/coop/hit' && isPost) return readBody(req, (b) => json(res, 200, { ok: WHO.includes(b.who) && hit(b.who) }));
  if (url.pathname === '/coop/drum' && isPost) return readBody(req, (b) => json(res, 200, { ok: WHO.includes(b.who) && [0, 1, 2, 3].includes(b.pad) && drum(b.who, b.pad) }));
  if (url.pathname.startsWith('/coop/')) return json(res, 404, { error: 'unknown' });
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveFile(res, url.pathname);
}).listen(PORT, () => console.log(`Tajné operace on http://localhost:${PORT} (${BOSSES.map((b) => `${b.name}: ${b.kind}`).join(', ')})`));
