// The pixel engine: a 192 x 288 screen, one scene at a time, taps and drags,
// saving, and the art. Real pictures are used when the art pipeline has produced them (see window.ASSETS);
// a picture still on its way (or missing) shows as a dark screen with three blinking dots.
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
    const k = steps >= 1 ? steps * FINE / dpr : most;
    document.documentElement.style.setProperty('--s', k);
    // On a tall phone there is a band below the picture: the game's buttons go there, under the thumbs, covering nothing.
    document.documentElement.classList.toggle('roomy', (window.innerHeight - H * k) / 2 >= 44 * k);
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
  }  // Drums, made from a falling tone and a burst of noise: kick, snare, tom and cymbal; for a backing beat also a
  // short hi-hat ('hat') and two sticks clicked together ('stick'). `wait` plays it that many seconds from now, timed
  // on the sound's own clock (steadier than a timer); `vol` plays it quieter (1 is full).
  let noise = null;
  function drum(kind, wait, vol) {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (wait && ac.state !== 'running') return;                                   // asleep: nothing piles up to burst out later
      const t = ac.currentTime + Math.max(0, wait || 0), v = vol === undefined ? 1 : vol, out = ac.createGain(); out.connect(ac.destination);
      if (!noise) { noise = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      const tone = (f0, f1, len, vol) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + len); g.gain.setValueAtTime(vol * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + len); o.connect(g).connect(out); o.start(t); o.stop(t + len + 0.02); };
      const hiss = (freq, len, vol) => { const n = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); n.buffer = noise; f.type = 'highpass'; f.frequency.value = freq; g.gain.setValueAtTime(vol * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + len); n.connect(f).connect(g).connect(out); n.start(t); n.stop(t + len + 0.02); };
      if (kind === 'kick') tone(150, 45, 0.18, 0.5);
      if (kind === 'snare') { tone(220, 120, 0.08, 0.15); hiss(1500, 0.14, 0.2); }
      if (kind === 'tom') tone(240, 120, 0.16, 0.4);
      if (kind === 'cymbal') hiss(6000, 0.4, 0.12);
      if (kind === 'hat') hiss(8000, 0.05, 0.1);
      if (kind === 'stick') { tone(1900, 1500, 0.04, 0.2); hiss(5000, 0.03, 0.12); }
    } catch (e) {}
  }
  // Phones only let sound start from a tap: every tap wakes the sound up (it may have been made, asleep, before one),
  // and it sleeps while the game is out of sight.
  const sound = () => (ac = ac || new (window.AudioContext || window.webkitAudioContext)());
  const wake = () => { try { if (sound().state !== 'running') ac.resume(); } catch (e) {} };
  ['pointerdown', 'pointerup', 'touchend', 'keydown'].forEach((e) => addEventListener(e, wake, true));
  // No pinching or double-tapping the game bigger on iPhones (they ignore user-scalable=no in the page's viewport).
  for (const e of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(e, (ev) => ev.preventDefault(), { passive: false });
  document.addEventListener('visibilitychange', () => { try { if (ac) (document.hidden ? ac.suspend() : ac.resume()); } catch (e) {} });

  // ---- music: a tune looping under a level (assets/music). A scene names its tune (see go()); the next scene with
  // the same tune lets it play on, any other fades it out. Every tune is there twice, .ogg and .m4a (iPhones may
  // not read .ogg), and the first the phone can read is used.
  const MUSIC = 0.4, tunes = {};
  let tune = null, want = null, hushed = false;                         // tune: { name, src, gain }, the one playing
  function loadTune(name) {
    if (!tunes[name]) {
      const get = (kind) => fetch(asset(`assets/music/${name}.${kind}`)).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then((data) => new Promise((ok, no) => sound().decodeAudioData(data, ok, no)));
      const kinds = document.createElement('audio').canPlayType('audio/ogg; codecs="vorbis"') ? ['ogg', 'm4a'] : ['m4a', 'ogg'];
      tunes[name] = get(kinds[0]).catch(() => get(kinds[1])).catch(() => null);
    }
    return tunes[name];
  }
  function fade(gain, to, secs) { const t = ac.currentTime; gain.gain.cancelScheduledValues(t); gain.gain.setValueAtTime(gain.gain.value, t); gain.gain.linearRampToValueAtTime(to, t + secs); }
  function music(name) {
    want = name || null;
    if (tune && tune.name === want) return;
    if (tune) { const old = tune; tune = null; try { fade(old.gain, 0, 0.6); old.src.stop(ac.currentTime + 0.7); } catch (e) {} }
    if (!want) return;
    loadTune(want).then((buf) => {
      if (!buf || want !== name || tune) return;
      try {
        const src = ac.createBufferSource(), gain = ac.createGain();
        src.buffer = buf; src.loop = true; gain.gain.value = 0;
        src.connect(gain).connect(ac.destination); src.start();
        tune = { name, src, gain }; fade(gain, hushed ? 0 : MUSIC, 1);
      } catch (e) {}
    });
  }
  // Quiet while the game is paused, back again after.
  function hush(on) { if (hushed === !!on) return; hushed = !!on; if (tune) try { fade(tune.gain, hushed ? 0 : MUSIC, 0.4); } catch (e) {} }


  // ---- saving: one record per device ----
  const STORE = 'kellyn-a-ken-v1' + (window.INSPECT ? '-v3' : '');          // v3, for trying levels out, keeps its own
  const save = { who: null, places: {}, album: [] };
  try { Object.assign(save, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch (e) {}
  const write = () => { try { localStorage.setItem(STORE, JSON.stringify(save)); } catch (e) {} };

  // ---- art ----
  const have = window.ASSETS || { bg: [] }, sprites = window.SPRITES || {};
  const cache = {};
  // Every file is asked for with the build's version, so a phone never mixes an old file with a new one after an update.
  const asset = (path) => (window.BUILD ? `${path}?v=${window.BUILD}` : path);
  const image = (path) => { if (!cache[path]) { const i = new Image(); i.src = asset(path); cache[path] = i; } return cache[path]; };
  const ready = (i) => i.complete && i.naturalWidth > 0;
  const hasBg = (id) => have.bg.includes(id);
  const picture = (id) => { if (!hasBg(id)) return null; const i = image(`assets/bg/${id}.png`); return ready(i) ? i : null; };   // a finished picture, once loaded

  // While a picture is still loading: a dark screen with three dots taking turns.
  function loading() {
    ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
    const k = Math.floor(performance.now() / 300) % 3;
    for (let i = 0; i < 3; i++) { ctx.fillStyle = i === k ? '#FFD43A' : '#7A6F6A'; ctx.fillRect(W / 2 - 10 + i * 8, H / 2, 4, 4); }
  }
  // Ask for pictures ahead of time, so they are there when a scene needs them.
  const preload = (paths) => paths.forEach((p) => image(p));
  // Draw a background. A scrolling one repeats side by side, every other copy mirrored so the seams match.
  // `plain` repeats it without mirroring, for a picture whose own two edges already meet (and whose landmark,
  // mirrored, would stand next to its twin).
  function background(id, off, look, plain) {
    const img = hasBg(id) ? image(`assets/bg/${id}.png`) : null;
    if (!img || !ready(img)) return loading();                            // still on its way (or missing): dark, with three dots
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
  // `size` draws it at another size than the sheet's own (objects are drawn in all sizes).
  function figure(id, x, footY, pose, t, flip, size) {
    const sp = sprites[id];
    x = Math.round(x); footY = Math.round(footY);
    if (!sp) return standIn(id, x, footY, pose, t, flip);
    const img = image(`assets/sprites/${sp.file}`); if (!ready(img)) return;
    const frames = sp.poses[pose] || sp.poses.stand, f = frames[Math.floor(t * (sp.fps || 7)) % frames.length], k = size || sp.scale || 1;
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
    hush(false); music(scene.music);
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

  const has = (sheet, pose) => !!(sprites[sheet] && sprites[sheet].poses && sprites[sheet].poses[pose]);
  return { W, H, GROUND, INK, has, ctx, ui, clamp, hash, rng, rect, beep, drum, music, hush, loadTune, asset, preload, save, write, hasBg, picture, background, sprites, figure, hero: figure, prop, go, add, esc, get scene() { return scene; }, get tune() { return tune ? { name: tune.name, volume: Math.round(tune.gain.gain.value * 100) / 100 } : null; } };
})();
