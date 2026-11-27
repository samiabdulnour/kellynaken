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
  document.addEventListener('visibilitychange', () => { try { if (document.hidden) band.hush(); if (ac) (document.hidden ? ac.suspend() : ac.resume()); } catch (e) {} });

  // ---- the band at the concert: an electric guitar, an electric bass and a drum kit ----
  // Each sound starts at `when` on the sound's own clock (0, or a moment gone by: at once), so a song can be laid out
  // a little ahead and still keep its time. Sounds ahead of time are only laid out while the sound is awake: asleep,
  // nothing piles up to burst out later. hush() silences the band at once and drops what is waiting to play (for a
  // pause, or the game going out of sight); `epoch` counts the hushes, so a song knows to lay its next notes out again.
  // Everything goes through one compressor and a limiter, so the band never clips on a phone's small speaker.
  const band = (() => {
    let bus = null, voices = [], epoch = 0, hiss = null, asleep = 0;
    const strings = {}, hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
    const squeeze = (c) => { const k = c.createDynamicsCompressor(); k.threshold.value = -12; k.knee.value = 6; k.ratio.value = 4; k.attack.value = 0.002; k.release.value = 0.1; return k; };
    const amp = (c, v) => { const g = c.createGain(); g.gain.value = v; return g; };
    function chain() {
      const c = sound();
      if (bus && bus.c === c) return bus;
      const comp = c.createDynamicsCompressor(), out = c.createGain(), limit = c.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 2.5; comp.attack.value = 0.005; comp.release.value = 0.2;
      limit.threshold.value = -3; limit.knee.value = 0; limit.ratio.value = 20; limit.attack.value = 0.001; limit.release.value = 0.08;   // and nothing ever clips
      out.gain.value = 0.5; comp.connect(out).connect(limit).connect(c.destination);
      const eq = (type, f, q, gain) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; if (gain) b.gain.value = gain; return b; };
      const input = (level, ...filters) => { const g = c.createGain(); g.gain.value = level; filters.reduce((a, b) => a.connect(b), g).connect(comp); return g; };
      // The guitar leads: a small amp, no mud, some bite where a phone speaker is loudest, no fizz. A phone cannot play
      // the bass's low notes themselves, so its overtones carry it there and its depths are kept low; its pluck and the
      // drums' hits are squeezed a little, so they never push the rest down and are heard between the hits too.
      bus = { c, comp,
        guitar: input(1.15, eq('highpass', 160, 0.7), eq('peaking', 1900, 1, 3), eq('lowpass', 5200, 0.7)),
        bass: input(0.35, squeeze(c), eq('highpass', 50, 0.7), eq('lowshelf', 200, 0.7, -6), eq('peaking', 1000, 0.8, 7), amp(c, 1.35)),
        kit: input(2, squeeze(c), amp(c, 1.7)) };
      hiss = c.createBuffer(1, c.sampleRate * 1.2, c.sampleRate); const d = hiss.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return bus;
    }
    // One sound: its own volume (env), and a second knob (cut) that hush() turns down. While the sound is asleep only
    // a sound for right now is kept, and only the first two (the tap that wakes it is heard; a pile is not).
    function voice(part, when, len) {
      const c = sound();
      if (c.state !== 'running') { if ((when || 0) > c.currentTime + 0.01 || asleep >= 2) return null; asleep++; } else asleep = 0;
      const b = chain(), t = Math.max(c.currentTime, when || 0), env = c.createGain(), cut = c.createGain();
      env.connect(cut).connect(b[part]);
      const v = { t, end: t + len, env, cut, src: [] };
      voices = voices.filter((o) => o.end > c.currentTime); voices.push(v);
      return v;
    }
    const start = (v, node, stop) => { node.start(v.t); node.stop(stop); v.src.push(node); return node; };
    const noise = (v, type, f, q, len, vol) => {                                          // a burst of filtered noise, dying away
      const c = bus.c, n = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
      n.buffer = hiss; fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      g.gain.setValueAtTime(vol, v.t); g.gain.exponentialRampToValueAtTime(0.001, v.t + len);
      n.connect(fl).connect(g).connect(v.env); start(v, n, v.t + len + 0.02);
    };
    const tone = (v, f0, f1, len, vol, type) => {                                          // a tone falling in pitch, dying away
      const c = bus.c, o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(f0, v.t); o.frequency.exponentialRampToValueAtTime(f1, v.t + len);
      g.gain.setValueAtTime(vol, v.t); g.gain.exponentialRampToValueAtTime(0.001, v.t + len);
      o.connect(g).connect(v.env); start(v, o, v.t + len + 0.02);
    };
    // A plucked string (Karplus-Strong), worked out once for each note: a burst of noise, picked a fifth of the way
    // along the string, runs round a loop as long as one swing of the note and softens a little every time round.
    // Then a touch of drive, like a small amp. The loop is a whole number of samples long; playing it a hair faster
    // brings it exactly into tune.
    function string(midi) {
      const c = sound();
      if (strings[midi] && strings[midi].sr === c.sampleRate) return strings[midi];
      const sr = c.sampleRate, f = hz(midi), N = Math.max(4, Math.round(sr / f - 0.5)), real = sr / (N + 0.5), len = Math.floor(sr * 1.9);
      const buf = c.createBuffer(1, len, sr), d = buf.getChannelData(0), line = new Float32Array(N), pick = Math.max(1, Math.round(N / 5));
      const loss = Math.pow(0.001, 1 / (real * 2.8));                                       // about 2.8 s to die away, high or low
      let lp = 0, mean = 0, peak = 0;
      const burst = Array.from({ length: N }, () => (lp += 0.55 * (Math.random() * 2 - 1 - lp)));
      for (let i = 0; i < N; i++) { line[i] = burst[i] - burst[(i + pick) % N]; mean += line[i] / N; }
      for (let i = 0; i < N; i++) line[i] -= mean;
      for (let i = 0, k = 0; i < len; i++) { const n = k + 1 === N ? 0 : k + 1; d[i] = line[k]; line[k] = loss * 0.5 * (line[k] + line[n]); k = n; }
      for (let i = 0; i < len; i++) { d[i] = Math.tanh(d[i] * 2.5); peak = Math.max(peak, Math.abs(d[i])); }
      for (let i = 0; i < len; i++) d[i] /= peak || 1;
      return (strings[midi] = { buf, rate: f / real, sr });
    }
    return {
      // The guitar: `len` is how long the note is held (seconds); then it is let go.
      guitar(midi, when, vol = 1, len = 0.5) {
        try {
          const s = string(midi), ring = Math.min(1.8, Math.max(0.22, len + 0.1)), v = voice('guitar', when, ring + 0.1); if (!v) return;
          const src = bus.c.createBufferSource(), g = v.env.gain; src.buffer = s.buf; src.playbackRate.value = s.rate; src.connect(v.env);
          g.setValueAtTime(0.55 * vol, v.t); g.setTargetAtTime(0, v.t + ring - 0.05, 0.025);
          start(v, src, v.t + ring + 0.1);
        } catch (e) {}
      },
      // The bass: a round sine for the note itself, and a growl (a sawtooth, its brightness closing after the pluck)
      // that a phone's speaker can play.
      bass(midi, when, vol = 1, len = 0.5) {
        try {
          const f = hz(midi), hold = Math.max(0.12, len - 0.03), v = voice('bass', when, hold + 0.2); if (!v) return;
          const c = bus.c, sine = c.createOscillator(), saw = c.createOscillator(), lp = c.createBiquadFilter(), a = c.createGain(), b = c.createGain(), g = v.env.gain;
          sine.frequency.value = f; saw.type = 'sawtooth'; saw.frequency.value = f;
          lp.type = 'lowpass'; lp.Q.value = 2; lp.frequency.setValueAtTime(Math.min(3000, f * 28), v.t); lp.frequency.exponentialRampToValueAtTime(Math.max(1100, f * 12), v.t + 0.2);
          a.gain.value = 0.2; b.gain.value = 1.3;
          sine.connect(a).connect(v.env); saw.connect(lp).connect(b).connect(v.env);
          g.setValueAtTime(0, v.t); g.linearRampToValueAtTime(vol, v.t + 0.006); g.setTargetAtTime(vol * 0.55, v.t + 0.006, 0.15); g.setTargetAtTime(0, v.t + hold, 0.03);
          start(v, sine, v.t + hold + 0.2); start(v, saw, v.t + hold + 0.2);
        } catch (e) {}
      },
      // Alan's kit: kick, snare, hat, tom, cymbal (a crash), and two sticks clicked together to count in. The kick has
      // the beater's click on top, so it is heard on a phone too.
      kit(kind, when, vol = 1) {
        try {
          const v = voice('kit', when, kind === 'cymbal' ? 1.2 : 0.3); if (!v) return;
          v.env.gain.value = vol;
          if (kind === 'kick') { tone(v, 165, 46, 0.24, 0.45); noise(v, 'bandpass', 2400, 1, 0.025, 0.9); }
          if (kind === 'snare') { tone(v, 210, 160, 0.09, 0.45, 'triangle'); noise(v, 'bandpass', 1900, 0.6, 0.2, 1.4); noise(v, 'highpass', 6000, 0.7, 0.08, 0.5); }
          if (kind === 'hat') noise(v, 'highpass', 6500, 0.7, 0.045, 0.55);
          if (kind === 'tom') { tone(v, 200, 125, 0.24, 0.6); noise(v, 'bandpass', 1200, 1, 0.05, 0.8); }
          if (kind === 'cymbal') { noise(v, 'highpass', 5000, 0.7, 1.1, 0.5); noise(v, 'bandpass', 3300, 1.2, 0.45, 0.4); }
          if (kind === 'stick') { tone(v, 1900, 1500, 0.04, 0.45); noise(v, 'highpass', 5000, 0.7, 0.03, 0.25); }
        } catch (e) {}
      },
      // A tap with no note: the strings muted under the hand and scratched, a dull click and no note.
      scratch(part, vol = 1) {
        try {
          const v = voice(part, 0, 0.12); if (!v) return;
          v.env.gain.value = vol;
          if (part === 'bass') { tone(v, 95, 70, 0.07, 0.5); noise(v, 'bandpass', 650, 1, 0.045, 0.35); }
          else { noise(v, 'bandpass', 2600, 1.3, 0.05, 0.45); noise(v, 'bandpass', 900, 1, 0.03, 0.25); }
        } catch (e) {}
      },
      hush() {
        epoch++;
        if (!ac) return;
        const now = ac.currentTime;
        for (const v of voices) {
          try {
            if (v.t > now + 0.005) { v.cut.gain.value = 0; for (const s of v.src) s.stop(now); continue; }   // not begun yet: never begins
            v.cut.gain.setValueAtTime(1, now); v.cut.gain.linearRampToValueAtTime(0, now + 0.05);
            for (const s of v.src) s.stop(now + 0.06);
          } catch (e) {}
        }
        voices = [];
      },
      warm(midis) { try { for (const m of midis) string(m); chain(); } catch (e) {} },     // work the strings out before the song needs them
      now: () => (ac ? ac.currentTime : 0),
      get ready() { return !!ac && ac.state === 'running'; },
      get epoch() { return epoch; },
    };
  })();

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
  let scene = null, last = 0;
  const down = new Map();                                   // the fingers on the picture, each where it went down and last was
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
  // A scene may also hear the finger lift (`up`, with whether it was only a tap), for things dragged and let go. The
  // canvas keeps the finger while it is down, so a drag over the bar or out of the picture still ends here.
  // Every finger is followed on its own (the last argument says which), so a second finger or a resting palm neither
  // moves nor lets go of what the first one drags; a scene that does not care simply ignores it.
  const at = (e) => { const r = canvas.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }; };
  canvas.addEventListener('pointerdown', (e) => {
    const f = at(e); f.px = f.x; f.py = f.y; down.set(e.pointerId, f);
    try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* not every browser */ }
    if (scene && scene.down) scene.down(f.x, f.y, e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => { const f = down.get(e.pointerId); if (!f) return; const p = at(e); if (scene && scene.move) scene.move(p.x, p.y, p.x - f.px, e.pointerId); f.px = p.x; f.py = p.y; });
  const lift = (e) => {
    const f = down.get(e.pointerId); if (!f) return; down.delete(e.pointerId);
    const p = at(e), tapped = Math.hypot(p.x - f.x, p.y - f.y) < 5;
    if (tapped && scene && scene.tap) scene.tap(p.x, p.y);
    if (scene && scene.up) scene.up(p.x, p.y, tapped, e.pointerId);
  };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', (e) => { const f = down.get(e.pointerId); if (!f) return; down.delete(e.pointerId); if (scene && scene.up) scene.up(f.px, f.py, false, e.pointerId); });

  // ---- the UI layer: real text and buttons on top of the pixels ----
  function add(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; ui.appendChild(el); return el; }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const has = (sheet, pose) => !!(sprites[sheet] && sprites[sheet].poses && sprites[sheet].poses[pose]);
  return { W, H, GROUND, INK, has, ctx, ui, clamp, hash, rng, rect, beep, drum, band, music, hush, loadTune, asset, preload, save, write, hasBg, picture, background, sprites, figure, hero: figure, prop, go, add, esc, get scene() { return scene; }, get tune() { return tune ? { name: tune.name, volume: Math.round(tune.gain.gain.value * 100) / 100 } : null; } };
})();
