// The pixel engine: a 192 x 288 screen, one scene at a time, taps and drags,
// saving, and the art. Real pictures are used when the art pipeline has produced them (see window.ASSETS);
// anything still missing is a drawn placeholder, so the game is playable before the art exists.
// The characters are cut from the character sheet (window.SPRITES).
const K = (() => {
  const W = 192, H = 288, GROUND = 232;          // GROUND: where feet stand in side-on scenes
  const INK = '#2B1F1A';                         // the darkest colour: a deep warm brown, never black, to sit with the characters
  const canvas = document.getElementById('screen'), ctx = canvas.getContext('2d'), ui = document.getElementById('ui');
  // Everything is placed on the 192 x 288 grid the backgrounds are drawn on, but the canvas itself is twice as fine
  // (384 x 576). The heroes' drawn poses use that: two of their pixels to one background pixel, so they keep their detail.
  const FINE = canvas.width / W;
  ctx.scale(FINE, FINE);
  ctx.imageSmoothingEnabled = false;

  // The screen is made as big as fits, in steps that keep every canvas pixel a whole number of real screen pixels.
  function fit() {
    const most = Math.min(window.innerWidth / W, window.innerHeight / H), dpr = window.devicePixelRatio || 1;
    const steps = Math.floor(most * dpr / FINE);                       // real pixels per canvas pixel
    document.documentElement.style.setProperty('--s', steps >= 1 ? steps * FINE / dpr : most);
  }
  window.addEventListener('resize', fit); fit();

  // ---- small helpers ----
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hash = (str) => { let h = 2166136261; for (const c of String(str)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  const rng = (seed) => { let s = (seed >>> 0) || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
  const rect = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); };

  // ---- sound: short square-wave beeps, only ever started by a tap ----
  let ac;
  function beep(...freqs) {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const t = ac.currentTime;
      freqs.forEach((f, i) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'square'; o.frequency.value = f;
        g.gain.setValueAtTime(0.04, t + i * 0.09); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.09);
        o.connect(g).connect(ac.destination); o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.1);
      });
    } catch (e) {}
  }

  // ---- saving: one record per device ----
  const STORE = 'kellyn-a-ken-v1';
  const save = { who: null, places: {}, album: [] };
  try { Object.assign(save, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch (e) {}
  const write = () => { try { localStorage.setItem(STORE, JSON.stringify(save)); } catch (e) {} };

  // ---- art ----
  const have = window.ASSETS || { bg: [] }, sprites = window.SPRITES || {};
  const cache = {};
  const image = (path) => { if (!cache[path]) { const i = new Image(); i.src = path; cache[path] = i; } return cache[path]; };
  const ready = (i) => i.complete && i.naturalWidth > 0;
  const hasBg = (id) => have.bg.includes(id);
  const picture = (id) => { if (!hasBg(id)) return null; const i = image(`assets/bg/${id}.png`); return ready(i) ? i : null; };   // a finished picture, once loaded

  // A stand-in background: sky, a row of blocky shapes, and the ground strip the characters stand on.
  const shapes = {};
  function placeholder(id, off, look) {
    look = look || { sky: '#8FD3F4', far: '#F2C078', far2: '#E7A6B5', ground: '#8A8F9C', line: '#5B6070' };
    if (!shapes[id]) { const r = rng(hash(id)); shapes[id] = Array.from({ length: 10 }, (_, i) => ({ x: i * 40 + Math.floor(r() * 12), w: 20 + Math.floor(r() * 18), h: 34 + Math.floor(r() * 80), alt: r() < 0.5 })); }
    rect(0, 0, W, H, look.sky);
    const span = 400, far = (off || 0) * 0.5;
    for (const s of shapes[id]) {
      const x = (((s.x - far) % span) + span) % span - 30;
      rect(x, GROUND - s.h, s.w, s.h, s.alt ? look.far2 : look.far);
      rect(x + 3, GROUND - s.h + 4, s.w - 6, 2, look.sky);
    }
    rect(0, GROUND, W, H - GROUND, look.ground);
    rect(0, GROUND, W, 2, look.line);
    for (let x = -((off || 0) % 24); x < W; x += 24) rect(x, GROUND + 14, 10, 2, look.line);
  }
  // Draw a background. A scrolling one repeats side by side, every other copy mirrored so the seams match.
  // `plain` repeats it without mirroring, for a picture whose own two edges already meet (and whose landmark,
  // mirrored, would stand next to its twin).
  function background(id, off, look, plain) {
    const img = hasBg(id) ? image(`assets/bg/${id}.png`) : null;
    if (!img || !ready(img)) return placeholder(id, off, look);
    const w = img.naturalWidth, o = Math.floor(off || 0);
    if (w <= W) { ctx.drawImage(img, 0, 0); return; }
    for (let k = Math.floor(o / w); k * w - o < W; k++) {
      const x = k * w - o;
      if (k % 2 && !plain) { ctx.save(); ctx.translate(x + w, 0); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0); ctx.restore(); }
      else ctx.drawImage(img, x, 0);
    }
  }

  // A character, drawn with their feet at (x, footY). The real ones are cut from the character sheet
  // (tools/sprites.py): a row of frames, with named poses. Without a sheet, a blocky stand-in kid.
  function figure(id, x, footY, pose, t, flip) {
    const sp = sprites[id];
    x = Math.round(x); footY = Math.round(footY);
    if (!sp) return standIn(id, x, footY, pose, t, flip);
    const img = image(`assets/sprites/${sp.file}`); if (!ready(img)) return;
    const frames = sp.poses[pose] || sp.poses.stand, f = frames[Math.floor(t * (sp.fps || 7)) % frames.length], k = sp.scale || 1;
    ctx.save(); ctx.translate(x, footY); if (flip) ctx.scale(-1, 1);
    ctx.drawImage(img, f * sp.w, 0, sp.w, sp.h, -Math.floor(sp.w / 2) * k, -sp.h * k, sp.w * k, sp.h * k);
    ctx.restore();
  }
  // Any other small picture from the sheet (a star, somebody on a motorbike), centred on x with its foot at footY.
  function prop(sp, x, footY, flip) {
    const img = image(`assets/sprites/${sp.file}`); if (!ready(img)) return;
    const k = sp.scale || 1;
    ctx.save(); ctx.translate(Math.round(x), Math.round(footY)); if (flip) ctx.scale(-1, 1);
    ctx.drawImage(img, -Math.floor(sp.w / 2) * k, -sp.h * k, sp.w * k, sp.h * k);
    ctx.restore();
  }
  function standIn(who, x, footY, pose, t, flip) {
    const h = window.WORLD.heroes[who] || window.WORLD.heroes.ken, SKIN = '#E8B58A';
    const step = pose === 'run' ? Math.floor(t * 9) % 2 : 0, up = pose === 'jump' ? 2 : 0, arm = pose === 'cheer' ? footY - 24 : footY - 16;
    ctx.save(); if (flip) { ctx.translate(x * 2, 0); ctx.scale(-1, 1); }
    rect(x - 5, footY - 7 + (step ? 0 : up), 4, 7 - (step ? 2 : 0), h.legs);
    rect(x + 1, footY - 7 + (step ? up : 0), 4, 7 - (step ? 0 : 2), h.legs);
    rect(x - 6, footY - 17, 12, 10, h.shirt); rect(x - 2, footY - 15, 4, 4, h.badge);
    rect(x - 8, arm, 2, 7, SKIN); rect(x + 6, arm, 2, 7, SKIN);
    rect(x - 5, footY - 26, 10, 9, SKIN);
    rect(x - 6, footY - 30, 12, 6, h.hair);
    rect(x + 1, footY - 23, 2, 2, INK);
    ctx.restore();
  }

  // ---- scenes and the loop ----
  let scene = null, last = 0, down = null;
  function go(next) {
    if (scene && scene.leave) scene.leave();
    ui.innerHTML = '';
    scene = next;
    if (scene.enter) scene.enter();
  }
  function frame(ts) {
    const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0; last = ts;
    if (scene) { if (scene.update) scene.update(dt); if (scene.draw) scene.draw(ctx); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---- input, in screen pixels ----
  const at = (e) => { const r = canvas.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }; };
  canvas.addEventListener('pointerdown', (e) => { down = at(e); down.px = down.x; if (scene && scene.down) scene.down(down.x, down.y); });
  canvas.addEventListener('pointermove', (e) => { if (!down) return; const p = at(e); if (scene && scene.move) scene.move(p.x, p.y, p.x - down.px); down.px = p.x; });
  const lift = (e) => { if (!down) return; const p = at(e); if (Math.hypot(p.x - down.x, p.y - down.y) < 5 && scene && scene.tap) scene.tap(p.x, p.y); down = null; };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', () => { down = null; });

  // ---- the UI layer: real text and buttons on top of the pixels ----
  function add(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; ui.appendChild(el); return el; }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  return { W, H, GROUND, INK, ctx, ui, clamp, hash, rng, rect, beep, save, write, hasBg, picture, background, sprites, figure, hero: figure, prop, go, add, esc, get scene() { return scene; } };
})();
