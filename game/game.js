// The game itself: title, the planet, a place's four scenes, playing a scene, and the album of rescued people.
// Everything it shows comes from window.WORLD (world.js).
//
// It is always played by the two of them together, each on their own device. What they share (how far they have
// got, where they are, the scene being played, its lives and hits) lives in a room (room.js) on the server. This
// file shows that state and reports what its own hero does. Each device simulates only its own hero; the other one
// is drawn from the few things their device sends over (a jump, a shot, a drum tap).
(() => {
  const { W, H, GROUND, INK, ctx, save, write, go, add, esc, rect, beep, clamp } = K, drum = K.drum;
  const WORLD = window.WORLD, places = WORLD.places, pins = WORLD.planet.pins;
  const INSPECT = !!window.INSPECT;           // v3: one player, every level open, for trying levels out

  // ---- the line to the room ----
  const Net = (() => {
    const solo = INSPECT || /[?&]solo\b/.test(location.search);         // one device, for trying things out
    const base = location.protocol === 'file:' || /github\.io$/.test(location.hostname) ? WORLD.server : '';
    if (!save.id) { save.id = Math.random().toString(36).slice(2, 10); write(); }      // this device, so it can take its seat again
    let who = null, state = null, off = null, es = null, room = null, again = 0, ticker = 0;
    const hear = { state() {}, fx() {}, taken() {} };
    function take(m) {
      if (m.type === 'state') {
        off = off === null ? m.now - Date.now() : Math.max(off, m.now - Date.now());   // the room's clock, as near as the fastest message shows
        state = m; save.places = m.save.places; save.album = m.save.album; save.round = m.save.round | 0; save.stars = m.save.stars || {}; write();     // each device remembers too, in case the server forgets
        hear.state(m);
      } else if (m.type === 'fx') hear.fx(m);
      else if (m.type === 'taken') { leave(); hear.taken(); }
    }
    function leave() { clearTimeout(again); if (es) es.close(); es = null; room = null; who = null; state = null; off = null; }
    // The stream to the server. If it breaks (a tunnel, a sleeping server) it is opened afresh, bringing along what this
    // device remembers, so a server that has just woken up with an empty memory is told how far they had got.
    function listen() {
      const mine = { places: save.places, album: save.album, round: save.round | 0, stars: save.stars || {} };
      es = new EventSource(`${base}/v2/api/stream?who=${who}&id=${save.id}&save=${encodeURIComponent(JSON.stringify(mine))}`);
      es.onmessage = (e) => { let m = null; try { m = JSON.parse(e.data); } catch (err) {} if (m) take(m); };
      es.onerror = () => { if (!es) return; es.close(); es = null; if (who) again = setTimeout(listen, 1500); };
    }
    function join(w) {
      leave(); who = w;
      const mine = { places: save.places, album: save.album, round: save.round | 0, stars: save.stars || {} };
      if (solo) {
        const r = Room.create({ world: WORLD, solo: true, open: INSPECT, now: () => Date.now(), emit: (to, m) => { if (to === 'all' || to === who) { const copy = JSON.parse(JSON.stringify(m)); setTimeout(() => { if (room === r) take(copy); }, 0); } } });
        room = r; clearInterval(ticker); ticker = setInterval(() => { if (room === r) r.tick(); }, 250);
        return r.join(who, mine);
      }
      listen();
    }
    setInterval(() => { if (es) fetch(`${base}/coop/ping`).catch(() => {}); }, 240000);        // the free server dozes off unless somebody knocks now and then
    function send(m) {
      if (room) return room.act(who, m);
      if (who) fetch(`${base}/v2/api/act`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ ...m, who, key: save.id }) }).catch(() => {});      // `key` is this device; a message may carry an `id` of its own
    }
    return { hear, join, leave, send, solo, now: () => Date.now() + (off || 0), get who() { return who; }, get state() { return state; } };
  })();
  const st = () => Net.state;
  const me = () => Net.who, mate = () => (Net.who === 'ken' ? 'kel' : 'ken');
  const mateHere = () => !!(st() && st().online[mate()]);
  const heroName = (w = me()) => WORLD.heroes[w].name;
  const clock = (sn) => (Net.now() - sn.startAt) / 1000;                 // seconds into a game, the same on both devices

  // Who may play what. In the version for trying levels out (v3, window.INSPECT) everything is open.
  const progress = (p) => (st() && st().save.places[p.id]) || { scene: 0, done: false };
  const isOpen = (p) => { const i = places.indexOf(p); return INSPECT || i === 0 || (i > 0 && progress(places[i - 1]).done); };
  const todo = (p) => isOpen(p) && !progress(p).done;
  // A level: done, the one to play next (todo), open to play again or in any order (open), or not yet (locked).
  const levelState = (p, i) => { const pr = progress(p); return pr.done || i < pr.scene ? 'done' : INSPECT ? 'todo' : isOpen(p) && i === pr.scene ? 'todo' : 'locked'; };
  const fullName = (p) => (p.area ? `${p.name} · ${p.area}` : p.name);
  const inRegion = (r) => places.filter((p) => p.region === r);
  const regionState = (r) => { const ps = inRegion(r); return ps.some(todo) ? 'todo' : ps.length && ps.every((p) => progress(p).done) ? 'done' : 'locked'; };
  const behind = (pin) => (pin.map ? places.filter((p) => WORLD.regions[p.region].up === 'map') : pin.region ? inRegion(pin.region) : (pin.places || []).map((id) => places.find((p) => p.id === id)));
  const later = (pin) => (pin.later || []).map((id) => (WORLD.later || []).find((p) => p.id === id)).filter(Boolean);   // places that open in the future
  const pinState = (pin) => {
    const ps = behind(pin);
    if (!ps.length) return 'soon';
    if (ps.some(todo)) return 'todo';
    return ps.some((p) => progress(p).done) ? 'done' : 'locked';
  };
  // A pin on a flat map: a little flag on a post. Red and bobbing for what is next, green when done, grey when shut.
  const flag = (x, y, state, t) => {
    const bob = state === 'todo' ? Math.round(Math.sin(t * 5) * 2) : 0, lit = state === 'todo' || state === 'done';
    rect(x - 1, y - 2, 2, 6, INK);
    rect(x - 5, y - 12 + bob, 10, 10, INK);
    rect(x - 4, y - 11 + bob, 8, 8, state === 'done' ? '#1FA463' : state === 'todo' ? '#CC2233' : '#7A6F6A');
    rect(x - 2, y - 9 + bob, 4, 4, lit ? '#FFD43A' : '#B8ADA6');
  };
  const pinAt = ([x, y]) => `left:${(x / W) * 100}%;top:${(y / H) * 100}%`;    // a name next to its pin, in the UI layer
  // Praise in big letters across the middle of the screen for a moment ("Perfektní!"), or a little "+1" rising from a
  // spot in the picture: for every game to cheer with.
  const cheer = (text) => { const p = add(`<p class="praise">${esc(text)}</p>`); setTimeout(() => p.remove(), 900); };
  const plus = (text, x, y, color) => { const p = add(`<p class="plus" style="${pinAt([x, y])}${color ? `;color:${color}` : ''}">${esc(text)}</p>`); setTimeout(() => p.remove(), 800); };
  // Stars, 1 to 3, as text: filled ones and empty ones.
  const starText = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
  // Arriving on a map: it grows into place for a moment, as if zooming in.
  const zoomIn = (t, draw) => {
    const e = Math.min(1, t / 0.35), k = 0.55 + 0.45 * (1 - (1 - e) ** 3);
    rect(0, 0, W, H, '#1A1B36');
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(k, k); ctx.translate(-W / 2, -H / 2); draw(); ctx.restore();
  };
  const PAPER = { sky: '#F2E4BE', far: '#E2D3A2', far2: '#9BD16B', ground: '#F2E4BE', line: '#CBB57F' };
  const draft = (id) => { if (!K.hasBg(id)) add('<span class="draft">náhradní obrázek</span>'); };
  // A map's place names stay hidden until the map itself is there, so they never float over the loading dots.
  const holdPins = (bg) => { const hide = K.picture(bg) ? '' : 'hidden'; K.ui.querySelectorAll('.pin').forEach((el) => { if (el.style.visibility !== hide) el.style.visibility = hide; }); };
  // A character's face from the sheet, for the UI. mood: 0 calm, 1 laughing, 2 surprised, 3 smiling, 4 eyes closed.
  // f is how many screen pixels each drawn pixel takes.
  const face = (id, mood = 0, f = 2) => {
    const sp = K.sprites[id]; if (!sp) return '';
    const c = sp.faces, u = f * (c.scale || 1) / 8;                                // drawn finer faces come with a scale
    return `<span class="face" style="width:${c.w * u}em;height:${c.h * u}em;background-image:url(${K.asset(`assets/sprites/${c.file}`)});background-size:${c.w * c.n * u}em ${c.h * u}em;background-position:${-mood * c.w * u}em 0"></span>`;
  };

  // ---- which screen is up: the room says where everyone is, and both devices follow ----
  let shown = null, away = false;               // away: looking at the album, which is one's own business
  const waiting = document.getElementById('wait');
  function route() {
    const s = st(); if (!s) return;
    const key = s.where.screen === 'scene' ? 'scene:' + s.scene.key : s.where.screen + ':' + (s.where.place || s.where.region || '');
    if (key !== shown) {
      shown = key; away = false;
      const p = places.find((x) => x.id === s.where.place);
      go(s.where.screen === 'region' ? Region(s.where.region) : s.where.screen === 'scene' ? Play(p, s.scene) : s.where.screen === 'rescued' ? Rescued(p) : s.where.screen === 'planet' ? Planet : Czechia);
    } else if (!away && K.scene && K.scene.sync) K.scene.sync(s);
    waiting.hidden = s.ready;
    waiting.textContent = `Čekám na ${heroName(mate())}. Hraje se ve dvou, každý na svém telefonu.`;
  }
  // The bar along the top of the globe and the map of Czechia: the album, saving, and who is playing.
  function menu(name) {
    const bar = add(`<div class="bar"><span>${esc(name)}</span><span><button data-go="album">Album</button><button data-go="save">Uložit</button><button data-go="title">${esc(heroName())}</button></span></div>`);
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-go]'); if (!b) return;
      beep(520);
      if (b.dataset.go === 'title') return toTitle();
      away = true; go(b.dataset.go === 'album' ? Album : Saves);
    });
  }
  const backToMap = () => { away = false; shown = null; route(); };
  function toTitle(note) { Net.leave(); shown = null; away = false; waiting.hidden = true; save.who = null; write(); Title.note = note || ''; go(Title); }
  Net.hear.state = route;
  Net.hear.fx = (m) => { if (K.scene && K.scene.fx) K.scene.fx(m); };
  Net.hear.taken = () => toTitle('Tuhle postavu už hraje někdo jiný.');

  // ---- title: the logo, and who is playing ----
  const Title = {
    t: 0, note: '', timers: [],
    enter() {
      add(`<div class="logo">${esc(WORLD.title).replace(' a ', '<br>a ')}<small>${esc(WORLD.subtitle)}</small></div>`);
      if (INSPECT) add('<p class="tip up">Zkušební verze: hraješ sám a všechno je odemčené.</p>');
      const pick = add(`<div class="pick"><p>${esc(this.note || (INSPECT ? 'Za koho hraješ?' : 'Kdo hraje?'))}</p><div>
        <button class="btn red" data-who="ken">${face('ken', 3)}${esc(WORLD.heroes.ken.name)}</button>
        <button class="btn pink" data-who="kel">${face('kel', 3)}${esc(WORLD.heroes.kel.name)}</button></div></div>`);
      pick.addEventListener('click', (e) => { const b = e.target.closest('[data-who]'); if (b) { beep(520, 660); this.join(b.dataset.who); } });
      draft('title');
    },
    // Take a seat in the room. The server may be asleep, so say so rather than look broken.
    join(w) {
      save.who = w; write(); this.note = '';
      const pick = K.ui.querySelector('.pick'); pick.innerHTML = '<p>Připojuji…</p>';
      Net.join(w);
      this.timers = [setTimeout(() => { if (!st() && pick.isConnected) pick.innerHTML = '<p>Budím hru. Může to trvat až minutu…</p>'; }, 6000),
        setTimeout(() => { if (!st() && K.scene === Title) toTitle('Nejde se připojit. Zkus to znovu.'); }, 75000)];
    },
    leave() { this.timers.forEach(clearTimeout); },
    update(dt) { this.t += dt; },
    draw() {
      K.background('title', 0, { sky: '#1B2A5C', far: '#3A2F5B', far2: '#4A3B6B', ground: '#3A2F33', line: '#5B4A4E' });
      K.hero('ken', 64, 210, 'cheer', this.t); K.hero('kel', 128, 210, 'cheer', this.t, true);      // up on the terrace wall, clear of the buttons
    },
  };

  // ---- the planet: drag to spin it, tap a pin to travel ----
  // The world picture (384 x 192, the whole Earth laid flat) is wrapped around a ball. Pins sit at [x, y] on that picture.
  const Planet = (() => {
    const R = 84, CX = 96, CY = 150, TW = 384, TH = 192, D = 2 * R + 3, MID = R + 1, TAU = Math.PI * 2;
    const disc = document.createElement('canvas'); disc.width = disc.height = D;
    const dctx = disc.getContext('2d'), out = dctx.createImageData(D, D);
    // For every pixel of the ball: where it sits in the picture buffer, which row of the skin it shows, how far round
    // from the middle it is, and how brightly it is lit (three flat steps, from the upper left).
    const at = [], rows = [], lons = [], shades = [];
    for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
      const nx = (x - MID) / R, ny = (y - MID) / R, d = nx * nx + ny * ny, i = (y * D + x) * 4;
      if (d > 1) { if (d <= (1 + 1.5 / R) ** 2) out.data.set([191, 230, 255, 255], i); continue; }     // a thin rim of air
      const nz = Math.sqrt(1 - d), light = -0.45 * nx - 0.45 * ny + 0.77 * nz;
      at.push(i); rows.push(clamp(Math.floor((0.5 - Math.asin(-ny) / Math.PI) * TH), 0, TH - 1)); lons.push(Math.atan2(nx, nz));
      shades.push(light < 0.28 ? 0.62 : light < 0.55 ? 0.82 : 1);
    }
    let skin = null, real = false, drawn = null;
    function makeSkin() {
      const c = document.createElement('canvas'); c.width = TW; c.height = TH;
      const g = c.getContext('2d'), img = K.picture(WORLD.planet.bg);
      if (!img) return;                                      // the world map is still on its way
      g.drawImage(img, 0, 0, TW, TH); real = true;
      skin = g.getImageData(0, 0, TW, TH).data; drawn = null;
    }
    function paint(rot) {
      const o = out.data, shift = rot / TAU + 0.5;
      for (let k = 0; k < at.length; k++) {
        let u = (lons[k] / TAU + shift) % 1; if (u < 0) u += 1;
        const s = (rows[k] * TW + (Math.floor(u * TW) % TW)) * 4, i = at[k], f = shades[k];
        o[i] = skin[s] * f; o[i + 1] = skin[s + 1] * f; o[i + 2] = skin[s + 2] * f; o[i + 3] = 255;
      }
      dctx.putImageData(out, 0, 0); drawn = rot;
    }
    const lonOf = (pin) => (pin.at[0] / TW - 0.5) * TAU;       // how far round the ball a pin sits
    // Where a pin is on the screen right now, and whether it is on the side facing us.
    const spot = (pin, rot) => {
      const lat = (0.5 - pin.at[1] / TH) * Math.PI, dl = lonOf(pin) - rot, z = Math.cos(lat) * Math.cos(dl);
      return { x: Math.round(CX + Math.cos(lat) * Math.sin(dl) * R), y: Math.round(CY - Math.sin(lat) * R), seen: z > 0.18 };
    };
    const stars = (() => { const r = K.rng(11); return Array.from({ length: 46 }, () => [Math.floor(r() * W), 22 + Math.floor(r() * (H - 22)), r() * 6]); })();
    let rot = 0, aim = null, t = 0;
    const TIP = 'Otoč planetou. Klepni na místo.';
    const toCzechia = () => { beep(660, 520); Net.send({ type: 'zoom', to: 'map' }); };
    const say = (text) => { const tip = K.ui.querySelector('.tip'); if (tip) tip.textContent = text; };
    return {
      get rot() { return rot; }, set rot(v) { rot = v; aim = null; },
      where(i) { return spot(pins[i], rot); },
      enter() {
        menu('Svět');
        add(`<p class="tip up">${TIP}</p>`);
        add('<button class="btn zoom">&lt; Česko</button>').addEventListener('click', toCzechia);
        const lead = pins.find((pin) => pinState(pin) === 'todo') || pins[0];
        aim = lonOf(lead); rot = aim - 1;                          // spin round to the next place to save
        if (!real) makeSkin();
        draft(WORLD.planet.bg);
      },
      move(x, y, dx) { rot -= dx / R; aim = null; },
      // A pin opens its map: Czechia's, or a region's with every level on it. The rest open later.
      tap(x, y) {
        let hit = null, best = 14;
        for (const pin of pins) { const p = spot(pin, rot), d = Math.hypot(p.x - x, p.y - 6 - y); if (p.seen && d < best) { best = d; hit = pin; } }
        if (!hit) return;
        if (hit.map) return toCzechia();
        const state = pinState(hit), l = later(hit)[0];
        if (state === 'soon') { beep(180); return say(l ? `${fullName(l)} se teprve otevře.` : 'Tohle místo se teprve otevře.'); }
        if (state === 'locked') { beep(180); return say('Nejdřív dokonči předchozí místo.'); }
        beep(660, 520); Net.send({ type: 'zoom', to: hit.region });
      },
      update(dt) {
        t += dt;
        if (aim !== null) { rot += (aim - rot) * Math.min(1, dt * 4); if (Math.abs(aim - rot) < 0.003) { rot = aim; aim = null; } }
        if (!real && K.picture(WORLD.planet.bg)) makeSkin();
      },
      draw() {
        if (!real) return K.background(WORLD.planet.bg);                // the world map is still on its way: only the loading dots
        rect(0, 0, W, H, '#1A1B36');
        for (const [x, y, ph] of stars) if (Math.sin(t * 1.5 + ph) > -0.6) rect(x, y, 1, 1, '#FFF8E7');
        if (drawn !== rot) paint(rot);
        ctx.drawImage(disc, CX - MID, CY - MID);
        for (const pin of pins) {
          const p = spot(pin, rot); if (!p.seen) continue;
          const state = pinState(pin), bob = state === 'todo' ? Math.round(Math.sin(t * 5) * 2) : 0, lit = state === 'todo' || state === 'done';
          const col = state === 'done' ? '#1FA463' : state === 'todo' ? '#CC2233' : '#7A6F6A';
          if (behind(pin).length + later(pin).length > 1) { rect(p.x - 2, p.y - 18 + bob, 12, 12, INK); rect(p.x - 1, p.y - 17 + bob, 10, 10, col); }   // a second head behind: several places here
          rect(p.x - 1, p.y - 2, 2, 8, INK);
          rect(p.x - 6, p.y - 14 + bob, 12, 12, INK);
          rect(p.x - 5, p.y - 13 + bob, 10, 10, col);
          rect(p.x - 2, p.y - 10 + bob, 4, 4, lit ? '#FFD43A' : '#B8ADA6');
        }
      },
    };
  })();

  // ---- Czechia close up: Prague under the glass, and the places outside it. "Svět" zooms out to the planet. ----
  const Czechia = (() => {
    const M = WORLD.map, laterOf = (pin) => (WORLD.later || []).find((p) => p.id === pin.later);
    const state = (pin) => (pin.region ? regionState(pin.region) : 'soon');
    const allDone = () => M.pins.every((pin) => !pin.region || regionState(pin.region) === 'done');
    const TIP = 'Klepni na místo na mapě.';
    let t = 0;
    const say = (text) => { const tip = K.ui.querySelector('.tip'); if (tip) tip.textContent = text; };
    function pick(pin) {
      if (!pin.region) { beep(180); return say(`${fullName(laterOf(pin))} se teprve otevře.`); }
      if (state(pin) === 'locked') { beep(180); return say('Nejdřív dokonči předchozí místo.'); }
      beep(660, 520); Net.send({ type: 'zoom', to: pin.region });
    }
    return {
      where(id) { const pin = M.pins.find((q) => (q.region || q.later) === id); return { x: pin.at[0], y: pin.at[1] }; },
      enter() {
        t = 0;
        menu(M.name);
        for (const pin of M.pins) {
          const name = pin.region ? WORLD.regions[pin.region].name : laterOf(pin).name;
          add(`<button class="pin ${pin.label || 'below'} ${state(pin)}" data-id="${pin.region || pin.later}" style="${pinAt(pin.at)}">${esc(name)}</button>`).addEventListener('click', () => pick(pin));
        }
        add(`<p class="tip map">${allDone() ? 'V Česku je hotovo. Další mise čeká ve světě!' : TIP}</p>`);
        add(`<button class="btn zoom${allDone() ? ' go' : ''}">Svět &gt;</button>`).addEventListener('click', () => { beep(520, 660); Net.send({ type: 'zoom', to: 'planet' }); });
        draft(M.bg);
      },
      tap(x, y) {
        let hit = null, best = 12;
        for (const pin of M.pins) {
          const d = Math.hypot(pin.at[0] - x, pin.at[1] - 8 - y); if (d < best) { best = d; hit = pin; }
          if (!hit && pin.glass && Math.hypot(pin.glass[0] - x, pin.glass[1] - y) < pin.glass[2]) hit = pin;   // anywhere on the magnifying glass
        }
        if (hit) pick(hit);
      },
      update(dt) { t += dt; holdPins(M.bg); },
      draw() { zoomIn(t, () => { K.background(M.bg, 0, PAPER); if (K.picture(M.bg)) for (const pin of M.pins) flag(pin.at[0], pin.at[1], state(pin), t); }); },
    };
  })();

  // ---- a region's map (Praha, Austrálie): every level is a pin where it happens. Tap one to play it. ----
  const Region = (id) => {
    const R = WORLD.regions[id], up = R.up === 'map' ? WORLD.map.name : 'Svět';
    const pins = [...inRegion(id).flatMap((p) => p.scenes.map((sc, i) => ({ key: `${p.id}:${i}`, p, i, sc, at: sc.at, label: sc.label }))),
      ...(R.later || []).map((l) => ({ key: l.id, soon: (WORLD.later || []).find((x) => x.id === l.id), at: l.at, label: l.label }))];
    const state = (pin) => (pin.soon ? 'soon' : levelState(pin.p, pin.i));
    // A level not reached yet keeps its name to itself, like the rest of the story.
    const name = (pin) => (pin.soon ? pin.soon.name : state(pin) === 'locked' ? '???' : pin.sc.name);
    let t = 0, tip = null;
    const say = (text) => { if (tip) tip.textContent = text; };
    function pick(pin) {
      const st8 = state(pin);
      if (st8 === 'soon') { beep(180); return say(`${fullName(pin.soon)} se teprve otevře.`); }
      if (st8 === 'locked') { beep(180); return say('Tam se dostanete později. Nejdřív to, co svítí červeně.'); }
      if (!st().ready) { beep(180); return say(`Čekám na ${heroName(mate())}.`); }
      beep(520, 780); Net.send({ type: 'play', place: pin.p.id, index: pin.i });
    }
    function labels() {
      K.ui.querySelectorAll('.pin').forEach((el) => el.remove());
      const best = (st() && st().save.stars) || {};                                       // stars next to the levels won, the best each time
      for (const pin of pins) add(`<button class="pin ${pin.label || 'below'} ${state(pin)}" data-id="${pin.key}" style="${pinAt(pin.at)}">${esc(name(pin))}${state(pin) === 'done' && best[pin.key] ? `<b class="st">${starText(best[pin.key])}</b>` : ''}</button>`).addEventListener('click', () => pick(pin));
    }
    return {
      where(key) { const pin = pins.find((q) => q.key === key); return { x: pin.at[0], y: pin.at[1] }; },
      enter() {
        t = 0;
        const bar = add(`<div class="bar"><button data-back>&lt; ${esc(up)}</button><span>${esc(R.name)}</span></div>`);
        bar.querySelector('[data-back]').addEventListener('click', () => { beep(440); Net.send({ type: 'back' }); });
        const done = inRegion(id).every((p) => progress(p).done);
        tip = add(`<p class="tip map">${INSPECT ? 'Zkušební verze: všechno je odemčené.' : done ? 'Tady je hotovo! Zahrát si můžete cokoli znovu.' : 'Klepni na místo, které svítí červeně.'}</p>`);
        labels();
        draft(R.bg);
      },
      sync() { labels(); },
      tap(x, y) {
        let hit = null, best = 12;
        for (const pin of pins) { const d = Math.hypot(pin.at[0] - x, pin.at[1] - 8 - y); if (d < best) { best = d; hit = pin; } }
        if (hit) pick(hit);
      },
      update(dt) { t += dt; holdPins(R.bg); },
      draw() { zoomIn(t, () => { K.background(R.bg, 0, PAPER); if (K.picture(R.bg)) for (const pin of pins) flag(pin.at[0], pin.at[1], state(pin), t); }); },
    };
  };

  // ---- playing one scene: the story lines, then the game, then on to the next. The room says which part is on. ----
  const Play = (place, first) => {
    const sc = place.scenes[first.index], who = me();
    let sn = first, was = null, line = -1, box = null, act = null, t = 0, lineAt = 0, go = null;
    const speaker = (key) => (key === 'hero' ? heroName() : key ? (place.saves.find((s) => s.id === key) || { name: key }).name : '');
    function paint() {
      if (sn.phase === 'talk' && (was !== 'talk' || line !== sn.line)) {
        if (box) box.remove();
        const [key, text, about, show] = sc.talk[sn.line], at = sn.line;           // `about`: someone the line tells of, shown with it
        if (!show || !sc.talk[sn.line - 1] || sc.talk[sn.line - 1][3] !== show) lineAt = t;   // the same picture over two lines stays as it is
        box = add(`<div class="say">${about ? face(about, 0) : key === 'hero' ? face(who, 0) : key ? face(key, 3) : ''}${key ? `<b>${esc(speaker(key))}</b>` : ''}<p>${esc(text)}</p><i>&gt;</i></div>`);
        box.addEventListener('click', () => { beep(440); Net.send({ type: 'next', line: at }); });        // either of them may tap; the line number stops a double tap skipping one
      }
      if (box && sn.phase === 'talk') {                                                // read it: wait for the other one to finish reading
        const done = !!(sn.read && sn.read[who]);
        box.classList.toggle('read', done); box.querySelector('i').textContent = done ? `Čeká se na ${heroName(mate())}…` : '>';
      }
      if (sn.phase !== 'talk' && box) { box.remove(); box = null; }
      if (sn.phase === 'stub' && was !== 'stub') {
        const card = add(`<div class="card"><h2>${esc(sc.name)}</h2><p>Tahle část se teprve staví.</p><button class="btn">Dál</button></div>`);
        card.querySelector('button').addEventListener('click', () => { beep(520, 660); Net.send({ type: 'done' }); });
      }
      if (sn.phase === 'play' && !act) act = { run: Runner, platform: Platform, drums: Drums, shoot: Shoot, echo: Echo, find: Find, salon: Salon, memory: Memory, collect: Collect, rescue: Rescue, tower: Tower }[sc.play](sc, place, sn);
      if (act) act.sync(sn);
      if (act && (sn.phase === 'won' || sn.phase === 'lost') && was !== sn.phase) act.over(sn.phase === 'won');
      const held = K.ui.querySelector('.card.pause');
      if (sn.paused && sn.phase === 'play' && !held) {                                    // paused, by either of them: both see it
        const by = sn.pausedBy && sn.pausedBy !== who && mateHere() ? `${heroName(sn.pausedBy)} dal${sn.pausedBy === 'kel' ? 'a' : ''} pauzu.` : 'Hra stojí.';
        const card = add(`<div class="card pause"><h2>Pauza</h2><p>${esc(by)}</p><div class="two"><button class="btn" data-a="resume">Hrát dál</button><button class="btn red" data-a="back">Zpět na mapu</button></div></div>`);
        card.addEventListener('click', (e) => { const b = e.target.closest('[data-a]'); if (b) { beep(520); Net.send({ type: b.dataset.a }); } });
      } else if (held && (!sn.paused || sn.phase !== 'play')) held.remove();
      was = sn.phase; line = sn.line;
    }
    return {
      music: sc.music,                                                  // the level's own tune, if it has one (world.js)
      enter() {
        const bar = add(`<div class="bar"><button data-back>&lt; ${esc(WORLD.regions[place.region].name)}</button><span>${esc(sc.name)}</span></div>`);
        bar.querySelector('[data-back]').addEventListener('click', () => Net.send({ type: 'back' }));
        draft(sc.bg);
        paint();
      },
      sync(s) { sn = s.scene; paint(); },
      fx(m) { if (act && act.fx) act.fx(m); },
      get act() { return act; },
      down(x, y) { if (act && sn.phase === 'play' && !sn.paused) act.down(x, y); },      // games answer the moment a finger lands, not when it lifts
      move(x, y, dx) { if (act && act.move && !sn.paused) act.move(x, y, dx); },
      tap(x, y) { if (act && act.tap) { if (!sn.paused) act.tap(x, y); } else if (!act && box) box.click(); },
      update(dt) {
        t += dt; if (act && !sn.paused) act.update(dt);                                   // paused: everything stands still
        K.hush(!!sn.paused && sn.phase === 'play');                                       // and the music goes quiet
        if (act && sn.phase === 'play' && !sn.paused) {                                  // 2, 1, Start! while the game gets going
          const c = (sn.startAt - Net.now()) / 1000;
          if (!go) go = add('<p class="go"></p>');
          const text = c > 0 ? String(Math.ceil(c)) : c > -0.6 ? 'Start!' : '';
          if (go.textContent !== text) { go.textContent = text; if (text) beep(text === 'Start!' ? 880 : 520); }
        } else if (go) { go.remove(); go = null; }
      },
      draw() {
        const show = !act && sn.phase === 'talk' && sc.talk[sn.line] && sc.talk[sn.line][3];
        if (show) return memory(show, t - lineAt, t);                         // a picture instead of the scene, for this line of the story
        if (sc.bg && !K.picture(sc.bg)) return K.background(sc.bg);         // the level's picture is still on its way: only the loading dots
        if (act) return act.draw();
        K.background(sc.bg, 0, place.look);
        const gy = (sc.ground || GROUND) - 10;                                // a little further back, clear of the speech box
        const rock = sc.play === 'rescue' && sc.rescue.land;
        (sc.cast || []).forEach((id, i) => (rock ? K.figure(id, rock.x - 10 + i * 20, rock.y - 4 - Math.round(Math.abs(Math.sin(t * 4 + i * 1.7)) * 3), 'cheer', t, true, 0.31) : K.figure(id, 146 + i * 26, gy, 'stand', t, true)));
        const board = sc.run && sc.run.board && K.has('aussie', 'surfboard');
        const e = Math.min(1, t / 1.2), came = 1 - (1 - e) * (1 - e), on = e < 1;                 // walking in from the left as the scene opens
        const at = (x) => Math.round(-26 + (x + 26) * came), pose = on ? (board ? 'surf' : 'run') : 'stand';
        if (mateHere()) { if (board) K.figure('aussie', at(98) - 2, gy + 4, 'surfboard', 0, true, 0.48); K.hero(mate(), at(98), gy, pose, on ? t * 0.7 : t + 0.3); }
        if (board) K.figure('aussie', at(56) - 2, gy + 4, 'surfboard', 0, true, 0.48);
        K.hero(who, at(56), gy, pose, on ? t * 0.7 : t);
      },
    };
  };

  // Pictures that go with a line of the story instead of the scene, like a short film. The past is shown in the
  // brown tones of an old photograph: praděda Václav is remembered, not met.
  function oldPhoto(x, y, w, h) {                                     // brown tones and darker edges over what is drawn there
    ctx.save();
    ctx.globalCompositeOperation = 'color'; rect(x, y, w, h, 'rgb(150,112,72)');
    ctx.globalCompositeOperation = 'multiply'; rect(x, y, w, h, 'rgb(255,238,210)');
    ctx.restore();
    for (let i = 0; i < 6; i++) { const a = 0.07 * (6 - i); rect(x + i, y + i, w - 2 * i, 1, `rgba(43,31,26,${a})`); rect(x + i, y + h - 1 - i, w - 2 * i, 1, `rgba(43,31,26,${a})`); rect(x + i, y + i, 1, h - 2 * i, `rgba(43,31,26,${a})`); rect(x + w - 1 - i, y + i, 1, h - 2 * i, `rgba(43,31,26,${a})`); }
  }
  function memory(kind, u, t) {
    const wait = { ship: 'australia-sea', travellers: 'australia-beach' }[kind];
    if (wait && !K.picture(wait)) return K.background(wait);           // its picture is still on its way: only the loading dots
    if (kind === 'ship') {                                              // the refugee ship crossing the ocean after the war
      K.background('australia-sea', u * 18, WORLD.places.find((p) => p.id === 'australia').look, true);
      const x = 18 + u * 9, y = 203 + Math.round(Math.sin(u * 2.2));
      for (let k = 0; k < 4; k++) { const f = (u * 0.7 + k / 4) % 1; if (K.has('voyage', 'smoke')) K.figure('voyage', x - 4 - f * 26, y - 28 - f * 26, 'smoke', 0, false, 0.28 + f * 0.25); }
      if (K.has('voyage', 'ship')) K.figure('voyage', x, y, 'ship', 0, false, 0.5);
      for (let i = 0; i < 2; i++) { const gx = ((u * 26 + i * 110) % 250) - 30; if (K.has('voyage', 'gull1')) K.figure('voyage', gx, 92 + i * 26 + Math.round(Math.sin(u * 3 + i) * 4), Math.floor(u * 4 + i) % 2 ? 'gull1' : 'gull2', 0, false, 0.32); }
      oldPhoto(0, 0, W, H);
    } else if (kind === 'photo') {                                      // his photograph, with Filip, his little dog
      rect(0, 0, W, H, '#3A2F33');
      for (let y = 30; y < H; y += 14) rect(0, y, W, 1, 'rgba(255,248,231,.04)');
      const a = Math.min(1, u / 0.9), fx = 36, fy = 44, fw = 120, fh = 156;
      ctx.save(); ctx.globalAlpha = a;
      rect(fx - 6, fy - 6, fw + 12, fh + 12, '#6E4A2A'); rect(fx - 4, fy - 4, fw + 8, fh + 8, '#9A6B3C'); rect(fx - 1, fy - 1, fw + 2, fh + 2, '#5A3B20');
      rect(fx, fy, fw, fh, '#E9D8B4');
      rect(fx, fy + fh - 34, fw, 34, '#CDB894');                       // the ground in the photo
      if (K.sprites.vaclav) K.figure('vaclav', fx + 48, fy + fh - 8, 'front', 0, false, 0.8);       // a close photograph: bigger than in the game
      if (K.has('dog', 'sit')) K.figure('dog', fx + 94, fy + fh - 8, 'sit', 0, true, 0.48);
      oldPhoto(fx, fy, fw, fh);
      for (const [cx, cy] of [[fx, fy], [fx + fw - 6, fy], [fx, fy + fh - 6], [fx + fw - 6, fy + fh - 6]]) rect(cx, cy, 6, 6, 'rgba(43,31,26,.55)');   // photo corners
      ctx.restore();
    } else if (kind === 'travellers') {                                 // today: two people looking out to sea, seen from behind
      const pl = WORLD.places.find((p) => p.id === 'australia'), gy = 228;
      K.background('australia-beach', 0, pl.look);
      const walk = Math.max(0, 1 - u / 1.4);                            // they walk up to the water's edge
      pl.saves.forEach((sv, i) => { if (K.sprites[sv.id]) K.figure(sv.id, 80 + i * 32, gy + Math.round(walk * 30) - (walk > 0 ? Math.round(Math.abs(Math.sin(u * 8 + i))) : 0), 'back', t); });
    }
  }

  // What every game shares: its own bar in place of the scene's, a line of advice, and the card at the end.
  function stage(barHtml, advice) {
    const hud = add(`<div class="bar hud">${barHtml}</div>`);
    K.ui.firstElementChild.remove();
    // Pause, top left where the other screens have their back button: it stops the game for both of them and offers
    // to carry on or to go back to the map (see Play, which shows the pause for whoever's phone it is).
    const quit = add('<button class="quit" aria-label="Pauza"><i></i><i></i></button>');
    quit.addEventListener('click', () => { beep(440); Net.send({ type: 'pause' }); });
    const tip = add(`<p class="tip">${esc(advice)}</p>`);
    return {
      hud, tip,
      end(won, title, text) {
        tip.remove(); quit.remove(); K.ui.querySelectorAll('.pad, .card.pause').forEach((p) => p.remove());
        const stars = won && st() && st().scene && st().scene.stars;                       // how well it went, from the room
        const card = add(`<div class="card"><h2>${esc(title)}</h2>${stars ? `<p class="stars" aria-label="${stars} ${stars === 1 ? 'hvězda' : 'hvězdy'} ze 3">${starText(stars)}</p>` : ''}<p>${esc(text)}</p>${won ? '<p class="saved">✓ Uloženo</p>' : ''}<div class="two"><button class="btn" data-a="${won ? 'cont' : 'retry'}">${won ? 'Dál' : 'Znovu'}</button>${won ? '' : '<button class="btn" data-a="map">Mapa</button>'}</div></div>`);
        card.addEventListener('click', (e) => { const b = e.target.closest('[data-a]'); if (!b) return; beep(520, 660); Net.send({ type: b.dataset.a === 'map' ? 'back' : b.dataset.a }); });
        beep(...(won ? [520, 660, 780, 1040] : [220, 160]));
      },
    };
  }
  // The buttons along the bottom, the same in every game: moving (◀ ▶, held down) under the left thumb, the main
  // thing to do under the right one, big and yellow. Tapping the picture still works as well.
  // A key is { id, label, side: 'left' | 'right', big, hidden, count, press(), release() }; 'left' and 'right' are arrows.
  function pad(keys, look) {
    const html = (k) => `<button class="key${k.big ? ' big' : ''}" data-k="${k.id}"${k.hidden ? ' hidden' : ''}>${k.id === 'left' || k.id === 'right' ? `<i class="arrow ${k.id}"></i>` : `<span>${esc(k.label)}</span>`}${k.count !== undefined ? '<b></b>' : ''}</button>`;
    const el = add(`<div class="pad${look ? ' ' + look : ''}"><div>${keys.filter((k) => k.side === 'left').map(html).join('')}</div><div>${keys.filter((k) => k.side !== 'left').map(html).join('')}</div></div>`);
    const btn = (id) => el.querySelector(`[data-k="${id}"]`);
    for (const k of keys) {
      const b = btn(k.id);
      const off = () => { if (!b.classList.contains('on')) return; b.classList.remove('on'); if (k.release) k.release(); };
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation(); if (b.disabled || (st() && st().scene && st().scene.paused)) return;
        b.classList.add('on'); try { b.setPointerCapture(e.pointerId); } catch (x) { /* not every browser */ }
        if (k.press) k.press();
      });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, off);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      // iPhones: a finger held on a button must not bring up the magnifier, select text or zoom in. Cancelling the
      // touch stops all of that; the pointer events the buttons work by still arrive.
      b.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    }
    return {
      show(id, yes) { btn(id).hidden = !yes; },
      enable(id, yes) { btn(id).disabled = !yes; },
      label(id, text) { btn(id).querySelector('span').textContent = text; },
      count(id, n) { const b = btn(id).querySelector('b'); if (b) b.textContent = n; },
      mark(id, yes) { const b = btn(id); if (b) b.classList.toggle('ready', !!yes); },
    };
  }
  const hearts = (el, n, max) => { el.innerHTML = Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join(''); };
  // Stand-in pictures of the things you can pick up, about 12 pixels across, centred on (x, y).
  function item(kind, x, y, twinkle) {
    x = Math.round(x); y = Math.round(y);
    if (twinkle !== undefined) for (let k = 0; k < 4; k++) {                              // something to grab: it twinkles
      const a = k / 4 * Math.PI * 2 + twinkle * 2, r = 11 + Math.sin(twinkle * 6 + k) * 2;
      if (Math.sin(twinkle * 9 + k * 2) > -0.3) rect(Math.round(x + Math.cos(a) * r) - 1, Math.round(y + Math.sin(a) * r) - 1, 2, 2, k % 2 ? '#FFF1A8' : '#FFD43A');
    }
    const art = WORLD.items[kind] && WORLD.items[kind].art;
    if (art && K.has(art[0], art[1])) { const sp = K.sprites[art[0]]; return K.figure(art[0], x, y + 7, art[1], 0, false, 14 / Math.max(sp.w, sp.h) * 1.15); }
    if (kind === 'drumstick') { for (let i = 0; i < 8; i++) rect(x - 5 + i, y + 3 - i, 2, 2, '#B98850'); rect(x + 2, y - 6, 4, 4, '#8A5A2B'); }
    else { rect(x - 5, y - 4, 10, 3, '#D2A064'); rect(x - 5, y - 4, 3, 9, '#D2A064'); rect(x + 2, y - 4, 3, 3, '#CC2233'); rect(x - 5, y + 2, 3, 3, '#CC2233'); }
  }

  // The walk: a street (or a hill) to get along on foot, like the stories' trails. ◀ ▶ walk, Skok jumps (hold it to
  // jump higher), Hoď throws: Kendrick his puck, flat and fast, Kellyn her bunny, in an arc. Things to climb, enemies
  // that walk and fly (jump on them, or hit them), coins and clues to collect, and a door (or a gate) at the end.
  // Each of them walks the street on their own phone; the enemies move by the clock, so both see them in the same
  // place. Out of hearts, you float in a bubble behind your partner, who frees you by jumping into it. The walk is
  // lost only when nobody is left walking.
  function Platform(sc, place, sn) {
    const cfg = sc.platform, who = me(), GY = sc.ground || GROUND, SPEED = 66, G = 640, JUMP = 250, STEP = 9, HALF = 7, TALL = 40;
    const L = Room.course.platform(sc), LEN = L.length;
    // The things to climb are pictures (tools/sprites.py: P17 in the street, P18 on the hill), each fitted to its
    // block's width and standing on whatever is under it; the stone terraces are tiled from the stone wall picture.
    const PROP = { car1: 'street', car2: 'street', bench: 'street', bin: 'street', wall: 'street', boulder: 'hill', logs: 'hill' };
    L.blocks.forEach((b, i) => { const c = b.x + b.w / 2; b.base = L.blocks.slice(0, i).reduce((m, o) => (c > o.x && c < o.x + o.w ? Math.max(m, o.h) : m), 0); });
    const art = (sheet, pose) => K.has(sheet, pose) && K.sprites[sheet].sizes && K.sprites[sheet].sizes[pose];
    const hillImg = new Image(); hillImg.src = K.asset(`assets/sprites/${(K.sprites.hill || {}).file || 'hill.png'}`);
    const SIZE = { pigeon: [9, 16], flyer: [9, 7], crow: [10, 7], cone: [6, 12], puddle: [9, 2] };   // half-width, and height (flyers: half-height round their middle)
    const CLUES = { comb: ['prague', 'comb'], clip: ['salonkit', 'clip'], note: ['strahov', 'note'] };
    const s = { t: 0, over: false, lost: false, me: { x: who === 'kel' && mateHere() ? 18 : 36, y: 0, vy: 0, face: 1, ground: true, inv: 0, hurt: -9, cool: 0, sent: 0, done: false },
      mate: { x: who === 'kel' ? 36 : 18, y: 0, face: 1, pose: 'stand', tx: null, ty: 0 }, dir: 0, held: { left: false, right: false }, jumpHeld: false,
      shots: [], cam: 0, pops: [], whack: -9, told: false, freed: -9 };
    let live = sn;
    const view = stage('<span class="lives"></span><span class="count"></span><span class="meter"><i></i></span>', 'Šipkami jdeš, Skok skáče, Hoď hází.');
    const steer = () => { s.dir = (s.held.right ? 1 : 0) - (s.held.left ? 1 : 0); };
    const keys = pad([
      { id: 'left', side: 'left', press: () => { s.held.left = true; steer(); }, release: () => { s.held.left = false; steer(); } },
      { id: 'right', side: 'left', press: () => { s.held.right = true; steer(); }, release: () => { s.held.right = false; steer(); } },
      { id: 'throw', label: 'Hoď', press: () => throwIt() },
      { id: 'jump', label: 'Skok', big: true, press: () => jump(), release: () => cut() },
    ], 'walk');                                                                                  // big arrows: walking is most of the game here
    const out = (w) => !!(live.out && live.out[w]);
    const powered = () => !!sc.pickup && Net.now() < live.power;
    const beaten = (id) => live.beaten.includes(id);
    const paint = () => {
      hearts(view.hud.firstElementChild, out(who) ? 0 : live.hp[who], live.max);
      view.hud.children[1].textContent = `★ ${live.got.length}`;
      view.hud.lastElementChild.firstElementChild.style.width = clamp(s.me.x / L.goal, 0, 1) * 100 + '%';
    };
    paint();
    function jump() { const m = s.me; if (s.over || s.t < 0 || out(who) || m.done || !m.ground) return; m.vy = JUMP; m.ground = false; s.jumpHeld = true; beep(520); }
    function cut() { s.jumpHeld = false; if (s.me.vy > 90) s.me.vy = 90; }               // let go early: a little hop
    function throwIt() {
      const m = s.me; if (s.over || s.t < 0 || out(who) || m.done || m.cool > 0) return;
      m.cool = 0.45;
      const shot = shoot(who, m.x + m.face * 8, m.y + 28, m.face, true);
      s.shots.push(shot); beep(who === 'ken' ? 330 : 660);
      Net.send({ type: 'fx', k: 'throw', x: Math.round(shot.x), y: Math.round(shot.y), f: m.face });
    }
    // Kendrick's puck slides fast along the ground: off the edge of a wall or a car it drops to the pavement and slides
    // on, and against a wall it stops. Kellyn's bunny goes up a little and comes down again.
    const shoot = (w, x, y, face, real) => (w === 'ken' ? { w, x, y: y - 25, vx: face * 230, vy: 0, g: 0, left: 0.8, slide: true, real } : { w, x, y: y - 12, vx: face * 150, vy: 110, g: 420, left: 1.1, real });
    // Where everyone is, and what touches what.
    const foesNow = () => L.foes.map((f) => L.at(f, s.t)).filter(Boolean).map((p, i) => p).filter((p) => !beaten(p.id));
    const kindOf = (id) => L.foes[parseInt(id, 10)].kind;
    function beat(p, how) {
      if (beaten(p.id)) return;
      live.beaten.push(p.id);                                                                  // gone here at once; the room tells the other phone
      Net.send({ type: 'ev', e: 'beat', id: p.id });
      s.pops.push({ x: p.x, y: p.y + 10, at: s.t, kind: kindOf(p.id), dir: p.dir || 1 });
      beep(how === 'stomp' ? 700 : 300, 900);
    }
    function hurt() {
      const m = s.me; if (m.inv > 0 || out(who) || m.done) return;
      m.inv = 1.4; m.hurt = s.t; m.vy = 120; m.ground = false; beep(200, 150);
      Net.send({ type: 'ev', e: 'hurt' }); Net.send({ type: 'fx', k: 'hurt' });
    }
    // The bubble someone out of hearts floats in: it trails behind the one still walking, and drifts over their head
    // when they stop, so that a little hop reaches it.
    const bubbleAt = () => (s.bub ? { x: s.bub.x, y: s.bub.y + Math.sin(s.t * 3) * 2 } : null);
    function drift(dt) {
      const someone = out(who) ? who : mateHere() && out(mate()) ? mate() : null;
      if (!someone) { s.bub = null; return; }
      const walker = someone === who ? s.mate : s.me, moving = someone === who ? s.mate.pose === 'run' : s.dir !== 0;
      const to = { x: walker.x - walker.face * (moving ? 22 : 0), y: walker.y + 62 };
      if (!s.bub) s.bub = someone === who ? { x: s.me.x, y: s.me.y + 62 } : { x: s.mate.x, y: s.mate.y + 62 };
      s.bub.x += (to.x - s.bub.x) * Math.min(1, dt * 3); s.bub.y += (to.y - s.bub.y) * Math.min(1, dt * 3);
    }
    function move(dt) {
      const m = s.me;
      if (m.done) return;
      const wasAir = !m.ground;
      // walking, and the things in the way: a low step is walked up, anything taller stops you
      let nx = m.x + s.dir * SPEED * dt;
      if (s.dir) m.face = s.dir;
      for (const b of L.blocks) {
        if (nx + HALF > b.x && nx - HALF < b.x + b.w && b.h > m.y + (m.ground ? STEP : 0.5)) nx = s.dir > 0 ? Math.min(nx, b.x - HALF) : Math.max(nx, b.x + b.w + HALF);
      }
      m.x = clamp(nx, 8, LEN - 8);
      const floor = L.top(m.x, HALF - 2);
      if (m.ground && floor > m.y && floor - m.y <= STEP) m.y = floor;                         // up a step
      if (m.ground && floor < m.y) m.ground = false;                                           // off an edge
      if (!m.ground) {
        m.vy -= G * dt * (s.jumpHeld && m.vy > 0 ? 0.75 : 1);
        m.y += m.vy * dt;
        if (m.y <= floor && m.vy <= 0) { m.y = floor; m.vy = 0; m.ground = true; if (wasAir) beep(180); }
      }
    }
    function touch() {
      const m = s.me;
      if (out(who) || m.done) return;
      for (const p of foesNow()) {
        const k = kindOf(p.id), [hw, h] = SIZE[k], flying = k === 'flyer' || k === 'crow';
        if (p.falling) continue;                                                               // a cone still dropping from its tree
        const lo = flying ? p.y - h : p.y, hi = flying ? p.y + h : p.y + h;
        if (Math.abs(p.x - m.x) > hw + HALF - 2 || m.y > hi || m.y + TALL < lo) continue;
        if (k === 'puddle') { if (m.ground && m.y < 1) hurt(); continue; }
        if (powered()) { beat(p, 'whack'); s.whack = s.t; continue; }                         // the drumstick: everything in the way is knocked flying
        if (m.vy < 0 && m.y > lo + (hi - lo) * 0.45) { beat(p, 'stomp'); m.vy = JUMP * 0.62; m.ground = false; continue; }   // landed on it
        hurt();
      }
      for (const it of L.items) {
        if (it.kind === 'pickup' ? live.picked || !sc.pickup : live.got.includes(it.id)) continue;
        if (Math.abs(it.x - m.x) < 10 && it.h + 6 > m.y && it.h - 6 < m.y + TALL) {
          if (it.kind === 'pickup') { live.picked = true; Net.send({ type: 'ev', e: 'pick' }); beep(660, 880, 1100); continue; }
          live.got.push(it.id); Net.send({ type: 'ev', e: 'got', id: it.id }); beep(it.kind === 'coin' ? 990 : 660, it.kind === 'coin' ? 1320 : 990);
          if (it.kind === 'heart') say(live.hp[who] < live.max ? 'Srdíčko navíc!' : 'Srdíčko! (Už máš všechna.)');
          s.pops.push({ x: it.x, y: it.h + 14, at: s.t, got: it.kind });
        }
      }
      // the partner floating in a bubble: jump into it to let them out
      const b = mateHere() && out(mate()) && t() - s.freed > 1 ? bubbleAt() : null;
      if (b && !m.ground && Math.abs(b.x - m.x) < 14 && m.y + TALL + 4 > b.y - 12) { s.freed = t(); Net.send({ type: 'ev', e: 'revive' }); beep(523, 659, 784, 1047); }
    }
    const t = () => s.t;
    function fly(dt) {
      s.shots = s.shots.filter((sh) => {
        sh.x += sh.vx * dt; sh.vy -= sh.g * dt; sh.y += sh.vy * dt; sh.left -= dt;
        if (sh.slide) {                                                                            // the puck: on the ground, falling off edges
          const floor = L.top(sh.x, 2);
          if (floor > sh.y + 5) return false;                                                     // into a wall
          if (sh.y > floor + 3) { sh.vy -= 700 * dt; sh.y = Math.max(floor + 3, sh.y + sh.vy * dt); } else { sh.y = floor + 3; sh.vy = 0; }
        }
        if (sh.left <= 0 || sh.y < L.top(sh.x) - 2) return false;                               // spent, or into the ground or a wall
        if (!sh.real) return true;
        for (const p of foesNow()) {
          const k = kindOf(p.id); if (k === 'puddle') continue;
          const [hw, h] = SIZE[k], mid = k === 'flyer' || k === 'crow' ? p.y : p.y + h / 2;
          if (Math.abs(p.x - sh.x) < hw + 4 && Math.abs(mid - sh.y) < h / (k === 'flyer' || k === 'crow' ? 1 : 2) + 6) { beat(p, 'hit'); return false; }
        }
        return true;
      });
    }
    return {
      s, kind: 'platform',
      control: { hold(dir) { s.held.left = dir < 0; s.held.right = dir > 0; steer(); }, jump, cut, throwIt },
      peek: () => ({ x: s.me.x, y: s.me.y, ground: s.me.ground, done: s.me.done, out: out(who), mateOut: mateHere() && out(mate()), face: s.me.face,
        foes: foesNow().map((p) => ({ dx: p.x - s.me.x, y: p.y, kind: kindOf(p.id) })), wall: L.blocks.filter((b) => b.x - s.me.x > -4 && b.x - s.me.x < 26 && b.h > s.me.y + STEP).map((b) => b.h)[0] || 0,
        bubble: mateHere() && out(mate()) ? bubbleAt() : null, goal: L.goal, got: live.got.length, cool: s.me.cool }),
      sync(n) {
        const wasOut = out(who), mateWas = mateHere() && out(mate()); live = n;
        if (wasOut && !out(who)) { s.me.x = s.bub ? s.bub.x : s.mate.x; s.me.y = L.top(s.me.x); s.me.vy = 0; s.me.ground = true; s.me.inv = 1.6; say(who === 'kel' ? 'Jsi volná! Díky.' : 'Jsi volný! Díky.'); }   // let out of the bubble, where it was
        if (!wasOut && out(who)) say(mateHere() && !out(mate()) ? `Jsi v bublině. ${heroName(mate())} se zastaví a vyskočí pro tebe.` : 'Došla srdíčka.');
        if (!mateWas && mateHere() && out(mate()) && !out(who)) say(`${heroName(mate())} je v bublině! Zastav se a vyskoč.`);
        if (live.picked && sc.pickup && !s.told) { s.told = true; say(WORLD.items[sc.pickup].dash); }
        paint();
      },
      fx(m) {
        if (m.k === 'pos') { s.mate.tx = m.x; s.mate.ty = m.y; s.mate.face = m.f; s.mate.pose = m.p; }
        if (m.k === 'throw') s.shots.push(shoot(mate(), m.x, m.y, m.f, false));
        if (m.k === 'hurt') s.mate.hurt = s.t;
      },
      over(won) {
        s.over = true; s.lost = !won; paint();
        const count = (k) => live.got.filter((id) => k.includes(L.items[id].kind)).length, n = count(['coin']), clues = count(['comb', 'clip']), notes = count(['note']);
        const found = cfg.gate === 'salon' ? `Sebrali jste ${n} mincí${clues ? ` a ${clues === 2 ? 'hřeben i sponku' : 'jednu stopu'}` : ''}.` : `Sebrali jste ${notes} not.`;
        view.end(won, won ? (cfg.gate === 'salon' ? 'Jste u kadeřnictví!' : 'Jste nahoře!') : 'Au!', won ? found : 'Došla vám srdíčka. Zkuste to ještě jednou.');
      },
      down() {},                                                                               // tapping the picture does nothing: only Skok jumps
      move() {},
      update(dt) {
        if (s.over) return;
        s.t = clock(live);
        const m = s.me;
        if (m.inv > 0) m.inv -= dt;
        if (m.cool > 0) m.cool -= dt;
        if (s.t >= 0 && !out(who)) { move(dt); touch(); }
        fly(dt); drift(dt);
        if (!m.done && !out(who) && m.x >= L.goal) { m.done = true; Net.send({ type: 'ev', e: 'finish' }); beep(784, 988, 1175); if (mateHere() && !out(mate()) && !live.fin[mate()]) say(`Hotovo! Počkej na ${heroName(mate())}.`); }
        if (live.fin && live.fin[who] === undefined && m.done && Net.now() - (m.sentFin || 0) > 1500) { m.sentFin = Net.now(); Net.send({ type: 'ev', e: 'finish' }); }   // in case the first was lost
        // where I am, for the other phone, a few times a second
        if (mateHere() && Net.now() - m.sent > 140) {
          m.sent = Net.now();
          const pose = m.done ? 'cheer' : !m.ground ? 'jump' : s.dir ? 'run' : 'stand';
          Net.send({ type: 'fx', k: 'pos', x: Math.round(m.x), y: Math.round(m.y), f: m.face, p: pose });
        }
        const b = s.mate; if (b.tx !== null) { b.x += (b.tx - b.x) * Math.min(1, dt * 10); b.y += (b.ty - b.y) * Math.min(1, dt * 10); }
        const lead = out(who) && mateHere() ? s.mate : m;                                        // out: the camera follows the one still walking
        s.cam = clamp(lead.x - 72, 0, LEN - W);
        if (s.tipAt && s.t - s.tipAt > 3) { view.tip.textContent = ''; s.tipAt = 0; }
        paint();
      },
      draw() {
        const tt = Math.max(0, s.t), cam = Math.round(s.cam), X = (x) => Math.round(x - cam), Y = (y) => Math.round(GY - y);
        K.background(sc.bg, cam * 0.6, place.look, sc.tile === 'repeat');
        for (const f of L.foes) if (f.kind === 'cone') pine(X(f.x1 + 4), Y(L.top(f.x1)));         // the spruces the cones drop from
        for (const b of L.blocks) if (b.x + b.w > cam - 4 && b.x < cam + W + 4) block(b, X(b.x));
        gate(cfg.gate, X(L.goal + 12));
        for (const it of L.items) {
          if (it.kind === 'pickup' ? live.picked || !sc.pickup : live.got.includes(it.id)) continue;
          const x = X(it.x), y = Y(it.h) - Math.round(Math.sin(tt * 4 + it.id) * 2);
          if (x < -10 || x > W + 10) continue;
          if (it.kind === 'coin') coin(x, y, tt + it.id * 0.3);
          else if (it.kind === 'heart') { const sz = art('street', 'heart'), k = 1 + Math.sin(tt * 6) * 0.08; if (sz) K.figure('street', x, y + 6, 'heart', 0, false, 12 / sz[1] * k); else { rect(x - 5, y - 4, 4, 4, '#CC2233'); rect(x + 1, y - 4, 4, 4, '#CC2233'); rect(x - 4, y, 8, 3, '#CC2233'); } }
          else if (it.kind === 'pickup') item(sc.pickup, x, y - 6, tt);
          else { const a = CLUES[it.kind]; if (a && K.has(a[0], a[1])) { const sp = K.sprites[a[0]]; K.figure(a[0], x, y + 6, a[1], 0, false, 16 / Math.max(sp.w, sp.h) * 1.2); } else coin(x, y, tt); }
        }
        for (const p of foesNow()) { const x = X(p.x); if (x > -20 && x < W + 20) foe(kindOf(p.id), x, Y(p.y), p, tt); }
        // knocked out: a pigeon flaps off, a crow tumbles, a cone bursts
        s.pops = s.pops.filter((q) => tt - q.at < 0.8);
        for (const q of s.pops) {
          const u = (tt - q.at) / 0.8, x = X(q.x), y = Y(q.y);
          if (q.got) { const r = Math.round(u * 10); rect(x - 1, y - 8 - r, 2, 2, '#FFD43A'); rect(x - 6 - r / 2, y - 4 - r, 2, 2, '#FFF1A8'); rect(x + 5 + r / 2, y - 4 - r, 2, 2, '#FFF1A8'); continue; }
          if (q.kind === 'pigeon' || q.kind === 'flyer') { if (K.has('prague', 'pigeonfly')) K.figure('prague', x + Math.round(u * 40 * q.dir), y - Math.round(u * 50), 'pigeonfly', tt, q.dir < 0, 0.36); }
          else if (K.has('things', 'flash')) K.figure('things', x, y - Math.round(u * 20), 'flash', 0, false, 0.6);
        }
        // the heroes: the partner from their last word, then me on top
        const hero = (w, b, pose, blink) => { if (!blink) K.hero(w, X(b.x), Y(b.y), pose, tt, b.face < 0); };
        if (mateHere()) {
          if (out(mate())) { if (s.bub) bubble(mate(), bubbleAt(), X, Y, tt); }
          else hero(mate(), s.mate, tt - (s.mate.hurt || -9) < 0.45 ? 'dizzy' : s.mate.pose, false);
        }
        const m = s.me, swing = powered() && tt - s.whack < 0.25;
        if (out(who)) { if (mateHere() && s.bub) bubble(who, bubbleAt(), X, Y, tt); else K.hero(who, X(m.x), Y(m.y), 'dizzy', tt, m.face < 0); }
        else hero(who, m, s.lost ? 'dizzy' : m.done ? 'cheer' : tt - m.hurt < 0.45 ? 'dizzy' : swing ? 'drum' : m.cool > 0.3 ? 'shoot' : !m.ground ? 'jump' : s.dir ? 'run' : 'stand', m.inv > 0 && Math.floor(tt * 14) % 2);
        if (powered() && !out(who)) { const left = (live.power - Net.now()) / 1000; if (left > 1.5 || Math.floor(tt * 8) % 2) item(sc.pickup, X(m.x + m.face * 10), Y(m.y + 44)); }
        for (const sh of s.shots) {                                                              // in the air: the puck, the bunny
          const x = X(sh.x), y = Y(sh.y);
          if (sh.w === 'ken') { if (K.has('things', 'puckfly')) K.figure('things', x, y + 4, 'puckfly', 0, sh.vx < 0, 0.45); else rect(x - 4, y - 2, 8, 4, INK); }
          else if (K.has('things', 'bunnyfly')) K.figure('things', x, y + 8, Math.floor(tt * 6) % 2 ? 'bunnyflip' : 'bunnyfly', 0, sh.vx < 0, 0.5);
          else rect(x - 3, y - 3, 6, 6, '#FFF8E7');
        }
      },
    };
    function say(text) { view.tip.textContent = text; s.tipAt = s.t || 0.01; }
    function block(b, x) {
      const sheet = PROP[b.kind], size = sheet && art(sheet, b.kind);
      if (size) return K.figure(sheet, x + b.w / 2, GY - b.base, b.kind, 0, b.kind.startsWith('car') && (b.x / 10 | 0) % 2 === 1, b.w / size[0]);   // some cars parked the other way round
      if (b.kind === 'stones' && art('hill', 'stones') && hillImg.complete && hillImg.naturalWidth) return stones(b, x);
      drawn({ ...b, kind: { car1: 'car', car2: 'car', stones: 'step', boulder: 'rock', logs: 'log' }[b.kind] || b.kind }, x, Math.round(GY - b.h));
    }
    // A stone terrace: the stone wall picture repeated along it, grass on top, more stone below.
    function stones(b, x) {
      const sp = K.sprites.hill, [ow, oh] = sp.sizes.stones, sx = Math.floor((sp.w - ow) / 2) + 8, sy = sp.h - oh, tw = ow - 16;
      const top = Math.round(GY - b.h), bottom = Math.round(GY - b.base);
      ctx.save(); ctx.beginPath(); ctx.rect(x, top, b.w, bottom - top); ctx.clip();
      for (let tx = x; tx < x + b.w; tx += tw) {
        const lip = b.h - b.base < 14 ? 4 : 0;                                                    // a low step: less grass, more stone
        ctx.drawImage(hillImg, sx, sy + lip, tw, oh - lip, tx, top, tw, oh - lip);
        for (let ty = top + oh - lip; ty < bottom; ty += oh - 6) ctx.drawImage(hillImg, sx, sy + 6, tw, oh - 6, tx, ty, tw, oh - 6);
      }
      ctx.restore();
    }
    // Stand-ins, drawn here, for when the pictures are missing: benches, bins, parked cars, walls, stone steps, rocks and logs.
    function drawn(b, x, top) {
      const w = b.w, h = b.h, gy = GY;
      if (b.kind === 'bench') { rect(x, top, w, 4, '#6E4A2A'); rect(x, top, w, 1, '#A8743F'); rect(x + 2, top + 4, 3, h - 4, '#3A3A40'); rect(x + w - 5, top + 4, 3, h - 4, '#3A3A40'); rect(x + 1, top - 7, w - 2, 3, '#8A5A2B'); rect(x + 3, top - 4, 2, 4, '#3A3A40'); rect(x + w - 5, top - 4, 2, 4, '#3A3A40'); }
      else if (b.kind === 'bin') { rect(x, top + 2, w, h - 2, '#2F7D3A'); rect(x + 1, top + 3, w - 2, 2, '#3F9A45'); rect(x - 1, top, w + 2, 3, '#245C2C'); for (let i = x + 3; i < x + w - 2; i += 4) rect(i, top + 7, 1, h - 10, '#276B31'); rect(x + 2, gy - 2, 3, 2, INK); rect(x + w - 5, gy - 2, 3, 2, INK); }
      else if (b.kind === 'car') {
        const col = ['#CC2233', '#1F55D6', '#E8E4DA', '#2FA7A0'][(b.x / 10 | 0) % 4];
        rect(x, top + 8, w, h - 13, col); rect(x + 8, top, w - 18, 9, col); rect(x + 10, top + 2, (w - 22) / 2 - 1, 6, '#9FD3F0'); rect(x + 11 + (w - 22) / 2, top + 2, (w - 22) / 2 - 1, 6, '#9FD3F0');
        rect(x, top + 8, w, 1, 'rgba(255,255,255,.35)'); rect(x + w - 3, top + 11, 3, 2, '#FFD43A'); rect(x, top + 11, 2, 2, '#CC2233');
        for (const wx of [x + 10, x + w - 10]) { rect(wx - 5, gy - 7, 10, 7, INK); rect(wx - 2, gy - 5, 4, 3, '#8A8F9C'); }
      }
      else if (b.kind === 'wall') { rect(x, top, w, h, '#A65A3A'); for (let y = top + 2, r = 0; y < gy; y += 5, r++) { rect(x, y + 3, w, 1, '#7A3E26'); for (let i = x + (r % 2 ? 3 : 7); i < x + w; i += 9) rect(i, y, 1, 4, '#7A3E26'); } rect(x - 1, top, w + 2, 2, '#C9C2B8'); }
      else if (b.kind === 'step') { rect(x, top, w, h, '#8E979F'); rect(x, top, w, 2, '#B8BEC6'); rect(x, top + 2, w, 1, '#6E777F'); for (let i = x + 6; i < x + w; i += 17) rect(i, top + 3, 1, h - 3, '#737C85'); if (b.h > 9) rect(x, top - 1, 6, 1, '#5DB85A'); }
      else if (b.kind === 'rock') { rect(x + 2, top, w - 4, h, '#7B828A'); rect(x, top + 4, w, h - 4, '#7B828A'); rect(x + 3, top + 1, w - 8, 2, '#A4ABB2'); rect(x + w - 6, top + 6, 3, h - 8, '#5F666D'); rect(x + 3, top - 1, 7, 2, '#5DB85A'); }
      else if (b.kind === 'log') { rect(x, top, w, h, '#8C5A2B'); for (let y = top + 1; y < gy - 2; y += 8) { rect(x, y + 6, w, 2, '#6E4420'); rect(x + w - 6, y + 1, 5, 5, '#C9945C'); rect(x + w - 5, y + 2, 3, 3, '#A66B36'); } rect(x, top, w, 1, '#B07A3A'); }
      else { rect(x, top, w, h, '#8A8F9C'); rect(x, top, w, 2, '#B8BEC6'); }
    }
    // The end: the salon's door with its sign, or the stadium's gate with a flag.
    function gate(kind, x) {
      if (x < -60 || x > W + 60) return;
      if (kind === 'salon' && art('street', 'salon')) return K.figure('street', x + 22, GY, 'salon', 0, false, 1);   // its door is on the left
      if (kind !== 'salon' && art('hill', 'gatel')) { K.figure('hill', x - 4, GY, 'gatel', 0, false, 1); K.figure('hill', x + 46, GY, 'gater', 0, false, 1); return; }
      if (kind === 'salon') {
        rect(x - 4, GY - 74, 46, 74, '#3A2F33'); rect(x, GY - 62, 18, 62, '#B9DDF0'); rect(x + 1, GY - 61, 16, 60, '#7FB4D6'); rect(x + 14, GY - 34, 2, 6, '#FFD43A');
        rect(x - 6, GY - 86, 50, 13, INK); rect(x - 5, GY - 85, 48, 11, '#F0448F');
        for (let i = 0; i < 5; i++) { rect(x + 12 + i, GY - 83 + i, 1, 1, '#FFF8E7'); rect(x + 16 - i, GY - 83 + i, 1, 1, '#FFF8E7'); } rect(x + 10, GY - 79, 3, 3, '#FFF8E7'); rect(x + 16, GY - 79, 3, 3, '#FFF8E7');   // scissors on the sign
        rect(x + 22, GY - 60, 16, 22, '#FFF1C4'); rect(x + 22, GY - 60, 16, 2, '#F0448F');
      } else {
        rect(x - 6, GY - 80, 8, 80, '#8E979F'); rect(x + 36, GY - 80, 8, 80, '#8E979F'); rect(x - 8, GY - 86, 54, 8, '#6E777F');
        for (let i = x + 4; i < x + 34; i += 5) rect(i, GY - 78, 2, 78, '#46536A');
        rect(x + 40, GY - 112, 2, 30, '#B8BEC6'); rect(x + 42, GY - 112, 14, 9, '#CC2233'); rect(x + 42, GY - 108, 14, 2, '#FFF8E7');
      }
    }
    function foe(k, x, y, p, tt) {
      if (k === 'puddle') { if (K.has('prague', 'puddle')) K.figure('prague', x, y + 2, 'puddle', 0, false, 0.36); else { rect(x - 9, y - 2, 18, 3, '#7CC6F2'); } return; }
      if (k === 'pigeon') { const bob = Math.round(Math.abs(Math.sin(tt * 8 + p.x))) ; if (K.has('prague', 'pigeon')) K.figure('prague', x, y + 1 - bob, 'pigeon', tt, p.dir < 0, 0.36); else rect(x - 6, y - 12, 12, 12, '#8A8F9C'); return; }
      if (k === 'flyer') { if (K.has('prague', 'pigeonfly')) K.figure('prague', x, y + 9, 'pigeonfly', tt, p.dir < 0, 0.36); return; }
      if (k === 'crow') { if (K.has('strahov', 'crow')) K.figure('strahov', x, y + 9, 'crow', tt, p.dir > 0, 0.36); else rect(x - 7, y - 4, 14, 8, INK); return; }
      if (k === 'cone') {
        ctx.save(); ctx.translate(x, y - 6); ctx.rotate(-p.spin);
        if (K.has('strahov', 'cone')) K.figure('strahov', 0, 7, 'cone', 0, false, 0.3); else rect(-5, -6, 10, 12, '#8C5A2B');
        ctx.restore();
      }
    }
    function pine(x, foot) {
      if (x < -24 || x > W + 24) return;
      if (art('hill', 'spruce')) return K.figure('hill', x, foot, 'spruce', 0, false, 0.8);
      rect(x - 2, foot - 14, 4, 14, '#6E4420');
      for (let i = 0; i < 4; i++) { const w = 22 - i * 5, y = foot - 18 - i * 11; rect(x - w / 2, y, w, 9, '#2F6B3A'); rect(x - w / 2 + 2, y, w - 6, 3, '#3F8A45'); }
      rect(x - 1, foot - 64, 2, 4, '#2F6B3A');
    }
    function coin(x, y, tt) {
      const sz = art('street', 'coin');
      if (sz) { ctx.save(); ctx.translate(x, 0); ctx.scale(Math.max(0.2, Math.abs(Math.cos(tt * 3))), 1); K.figure('street', 0, y + 6, 'coin', 0, false, 12 / sz[1]); ctx.restore(); return; }   // spinning
      const w = Math.max(1, Math.round(Math.abs(Math.cos(tt * 3)) * 6));
      rect(x - w, y - 6, w * 2, 12, '#B8862A'); rect(x - w + 1, y - 5, Math.max(1, w * 2 - 2), 10, '#FFD43A'); if (w > 3) rect(x - 1, y - 3, 2, 6, '#E6B340');
    }
    function bubble(w, b, X, Y, tt) {
      const x = X(b.x), y = Y(b.y), r = 13;
      for (let a = 0; a < 40; a++) { const u = a / 40 * Math.PI * 2; rect(Math.round(x + Math.cos(u) * r), Math.round(y + Math.sin(u) * r), 1, 1, a % 5 ? '#BFE8FF' : '#FFFFFF'); }
      rect(x - 7, y - 9, 3, 2, '#FFFFFF');
      K.figure(w, x, y + 10, 'dizzy', tt, false, 0.3);
    }
  }

  // The dash: the scene scrolls past, obstacles arrive on a beat, tap to jump. Low things are jumped, high things
  // are ducked by staying on the ground. Both run the same course and share the lives; each jumps for themselves.
  function Runner(sc, place, sn) {
    const cfg = sc.run, SPEED = 86, G = 560, JUMP = 200, X = 50, GY = sc.ground || GROUND, who = me(), max = sn.lives;
    const { obs, pickAt } = Room.course.run(sn.seed, sc);
    const how = sc.pickup && WORLD.items[sc.pickup].use;                    // 'hit' (the drumstick) or 'throw' (the boomerang)
    const s = { t: 0, y: 0, vy: 0, inv: 0, over: false, lost: false, obs, pickAt, asked: false, told: false, sent: 0, mate: { y: 0, vy: 0 },
      throws: 0, fly: null, whack: -9, mateFly: null, how };
    let live = sn;
    const view = stage('<span class="lives"></span><span class="meter"><i></i></span>', `Skákej tlačítkem nebo klepnutím${cfg.high ? '. Pod letící věcí zůstaň dole' : ''}.`);
    const keys = pad([{ id: 'throw', label: 'Hoď', side: 'left', hidden: true, count: 0, press: () => throwIt() }, { id: 'jump', label: 'Skok', big: true, press: () => jump() }]);
    const powered = () => how === 'hit' && Net.now() < live.power;
    const paint = () => { hearts(view.hud.firstElementChild, live.lives, max); view.hud.lastElementChild.firstElementChild.style.width = clamp(s.t / cfg.seconds, 0, 1) * 100 + '%'; };
    const runner = (w, x, gy, b, pose) => {
      if (cfg.board) { if (K.has('aussie', 'surfboard')) K.figure('aussie', x - 2, gy - b.y + 4, 'surfboard', 0, true, 0.48); else { rect(x - 12, gy - b.y - 1, 24, 4, INK); rect(x - 11, gy - b.y, 22, 2, '#F2C94C'); } }
      K.hero(w, x, gy - b.y - (cfg.board ? 1 : 0), pose || (b.y > 0 ? 'jump' : cfg.board ? 'surf' : 'run'), Math.max(0, s.t));
    };
    // The boomerang is thrown: it flies ahead at chest height, knocks out the first thing in its way, and comes back.
    function paintButton() { if (s.how === 'throw') { keys.count('throw', s.throws); keys.enable('throw', !s.fly && s.throws > 0); } }
    function giveBoomerang() { s.throws = 3; keys.show('throw', true); paintButton(); }
    function jump() { if (!s.over && s.t > 0 && s.y <= 0) { s.vy = JUMP; beep(520); Net.send({ type: 'fx', k: 'jump' }); if (!s.told) view.tip.textContent = ''; } }
    function throwIt() {
      if (s.over || s.fly || !s.throws) return;
      s.throws--; s.fly = { x: X + 8, y: GY - s.y - 26, vx: 190, back: false, hit: false };
      beep(660, 880); Net.send({ type: 'fx', k: 'throw' }); paintButton();
    }
    function flyStep(f, dt, mine) {
      f.x += (f.back ? -1 : 1) * f.vx * dt;
      if (!f.back && f.x > X + 150) f.back = true;
      if (f.back && f.x <= X) return null;
      if (mine && !f.hit) for (const o of obs) {                                          // the first obstacle it meets, high or low
        if (o.hit) continue;
        const ox = X + (o.at - s.t) * SPEED;
        if (Math.abs(ox - f.x) < 10) { o.hit = true; o.smashed = s.t; f.hit = true; f.back = true; beep(300, 700); break; }
      }
      return f;
    }
    return {
      s, kind: 'run',
      sync(n) {
        live = n; paint();
        if (live.picked && !s.told) {
          s.told = true; view.tip.textContent = WORLD.items[sc.pickup].dash;
          if (how === 'throw') giveBoomerang();
        }
        if (s.told && how === 'hit' && !powered() && !s.over) view.tip.textContent = '';
      },
      fx(m) { if (m.k === 'hurt') s.mateHurt = s.t; if (m.k === 'jump' && s.mate.y <= 0) s.mate.vy = JUMP; if (m.k === 'throw' && !s.mateFly) s.mateFly = { x: X - 14, y: GY - 31, vx: 190, back: false }; },
      over(won) { s.over = true; s.lost = !won; paint(); view.end(won, won ? 'Zvládnuto!' : 'Au!', won ? 'Jste na místě.' : 'Zkuste to ještě jednou.'); },
      down() { jump(); },
      throwIt,
      update(dt) {
        if (s.over) return;
        s.t = clock(live);
        for (const b of [s, s.mate]) if (b.vy !== 0 || b.y > 0) { b.y += b.vy * dt; b.vy -= G * dt; if (b.y <= 0) { b.y = 0; b.vy = 0; } }
        if (s.inv > 0) s.inv -= dt;
        if (s.fly) { s.fly = flyStep(s.fly, dt, true); if (!s.fly) paintButton(); }
        if (s.mateFly) s.mateFly = flyStep(s.mateFly, dt, false);
        if (pickAt !== null && !live.picked && !s.asked && Math.abs((pickAt - s.t) * SPEED) < 11 && s.y > 10) { s.asked = true; beep(660, 880, 1100); Net.send({ type: 'ev', e: 'pick' }); }   // jumped into the pick-up
        for (const o of obs) {
          if (o.hit || s.inv > 0) continue;
          const d = (o.at - s.t) * SPEED;
          if (powered() && d > 0 && d < 16) { o.hit = true; o.smashed = s.t; s.whack = s.t; beep(300, 600); continue; }   // the drumstick: whack it before it reaches you
          if (Math.abs(d) > 8 || !(o.high ? s.y > 12 : s.y < 9)) continue;
          o.hit = true; o.knock = s.t; s.hurt = s.t;                                       // knocked away; a stumble and a heart lost
          s.inv = 1.1; beep(200, 150); Net.send({ type: 'ev', e: 'hurt' }); Net.send({ type: 'fx', k: 'hurt' });
        }
        if (s.t >= cfg.seconds && Net.now() - s.sent > 1000) { s.sent = Net.now(); Net.send({ type: 'ev', e: 'finish' }); }
        paint();
      },
      draw() {
        const t = Math.max(0, s.t);
        K.background(sc.bg, t * SPEED, place.look, sc.tile === 'repeat');
        for (const o of obs) {
          const x = Math.round(X + (o.at - t) * SPEED);
          if (x < -12 || x > W + 12) continue;
          if (o.smashed) {
            const u = t - o.smashed; if (u > 0.4) continue;
            if (K.has('things', 'flash')) K.figure('things', x, (o.high ? GY - 46 : GY - 4) - Math.round(u * 30), 'flash', 0, false, 0.6);
            else { rect(x - 9, GY - 20, 18, 2, '#FFD43A'); rect(x - 1, GY - 28, 2, 18, '#FFD43A'); }
            continue;
          }
          const look = cfg.art && (o.alt ? cfg.art.alt : cfg.art[o.high ? 'high' : 'low']);
          if (look && K.has(look[0], look[1])) {                                             // drawn obstacles; a second drawing, if there is one, takes turns with the first
            let pose = look.length > 2 && Math.floor(t * 6) % 2 ? look[2] : look[1], dy = o.high ? Math.round(Math.sin(t * 8 + o.at) * 2) : 0, dx = 0;
            const flies = K.has(look[0], look[1] + 'fly');                                   // a pigeon takes off once it is passed, or bumped into
            if (o.knock !== undefined) { const u = t - o.knock; if (u > 0.7) continue; dy -= Math.round(u * 70); dx = Math.round(u * 40); if (flies) pose = look[1] + 'fly'; }
            else if (flies && x < X - 6) { pose = look[1] + 'fly'; dy -= Math.round((X - 6 - x) * 0.9); }
            K.figure(look[0], x + dx, (o.high ? GY - 54 : GY + 1) + dy, pose, t, false, 0.36);
          }
          else if (o.high) { rect(x - 7, GY - 62, 14, 5, INK); rect(x - 6, GY - 61, 12, 3, '#D2A064'); }
          else { rect(x - 6, GY - 10, 12, 10, INK); rect(x - 5, GY - 9, 10, 9, '#E0862E'); rect(x - 3, GY - 14, 6, 5, INK); rect(x - 2, GY - 13, 4, 4, '#E0862E'); }
        }
        if (pickAt !== null && !live.picked) { const x = X + (pickAt - t) * SPEED; if (x > -12 && x < W + 12) item(sc.pickup, x, GY - 50 + Math.round(Math.sin(t * 5) * 2), t); }
        if (mateHere() && !(t - (s.mateHurt || -9) < 1 && Math.floor(t * 14) % 2)) runner(mate(), X - 30, GY - 5, s.mate, t - (s.mateHurt || -9) < 0.45 ? 'dizzy' : null);   // a step behind; blinks when hurt
        const swing = powered() && t - s.whack < 0.25, stumble = t - (s.hurt || -9) < 0.45;
        if (s.lost) K.hero(who, X, GY, 'dizzy', t);
        else if (!(s.inv > 0 && Math.floor(t * 14) % 2)) runner(who, X, GY, s, stumble ? 'dizzy' : swing ? 'drum' : null);
        if (stumble) { const u = (t - s.hurt) / 0.45, hy = Math.round(GY - s.y - 62 - u * 14); rect(X - 4, hy, 3, 3, '#CC2233'); rect(X + 1, hy, 3, 3, '#CC2233'); rect(X - 3, hy + 2, 6, 3, '#CC2233'); rect(X - 1, hy + 5, 2, 2, '#CC2233'); }   // a heart flies off
        const left = (live.power - Net.now()) / 1000;
        if (powered() && !swing && (left > 1.5 || Math.floor(t * 8) % 2)) item(sc.pickup, X + 8, GY - s.y - 60);   // held up; blinks when nearly spent
        for (const f of [s.fly, s.mateFly]) {                                                    // the boomerang spinning through the air
          if (!f) continue;
          const pose = Math.floor(t * 12) % 2 ? 'boomerang2' : 'boomerang';
          if (K.has('aussie', pose)) K.figure('aussie', f.x, f.y + 7, pose, 0, false, 0.3);
          else { rect(f.x - 5, f.y - 2, 10, 3, '#D2A064'); rect(f.x - 5, f.y - 2, 3, 7, '#D2A064'); }
        }
      },
    };
  }

  // The drums: notes fall down three lanes in time with the beat. Tap a lane's drum as its note reaches the line.
  // Nothing is lost for a miss. Both play the same song and their hits are added up.
  function Drums(sc, place, sn) {
    const cfg = sc.drums, FALL = 92, LINE = 230, TOP = 22, WINDOW = 0.15, LANE = W / 3, who = me();
    const PADS = [['#CC2233', 'kick'], ['#FFD43A', 'snare'], ['#3E7BD6', 'cymbal']];      // colour and sound
    const KIT = ['kick', 'snare', 'cymbal'];
    const { notes, pick } = Room.course.drums(sn.seed, sc), last = notes[notes.length - 1].at;
    const s = { t: 0, over: false, notes, flash: [0, 0, 0], good: [0, 0, 0], bad: [0, 0, 0], taps: 0, mateTaps: 0, pick, asked: false, told: false, sent: 0 };
    let live = sn;
    const view = stage('<span class="count"></span><span class="meter"><i></i></span>', 'Klepni na buben, až je nota na čáře.');
    view.tip.classList.add('up');
    const powered = () => Net.now() < live.power;
    const paint = () => { view.hud.firstElementChild.textContent = `${live.hits} / ${live.need}`; view.hud.lastElementChild.firstElementChild.style.width = clamp(live.hits / live.need, 0, 1) * 100 + '%'; };
    return {
      s, kind: 'drums',
      sync(n) {
        live = n; paint();
        if (powered() && !s.told) { s.told = true; view.tip.textContent = WORLD.items[sc.pickup].drums; }
        if (s.told && !powered() && !s.over) view.tip.textContent = '';
      },
      fx(m) { if (m.k === 'tap') { const l = clamp(m.lane | 0, 0, 2); s.flash[l] = 0.12; s.mateTaps++; drum(KIT[l]); } },
      over(won) { s.over = true; paint(); const [a, b] = (sc.say && sc.say.won) || ['To je rytmus!', 'Dveře povolily.']; view.end(won, won ? a : 'Skoro!', won ? b : `Máte ${live.hits} z ${live.need} potřebných. Zkuste to ještě jednou.`); },
      down(x) {
        if (s.over) return;
        const lane = clamp(Math.floor(x / LANE), 0, 2);
        s.flash[lane] = 0.12; s.taps++;
        Net.send({ type: 'fx', k: 'tap', lane });
        drum(KIT[lane]);
        if (pick && !live.picked && !s.asked && lane === pick.lane && Math.abs(pick.at - s.t) <= WINDOW + 0.05) {      // caught the pick-up on the line
          s.asked = true; beep(660, 880, 1100); return Net.send({ type: 'ev', e: 'pick' });
        }
        let best = null;
        for (const n of notes) if (n.lane === lane && !n.hit && !n.gone && Math.abs(n.at - s.t) <= WINDOW && (!best || Math.abs(n.at - s.t) < Math.abs(best.at - s.t))) best = n;
        if (best) { best.hit = true; s.good[lane] = 0.35; Net.send({ type: 'ev', e: 'hit', n: powered() ? 2 : 1 }); if (!s.told) view.tip.textContent = ''; }
        else if (s.t > 0) { s.bad[lane] = 0.35; Net.send({ type: 'ev', e: 'miss' }); }                  // a drum hit with no note on it costs a point
      },
      update(dt) {
        if (s.over) return;
        s.t = clock(live);
        for (let i = 0; i < 3; i++) { s.flash[i] -= dt; s.good[i] -= dt; s.bad[i] -= dt; }
        for (const n of notes) if (!n.hit && !n.gone && s.t - n.at > WINDOW) n.gone = true;
        if (s.t > last + 0.9 && Net.now() - s.sent > 1000) { s.sent = Net.now(); Net.send({ type: 'ev', e: 'finish' }); }   // said again each second until the room has heard both
      },
      draw() {
        K.background(sc.bg, 0, place.look);
        const two = mateHere();                                                                // they drum along in the room, a stroke for every tap
        const cast = sc.cast || [], wide = cast.length ? 40 : 22;
        rect(0, TOP, W, H - TOP, 'rgba(43,31,26,.38)');                                     // the stage dims a little; the band stays bright
        cast.forEach((id, i) => K.figure(id, W / 2 + i * 26, 204, 'act', s.t));                    // Alan drums along
        if (two) K.hero(mate(), W / 2 + wide, 206, 'drum', s.mateTaps / 9, true);
        K.hero(who, two || cast.length ? W / 2 - wide : W / 2, 206, 'drum', s.taps / 9);
        for (let i = 1; i < 3; i++) rect(i * LANE - 1, TOP, 2, LINE - TOP, 'rgba(255,248,231,.18)');
        for (let i = 0; i < 3; i++) {                                                               // a slot on each drum, where a note is hit
          const x = i * LANE + LANE / 2;
          rect(x - 17, LINE - 7, 34, 14, '#FFF8E7'); rect(x - 15, LINE - 5, 30, 10, 'rgba(43,31,26,.75)');
        }
        for (const n of notes) {
          if (n.hit) continue;
          const y = Math.round(LINE - (n.at - s.t) * FALL), x = n.lane * LANE + LANE / 2;
          if (y < TOP + 6 || y > H) continue;
          rect(x - 15, y - 5, 30, 10, INK); rect(x - 14, y - 4, 28, 8, n.gone ? '#7A6F6A' : PADS[n.lane][0]); rect(x - 12, y - 3, 24, 2, n.gone ? '#8A7F7A' : '#FFF8E7');
        }
        if (pick && !live.picked && s.t - pick.at <= WINDOW + 0.05) { const y = Math.round(LINE - (pick.at - s.t) * FALL); if (y > TOP + 10) item(sc.pickup, pick.lane * LANE + LANE / 2, y); }
        const left = (live.power - Net.now()) / 1000;
        if (left > 0 && (left > 2 || Math.floor(s.t * 8) % 2)) item(sc.pickup, 12, 34);         // held; blinks when nearly spent
        for (let i = 0; i < 3; i++) {                      // the three drums along the bottom
          const x = i * LANE + 4, on = s.flash[i] > 0;
          if (s.good[i] > 0) { const u = 1 - s.good[i] / 0.35; for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2, r = 8 + u * 20; rect(Math.round(x + LANE / 2 - 4 + Math.cos(a) * r), Math.round(LINE + Math.sin(a) * r * 0.7), 3, 3, k % 2 ? '#FFD43A' : '#FFF8E7'); } }   // a hit: a burst of stars
          if (s.bad[i] > 0) { const cx = x + LANE / 2 - 4; for (let k = -4; k <= 4; k++) { rect(cx + k, LINE + k, 2, 2, '#CC2233'); rect(cx + k, LINE - k, 2, 2, '#CC2233'); } }   // nothing there: a red cross
          rect(x, 236, LANE - 8, 44, INK); rect(x + 2, 238 + (on ? 2 : 0), LANE - 12, 38, PADS[i][0]);
          rect(x + 8, 244 + (on ? 2 : 0), LANE - 24, 8, on ? '#FFF8E7' : 'rgba(255,248,231,.45)');
          const kit = ['bassdrum', 'snare', 'cymbal'][i];
          if (K.has('strahov', kit)) K.figure('strahov', x + LANE / 2 - 4, 278 + (on ? 2 : 0), kit, 0, false, 0.5);
        }
      },
    };
  }

  // The shot: targets pop up around the scene and slip away again after a moment. Tap where the shot should go.
  // Kendrick fires a puck with his hockey stick, flat and fast. Kellyn takes turns lobbing her white bunny in an
  // arc and throwing a star. They stand at either side and shoot at the same targets; each device sees its own
  // hero on the left. Whoever hits a target first gets it, and the ones that get away cost them both.
  function Shoot(sc, place, sn) {
    const cfg = sc.shoot, who = me(), GY = sc.ground || GROUND, BODY = 26, G = 420, max = sn.lives;
    const hand = (w, x, dir) => (w === 'ken' ? { x: x + dir * 28, y: GY - 4 } : { x: x + dir * 20, y: GY - 34 });   // where a shot leaves: the blade of the stick, or her hand
    const mine = hand(who, BODY, 1), theirs = hand(mate(), W - BODY, -1);
    const { targets } = Room.course.shoot(sn.seed, sc, sn.every);
    const s = { t: 0, over: false, lost: false, shots: [], pops: [], cool: 0, swing: 0, mateSwing: 0, thrown: 0, again: null, got: new Set(), told: new Set(), asked: false, said: false, seen: 0 };
    let live = sn;
    // With two playing, each has their own padlocks, marked with their colour: Kendrick's red, Kellyn's pink.
    const COLOUR = { ken: '#CC2233', kel: '#F0448F' }, owner = (tg) => (tg.id % 2 ? 'kel' : 'ken'), own = (tg) => !mateHere() || owner(tg) === who;
    const view = stage('<span class="lives"></span><span class="count"></span><span class="meter"><i></i></span>', mateHere() ? `Klepni na zámek s ${who === 'ken' ? 'červenou' : 'růžovou'} cedulkou. To jsou tvoje.` : 'Klepni na zámek a sestřel ho.');
    const paint = () => { hearts(view.hud.firstElementChild, live.lives, max); view.hud.children[1].textContent = `${live.hits} / ${live.need}`; view.hud.lastElementChild.firstElementChild.style.width = clamp(live.hits / live.need, 0, 1) * 100 + '%'; };
    const tx = (tg) => tg.x + Math.sin(s.t * 2 + tg.phase) * (cfg.sway || 0);
    const done = (tg) => s.got.has(tg.id) || live.hit.includes(tg.id) || live.missed.includes(tg.id);
    const up = (tg) => tg.born <= s.t && s.t - tg.born <= cfg.stay && !done(tg);
    const aimedAt = (tg) => !done(tg) && s.shots.some((sh) => sh.real && sh.aim === tg.id) && s.t - tg.born <= cfg.stay + 0.9;   // a shot on its way still counts
    const pickAt = () => (sc.pickup && !live.picked && s.t > 2 ? { x: W + 12 - (((s.t - 2) * 24) % (W + 24)), y: 64 + Math.sin(s.t * 3) * 6 } : null);   // drifts across until it is hit
    // One shot from `from` towards (x, y). Only one's own shots can hit anything; the other hero's are for show.
    function fire(w, from, x, y, real, star, aim) {
      const dx = x - from.x, dy = y - from.y, back = live.item === 'boomerang', d = Math.hypot(dx, dy) || 1;
      const kind = w === 'ken' ? 'puck' : star ? 'star' : 'bunny';
      if (kind !== 'bunny' || back) {                                                     // straight and fast; with the boomerang it turns round and comes home
        const v = kind === 'puck' ? 280 : 250;
        s.shots.push({ kind, real, aim, from, x: from.x, y: from.y, vx: dx / d * v, vy: dy / d * v, g: 0, r: 12, turn: back ? s.t + Math.max(0.35, d / v + 0.12) : 0 });
      } else { const T = Math.max(0.4, Math.abs(dx) / 170); s.shots.push({ kind, real, aim, from, x: from.x, y: from.y, vx: dx / T, vy: (dy - 0.5 * G * T * T) / T, g: G, r: 13 }); }
    }
    function shoot(x, y, aim) {
      const star = who === 'kel' && s.thrown++ % 2 === 1;                                 // Kellyn takes turns: bunny, star, bunny, star
      fire(who, mine, x, y, true, star, aim);
      Net.send({ type: 'fx', k: 'shot', x, y, star });                                    // the other device shows it flying to the same spot, from where this hero stands there
    }
    return {
      s, kind: 'shoot', spot: (tg) => ({ x: tx(tg), y: tg.y }), live: () => targets.filter((tg) => up(tg) && own(tg)), pickAt,
      sync(n) {
        for (const id of n.hit.slice(s.seen)) { const tg = targets[id]; if (tg && !s.got.has(id)) s.pops.push({ x: tx(tg), y: tg.y, at: s.t }); }   // the other one's hits flash too
        s.seen = n.hit.length;
        live = n; paint();
        if (live.item && !s.said) { s.said = true; view.tip.textContent = WORLD.items[live.item].shot; }
      },
      fx(m) { if (m.k === 'shot') { fire(mate(), theirs, m.x, m.y, false, !!m.star, null); s.mateSwing = 0.25; } },
      over(won) { s.over = true; s.lost = !won; paint(); view.end(won, won ? 'Trefa!' : 'Uteklo vám jich moc.', won ? 'Cesta je volná.' : 'Zkuste to ještě jednou.'); },
      down(x, y) {
        if (s.over || s.cool > 0 || y < 22 || s.t < 0) return;
        // a tap near one of one's padlocks aims right at it; a wild shot takes longer to get ready again
        const near = targets.filter((tg) => up(tg) && own(tg)).map((tg) => ({ tg, d: Math.hypot(tx(tg) - x, tg.y - y) })).sort((a, b) => a.d - b.d)[0];
        const aim = near && near.d < 18 ? near.tg : null;
        if (aim) { x = tx(aim); y = aim.y; }
        shoot(x, y, aim ? aim.id : null);
        if (live.item === 'drumstick') s.again = { at: s.t + 0.13, x: x + 7, y: y - 7 };       // the drumstick's second beat, a little to one side
        s.cool = aim ? 0.3 : 0.7; s.swing = 0.25; beep(who === 'ken' ? 330 : 660); if (!s.said) view.tip.textContent = '';
      },
      update(dt) {
        if (s.over) return;
        s.t = clock(live); s.cool -= dt; s.swing -= dt; s.mateSwing -= dt;
        if (s.again && s.t >= s.again.at) { shoot(s.again.x, s.again.y); s.again = null; }
        const p = pickAt();
        for (const sh of s.shots) {
          sh.x += sh.vx * dt; sh.vy += sh.g * dt; sh.y += sh.vy * dt;
          if (sh.turn && s.t >= sh.turn) { sh.vx = -sh.vx; sh.vy = -sh.vy; sh.turn = 0; sh.home = true; }
          if (sh.home && (sh.vx < 0 ? sh.x <= sh.from.x : sh.x >= sh.from.x)) sh.dead = true;
          if (sh.real && p && !s.asked && Math.hypot(p.x - sh.x, p.y - sh.y) < sh.r + 4) { s.asked = true; beep(660, 880, 1100); Net.send({ type: 'ev', e: 'pick' }); }
          if (sh.real) for (const tg of targets) {
            if (tg.born > s.t) break;
            if (!own(tg) || !(up(tg) || (sh.aim === tg.id && aimedAt(tg))) || Math.hypot(tx(tg) - sh.x, tg.y - sh.y) >= sh.r + (sh.aim === tg.id ? 6 : 0)) continue;
            s.got.add(tg.id); s.pops.push({ x: tx(tg), y: tg.y, at: s.t, kind: sh.kind }); beep(780, 1040); Net.send({ type: 'ev', e: 'hit', id: tg.id });
            if (!sh.turn && !sh.home) sh.dead = true;                                     // a boomerang shot carries on through
            break;
          }
          if (sh.x < -10 || sh.x > W + 10 || sh.y < 10 || sh.y > H + 10) { if (sh.turn) sh.turn = s.t; else sh.dead = true; }
        }
        s.shots = s.shots.filter((sh) => !sh.dead);
        for (const tg of targets) {                                                       // the ones that got away: both devices say so, the room counts each once
          if (tg.born > s.t) break;
          if (s.t - tg.born > cfg.stay && !s.told.has(tg.id) && !done(tg) && !aimedAt(tg)) { s.told.add(tg.id); s.pops.push({ x: tx(tg), y: tg.y, at: s.t, kind: 'gone' }); beep(200, 150); Net.send({ type: 'ev', e: 'miss', id: tg.id }); }
        }
        s.pops = s.pops.filter((q) => s.t - q.at < (q.kind === 'gone' ? 0.7 : 0.25));
        paint();
      },
      draw() {
        K.background(sc.bg, 0, place.look);
        for (const tg of targets) {
          if (tg.born > s.t) break;
          if (!up(tg) && !aimedAt(tg)) continue;
          const x = Math.round(tx(tg)), y = Math.round(tg.y), left = cfg.stay - (s.t - tg.born);
          if (left < 0.9 && left > 0 && Math.floor(s.t * 10) % 2) continue;                    // blinks before it slips away
          if (mateHere()) { const c = COLOUR[owner(tg)]; rect(x + 3, y + 8, 7, 6, INK); rect(x + 4, y + 9, 5, 4, c); rect(x + 5, y + 6, 1, 3, INK); }   // whose it is: a little coloured tag
          if (K.has('prague', 'padlock')) { K.figure('prague', x + Math.round(Math.sin(s.t * 3 + tg.phase)), y + 10, 'padlock', 0, false, 0.36); continue; }
          rect(x - 5, y - 13, 10, 8, '#7A5320'); rect(x - 3, y - 11, 6, 6, place.look.sky);  // a stand-in padlock
          rect(x - 8, y - 6, 16, 13, '#7A5320'); rect(x - 7, y - 5, 14, 11, '#E6B340'); rect(x - 1, y - 2, 2, 5, '#7A5320');
        }
        for (const q of s.pops) {
          const x = Math.round(q.x), y = Math.round(q.y), pose = q.kind === 'bunny' ? 'fluff' : 'flash';
          if (q.kind === 'gone') {                                                               // one that got away: a puff, and a heart rising out of it
            const u = (s.t - q.at) / 0.7;
            for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2, r = 4 + u * 10; rect(Math.round(x + Math.cos(a) * r) - 2, Math.round(y + Math.sin(a) * r) - 2, 4, 4, 'rgba(232,220,196,' + (1 - u).toFixed(2) + ')'); }
            const hy = Math.round(y - 8 - u * 16); rect(x - 4, hy, 3, 3, '#CC2233'); rect(x + 1, hy, 3, 3, '#CC2233'); rect(x - 3, hy + 2, 6, 3, '#CC2233'); rect(x - 1, hy + 5, 2, 2, '#CC2233');
            continue;
          }
          if (K.has('things', pose)) K.figure('things', x, y + 8, pose, 0, false, 0.6);
          else { rect(x - 9, y - 1, 18, 2, '#FFD43A'); rect(x - 1, y - 9, 2, 18, '#FFD43A'); rect(x - 4, y - 4, 8, 8, '#FFF8E7'); }
        }
        const p = pickAt(); if (p) item(sc.pickup, p.x, p.y);
        if (live.item) item(live.item, 12, 34);                                             // what they are holding, up in the corner
        // wound up and ready; swinging through for a moment after each shot. Kellyn's hand stays empty while her bunny is in the air.
        const pose = (w, swing, real) => (swing > 0 || (w === 'kel' && s.shots.some((sh) => sh.kind === 'bunny' && sh.real === real)) ? 'shoot' : 'aim');
        if (mateHere()) K.hero(mate(), W - BODY, GY, pose(mate(), s.mateSwing, false), s.t, true);
        K.hero(who, BODY, GY, s.lost ? 'dizzy' : pose(who, s.swing, true), s.t);
        for (const sh of s.shots) {
          const x = Math.round(sh.x), y = Math.round(sh.y);
          if (sh.kind === 'puck') { if (K.has('things', 'puckfly')) K.figure('things', x, y + 4, 'puckfly', 0, sh.vx < 0, 0.45); else { rect(x - 4, y - 2, 8, 4, INK); rect(x - 3, y - 2, 6, 1, '#7A6F6A'); } }
          else if (sh.kind === 'star' && K.sprites.star) K.prop(K.sprites.star, x, y + 4, Math.floor(s.t * 10) % 2);
          else if (K.has('things', 'bunnyfly')) K.figure('things', x, y + 8, Math.floor(s.t * 6) % 2 ? 'bunnyflip' : 'bunnyfly', 0, sh.vx < 0, 0.5);   // the bunny tumbles as it flies
          else if (K.sprites.bunny) K.prop(K.sprites.bunny, x, y + 11, Math.floor(s.t * 6) % 2);
          else { rect(x - 5, y - 4, 10, 8, '#D9CFC6'); rect(x - 4, y - 3, 8, 6, '#FFFDF8'); }
        }
      },
    };
  }

  // The echo: someone plays a rhythm on four drums, then it has to be played back in the same order. With two
  // playing, each has two of the drums (Kendrick the left pair, Kellyn the right), so they must take turns to get
  // it right. A wrong drum costs a life and the rhythm is played once more; each round it is one stroke longer.
  function Echo(sc, place, sn) {
    const who = me(), PW = W / 4, max = sn.lives, TOP = 236;
    const PADS = [['#CC2233', 'kick'], ['#E0862E', 'tom'], ['#F0448F', 'snare'], ['#3E7BD6', 'cymbal']];
    const s = { t: 0, over: false, lost: false, lit: [0, 0, 0, 0], bad: 0, good: 0, round: sn.round, shownAt: 0, sounded: -1, seen: 0, taps: 0, mateTaps: 0, castTaps: 0 };
    let live = sn;
    const view = stage('<span class="lives"></span><span class="meter"><i></i></span>', '');
    view.tip.classList.add('up');
    const mine = (p) => !mateHere() || (p < 2 ? 'ken' : 'kel') === who;
    const listening = () => Net.now() < live.listenAt;
    const paint = () => {
      hearts(view.hud.firstElementChild, live.lives, max);
      view.hud.lastElementChild.firstElementChild.style.width = clamp((live.round + live.step / live.pattern.length) / live.rounds, 0, 1) * 100 + '%';
      if (!s.over) view.tip.textContent = s.bad > 0 ? 'Vedle! Ještě jednou, poslouchej.' : s.good > 0 ? 'Správně!' : listening() ? 'Poslouchej a dívej se…' : mateHere() ? `Teď vy! Tvoje bubny jsou ${who === 'ken' ? 'vlevo' : 'vpravo'}.` : 'Teď ty!';
    };
    paint();
    return {
      s, kind: 'echo', peek: () => ({ pattern: live.pattern, step: live.step, round: live.round, listening: listening(), mine: [0, 1, 2, 3].filter(mine) }),
      sync(n) {
        if (n.last && n.last.n !== s.seen) {                                           // a stroke, by either of them: show it and sound it
          s.seen = n.last.n; s.lit[n.last.p] = 0.18;
          drum(PADS[n.last.p][1]); if (!n.last.ok) { s.bad = 1.2; beep(160, 120); }
          if ((n.last.p < 2 ? 'ken' : 'kel') === who || !mateHere()) s.taps++; else s.mateTaps++;
        }
        if (n.round > s.round) { s.round = n.round; s.good = 1.2; beep(660, 880); }                  // a whole rhythm played back
        live = n; paint();
      },
      over(won) { s.over = true; s.lost = !won; paint(); view.end(won, won ? 'Sedí to!' : 'Rozhodilo vás to.', won ? 'Rytmus máte v ruce.' : 'Zkuste to ještě jednou.'); },
      down(x, y) {
        if (s.over || y < TOP - 6 || listening()) return;
        const p = clamp(Math.floor(x / PW), 0, 3);
        if (!mine(p)) return beep(120);                                                // the other one's drum
        s.lit[p] = 0.1; Net.send({ type: 'ev', e: 'pad', p });
      },
      update(dt) {
        s.t += dt; if (s.bad > 0) s.bad -= dt; if (s.good > 0) s.good -= dt;
        for (let i = 0; i < 4; i++) if (s.lit[i] > 0) s.lit[i] -= dt;
        if (s.over) return;
        // the rhythm being shown: each stroke lights its drum and sounds, on the room's clock so both see it together
        if (live.showAt !== s.shownAt) { s.shownAt = live.showAt; s.sounded = -1; }
        const i = Math.floor((Net.now() - live.showAt) / (live.beat * 1000));
        if (i > s.sounded && i >= 0 && i < live.pattern.length) { s.sounded = i; s.lit[live.pattern[i]] = live.beat * 0.6; drum(PADS[live.pattern[i]][1]); s.castTaps++; }
        paint();
      },
      draw() {
        K.background(sc.bg, 0, place.look);
        const two = mateHere(), cast = sc.cast || [];
        cast.forEach((id, k) => K.figure(id, W / 2 + k * 26, 206 - (s.castTaps % 2) * 2, listening() ? 'act' : 'three', s.t));   // drumming while he shows it, watching while they play
        const side = (w) => (!two || w === 'ken' ? -1 : 1);                                 // each stands above their own drums: Kendrick left, Kellyn right
        if (two) K.hero(mate(), W / 2 + side(mate()) * 46, 208, 'drum', s.mateTaps / 9, side(mate()) > 0);
        K.hero(who, W / 2 + side(who) * 46, 208, s.lost ? 'dizzy' : 'drum', s.taps / 9, side(who) > 0);
        rect(0, TOP - 14, W, H - TOP + 14, 'rgba(43,31,26,.6)');
        for (let k = 0; k < live.pattern.length; k++) rect(W / 2 - live.pattern.length * 5 + k * 10 + 2, TOP - 10, 6, 6, k < live.step ? '#1FA463' : 'rgba(255,248,231,.35)');   // how much of it is played back
        for (let p = 0; p < 4; p++) {
          const x = p * PW + 3, on = s.lit[p] > 0, own = mine(p), shake = s.bad > 0.7 ? Math.round(Math.sin(s.t * 60) * 2) : 0, up = on ? -4 : 0;
          if (on) rect(x - 2 + shake, TOP - 6, PW + 4, 56, '#FFF8E7');                         // the drum being played lights up whole and jumps
          rect(x + shake, TOP + up, PW - 6, 46, INK); rect(x + 2 + shake, TOP + 2 + up, PW - 10, 40, on ? '#FFF1A8' : PADS[p][0]);
          rect(x + 7 + shake, TOP + 8 + up, PW - 20, 8, on ? PADS[p][0] : 'rgba(255,248,231,.4)');
          const kit = ['bassdrum', 'snare', 'snare', 'cymbal'][p];
          if (K.has('strahov', kit)) K.figure('strahov', x + PW / 2 - 3 + shake, TOP + 42 + up, kit, 0, p === 2, 0.5);
          if (!own) rect(x + 2 + shake, TOP + 2, PW - 10, 40, 'rgba(43,31,26,.5)');                              // the other one's drums are dimmed
        }
      },
    };
  }

  // Finding: koalas hide in the trees. With `hidden` they sit still, small, in the forks and on the trunks, and only
  // twitch now and then as a hint; without it they peek out for a moment and duck back. Tap one to find it.
  // The picture may be wider than the screen: drag to look around. Both look in the same forest, so it pays to
  // search different trees. All of them have to be found before the time runs out.
  function Find(sc, place, sn) {
    const cfg = sc.find, who = me(), GY = sc.ground || GROUND;
    const { koalas } = Room.course.find(sn.seed, sc);
    const s = { t: 0, over: false, lost: false, off: 0, got: new Set(), sent: 0, miss: null, when: {}, pan: 0, pend: null,
      walk: { last: 0, at: -9, dir: 1 }, mate: { off: 0, at: -9, dir: 1 }, told: 0 };
    let live = sn;
    const view = stage('<span class="count"></span><span class="meter time"><i></i></span>', cfg.hidden ? 'Koaly se schovávají ve stromech. Choď šipkami a klepni na koalu.' : 'Koaly vykukují ze stromů. Klepni na ně, než se schovají.');
    pad([{ id: 'left', side: 'left', press: () => { s.pan = -1; }, release: () => { s.pan = 0; } }, { id: 'right', side: 'left', press: () => { s.pan = 1; }, release: () => { s.pan = 0; } }]);
    view.tip.classList.add('up');                                                       // the kid walks along the bottom
    const pic = () => K.picture(sc.bg), width = () => (pic() ? pic().naturalWidth : W), most = () => Math.max(0, width() - W);
    const found = (k) => s.got.has(k.id) || live.found.includes(k.id);
    const out = (k) => { const u = s.t - k.first; return u >= 0 && u % k.period < cfg.show; };                 // peeking right now
    const soon = (k) => { const u = s.t - k.first + 0.6; return u >= 0 && u % k.period < 0.6; };               // leaves rustle just before
    const paint = () => { view.hud.firstElementChild.textContent = `${live.found.length} / ${live.need}`; view.hud.lastElementChild.firstElementChild.style.width = clamp(1 - s.t / cfg.seconds, 0, 1) * 100 + '%'; };
    paint();
    function koala(x, y, happy) {                          // a stand-in koala: round grey head, big ears
      rect(x - 9, y - 9, 6, 6, INK); rect(x + 3, y - 9, 6, 6, INK); rect(x - 8, y - 8, 4, 4, '#B9B4AE'); rect(x + 4, y - 8, 4, 4, '#B9B4AE');
      rect(x - 6, y - 6, 12, 11, INK); rect(x - 5, y - 5, 10, 9, '#A39E98'); rect(x - 1, y - 2, 2, 3, INK);
      rect(x - 4, y - 3, 2, happy ? 1 : 2, INK); rect(x + 2, y - 3, 2, happy ? 1 : 2, INK);
    }
    return {
      s, kind: 'find', peek: () => ({ off: s.off, most: most(), out: koalas.filter((k) => !found(k) && out(k)).map((k) => ({ id: k.id, x: k.x - s.off, y: cfg.hidden ? k.y - 6 : k.y, wx: k.x })) }),
      sync(n) { for (const id of n.found) if (!(id in s.when)) s.when[id] = s.t; live = n; paint(); },
      fx(m) { if (m.k === 'look') { const d = m.off - s.mate.off; if (Math.abs(d) > 0.5) { s.mate.dir = Math.sign(d); s.mate.at = s.t; } s.mate.off = m.off; } },
      over(won) { s.over = true; s.lost = !won; paint(); view.end(won, won ? 'Všechny koaly!' : 'Čas vypršel.', won ? 'Žádná se neschovala.' : `Našli jste ${live.found.length} z ${live.need}. Zkuste to ještě jednou.`); },
      move(x, y, dx) { s.off = clamp(s.off - dx, 0, most()); s.pend = null; },
      down(x, y) {
        if (s.over || s.t < 0 || y < 22) return;
        const k = cfg.hidden
          ? koalas.find((q) => !found(q) && Math.abs(q.x - s.off - x) < 9 && y > q.y - 17 && y < q.y + 3)          // hidden ones can be tapped any time: they are just hard to see
          : koalas.find((q) => !found(q) && out(q) && Math.hypot(q.x - s.off - x, q.y - y) < 14);
        if (k) { s.got.add(k.id); s.when[k.id] = s.t; beep(660, 880, 1100); view.tip.textContent = ''; Net.send({ type: 'ev', e: 'find', id: k.id }); }
        else s.pend = { x, y };                                         // a miss, unless the finger now drags to look round
      },
      tap() { if (s.pend && !s.over) { s.miss = { ...s.pend, at: s.t }; beep(180); } s.pend = null; },
      update(dt) {
        if (s.over) return;
        if (s.pan) s.off = clamp(s.off + s.pan * 70 * dt, 0, most());           // walking along the path with the arrows
        if (Math.abs(s.off - s.walk.last) > 0.3) { s.walk.dir = Math.sign(s.off - s.walk.last); s.walk.at = s.t; s.walk.last = s.off; }   // the view moved: walking
        if (Net.now() - s.told > 200 && s.t - s.walk.at < 0.3) { s.told = Net.now(); Net.send({ type: 'fx', k: 'look', off: Math.round(s.off) }); }
        s.t = clock(live);
        if (s.t >= cfg.seconds && Net.now() - s.sent > 1000) { s.sent = Net.now(); Net.send({ type: 'ev', e: 'finish' }); }
        paint();
      },
      draw() {
        const off = Math.round(clamp(s.off, 0, most()));
        K.background(sc.bg, off, place.look);
        const art = !!K.sprites.koalas;                                                     // drawn koalas once they exist, stand-ins before
        for (const k of koalas) {
          const x = Math.round(k.x - off), y = Math.round(k.y);
          if (x < -12 || x > W + 12) continue;
          if (cfg.hidden && art) {                                                           // small and still; a twitch now and then gives one away
            if (found(k)) { const fresh = s.t - (s.when[k.id] || 0) < 1.5; K.figure('koalas', x, y - (fresh ? Math.round(Math.abs(Math.sin(s.t * 8)) * 3) : 0), fresh ? 'wave' : 'happy', s.t, false, cfg.size * 1.1); rect(x - 1, y - 22, 3, 3, '#1FA463'); }
            else K.figure('koalas', x, y - (out(k) ? 1 : 0), k.pose, s.t, out(k) ? Math.floor(s.t * 12) % 2 === 0 : k.x > width() / 2, cfg.size);
            continue;
          }
          if (found(k)) {
            const bob = Math.round(Math.abs(Math.sin(s.t * 5 + k.id)) * 2);
            if (art) K.figure('koalas', x, y + 11 - bob, s.t - (s.when[k.id] || 0) < 1.5 ? 'wave' : 'happy', s.t, k.x > width() / 2); else koala(x, y - bob, true);
            continue;
          }
          if (out(k)) { if (art) K.figure('koalas', x, y + 11, k.id % 2 ? 'side' : 'peek', s.t, k.id % 2 && k.x < width() / 2); else koala(x, y, false); }
          else if (soon(k)) {                                                                // a rustle in the leaves, just before
            const j = Math.floor(s.t * 14) % 2;
            if (art) K.figure('koalas', x + j - 1, y + 11, 'leaves', s.t);
            else { rect(x - 8 + j * 2, y - 2, 4, 2, '#DDE8B0'); rect(x + 4 - j * 2, y + 2, 4, 2, '#DDE8B0'); }
          }
        }
        if (s.miss && s.t - s.miss.at < 0.25) { const { x, y } = s.miss; rect(x - 4, y - 1, 8, 2, '#FFF8E7'); rect(x - 1, y - 4, 2, 8, '#FFF8E7'); }
        for (const k of koalas) {                                         // a burst of stars round a koala just found
          const u = s.t - (s.when[k.id] === undefined ? -9 : s.when[k.id]); if (u < 0 || u > 0.7) continue;
          const x = k.x - s.off, y = (cfg.hidden ? k.y - 6 : k.y) - 4;
          for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2, r = 6 + u * 22; rect(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r), 2, 2, i % 2 ? '#FFD43A' : '#FFF8E7'); }
        }
        // the kids on the path: one's own in the middle of the view, the other where they have walked to on theirs
        const walking = (w) => s.t - w.at < 0.2, PATH = 274;
        if (mateHere()) { const mx = s.mate.off + W / 2 - off; if (mx > -20 && mx < W + 20) K.hero(mate(), mx, PATH - 2, walking(s.mate) ? 'run' : 'stand', s.t * 0.6, s.mate.dir < 0); }
        K.hero(who, W / 2, PATH, s.lost ? 'dizzy' : walking(s.walk) ? 'run' : 'stand', s.t * 0.6, s.walk.dir < 0);
        if (most() > 0) { rect(W / 2 - 20, H - 6, 40, 2, 'rgba(43,31,26,.6)'); rect(W / 2 - 20 + Math.round(off / most() * 30), H - 6, 10, 2, '#FFD43A'); }   // where in the forest one is looking
      },
    };
  }

  // The salon: customers come in and wait by the door. Each wants a few things done, in order (wash, cut, dye, dry)
  // and then to pay. Tap a customer to take them by the hand, then tap the place they need next; whoever stands at a
  // place works there, and two at one place work twice as fast. Customers who wait too long walk out.
  function Salon(sc, place, sn) {
    const cfg = sc.salon, who = me(), ST = cfg.stations, SPEED = 84, max = sn.lives;
    const NAME = { wash: 'umýt', cut: 'ostříhat', dye: 'obarvit', dry: 'vyfoukat', pay: 'zaplatit' };
    const QUEUE = [[14, 284], [42, 284], [70, 284]], CUST = 0.55;                // three chairs in a row along the bottom, by the door
    const home = (w) => (w === who ? { x: 96, y: 236 } : { x: 120, y: 250 });
    const s = { t: 0, over: false, lost: false, me: { ...home(who), to: null, go: null, walked: [] }, mate: { ...home(mate()), to: null }, shout: 0, seenNo: {}, no: null, tipAt: 0, pops: [] };
    let live = sn;
    const view = stage('<span class="lives"></span><span class="count"></span><span class="clock"></span><span class="meter"><i></i></span>', 'Klepni na zákazníka a pak na místo, kam ho vedeš. Kde stojíš, tam pracuješ.');
    const say = (text) => { view.tip.textContent = text; s.tipAt = s.t; };
    const shout = add('<p class="shout" hidden>NELÍTEJTE!</p>');
    // Leading someone who cannot go where they want yet: let go of them, and they wait in the line again.
    const keys = pad([{ id: 'drop', label: 'Pustit', big: true, hidden: true, press: () => {
      const c = leading(who); if (!c || s.over) return;
      if (queued().length >= QUEUE.length) { beep(180); return say('Židle u dveří jsou plné. Odveď ho tam, kam chce.'); }
      beep(330, 260); Net.send({ type: 'ev', e: 'drop', c: c.id });
    } }]);
    const spot = (i) => ({ x: ST[i].x + (ST[i].side || 13), y: ST[i].y + 18 });                    // where a hairdresser stands to work there
    // Sitting down. The two styling chairs face the mirror, so only the head shows over the back of the chair; at the
    // basin and on the stool under the dryer they sit sideways (the seated sheet, tools/seated.py); at the till they
    // stand. Rows of a customer's picture, for each of the six: the top of the head, the chin, the hip and the knee.
    const HEAD = [8, 12, 0, 8, 24, 12], CHIN = [46, 45, 48, 46, 58, 47], HIP = [86, 86, 83, 84, 91, 88], KNEE = [103, 99, 97, 96, 100, 100];
    const SITS = K.has('seated', 'c0'), BACK = 98, STOOL = { x: 168, y: 142 };                // BACK: the top of the chairs' backs
    function seat(c, i) {
      const st = ST[i], k = c.id % 6;
      if (st.chair) { const chin = k === 4 ? 101 : 97; return { how: 'back', x: st.x, y: chin + (117 - CHIN[k]) * CUST, cx: st.x, top: chin - (CHIN[k] - HEAD[k]) * CUST }; }
      if (SITS && (st.k === 'wash' || st.k === 'dry')) {
        const dry = st.k === 'dry', seatY = dry ? STOOL.y : 122, y = seatY + (115 - KNEE[k]) * CUST, back = dry ? 170 : 21;
        const top = y - (117 - HEAD[k] - (KNEE[k] - HIP[k] - 5)) * CUST;
        return { how: 'side', flip: dry, x: back + (dry ? -14 : 14) * CUST, y, cx: back + (dry ? -3 : 3), top };
      }
      return { how: 'stand', x: st.x, y: st.y + 3, cx: st.x, top: st.y + 3 - 62 };
    }
    // The back of a styling chair, cut out of the picture, to draw in front of whoever sits in it.
    const backs = {};
    function chairBack(i) {
      const img = K.picture(sc.bg); if (!img) return null;
      if (!backs[i]) {
        const x0 = ST[i].x - 23, c = document.createElement('canvas'); c.width = 46; c.height = 26;
        const g = c.getContext('2d'); g.drawImage(img, x0, BACK, 46, 26, 0, 0, 46, 26);
        const d = g.getImageData(0, 0, 46, 26);
        for (let p = 0; p < d.data.length; p += 4) if (0.3 * d.data[p] + 0.59 * d.data[p + 1] + 0.11 * d.data[p + 2] >= 80) d.data[p + 3] = 0;   // the mirror behind stays behind
        g.putImageData(d, 0, 0); backs[i] = { c, x: x0 };
      }
      return backs[i];
    }
    const leading = (w) => live.cust.find((c) => c.by === w);
    const queued = () => live.cust.filter((c) => c.at === -2).sort((a, b) => a.id - b.id);
    const worked = (c) => c.at >= 0 && ST[c.at].k === c.order[c.step];                       // being seen to: the work bar shows instead of what they want
    const body = (w) => (w === who ? s.me : s.mate);
    function where(c) {                                                                         // where a customer is right now, and how
      if (c.at >= 0) return seat(c, c.at);                                                      // in the chair, at the basin, under the dryer
      const stand = (x, y) => ({ how: 'stand', x, y, cx: x, top: y - 62 });
      if (c.by) { const b = body(c.by); return stand(b.x - 12, b.y - 2); }
      const [x, y] = QUEUE[clamp(queued().indexOf(c), 0, QUEUE.length - 1)]; return stand(x, y);
    }
    const paint = () => {
      hearts(view.hud.firstElementChild, live.lives, max);
      view.hud.children[1].textContent = `${live.served} / ${live.need}`;
      const left = Math.max(0, Math.ceil(cfg.seconds - s.t)); view.hud.children[2].textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      view.hud.lastElementChild.firstElementChild.style.width = clamp(live.served / live.need, 0, 1) * 100 + '%';
    };
    paint();
    function walk(x, y, go) {
      const m = s.me;
      if (live.workers[who] !== null && live.workers[who] !== undefined) Net.send({ type: 'ev', e: 'at', st: -1 });   // leaving one's place
      m.to = { x: clamp(x, 10, W - 10), y: clamp(y, 150, H - 4) }; m.go = go;
      Net.send({ type: 'fx', k: 'walk', x: m.to.x, y: m.to.y });
    }
    function arrive() {
      const go = s.me.go; s.me.go = null; if (!go) return;
      if (go.take !== undefined) Net.send({ type: 'ev', e: 'take', c: go.take });
      if (go.st !== undefined) {
        const c = leading(who);
        if (c) Net.send({ type: 'ev', e: 'lead', c: c.id, st: go.st });
        else Net.send({ type: 'ev', e: 'at', st: go.st });
      }
    }
    // stand-in pictures: a customer whose hair changes as the work is done, and an icon for each kind of work
    function customer(c, p) {
      let { x, y } = p;
      const did = (k) => c.order.indexOf(k) > -1 && c.order.indexOf(k) < c.step;
      const shook = c.no && s.no && s.no.id === c.id && s.t - s.no.at < 0.6 ? Math.round(Math.sin(s.t * 50) * 2) : 0;
      if (K.has('customers', 'c0')) {                                                              // drawn customers: a new hairdo once only paying is left
        const k = c.id % 6, look = (c.step >= c.order.length - 1 ? 'd' : 'c') + k;
        if (p.how === 'back') {                                                                    // in a styling chair: the head over its back
          ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, BACK + 25); ctx.clip();
          K.figure('customers', x + shook, y, look, 0, false, CUST); ctx.restore();
          const b = chairBack(c.at); if (b) ctx.drawImage(b.c, b.x, BACK);
        } else if (p.how === 'side') K.figure('seated', x + shook, y, look, 0, p.flip, CUST);       // sitting at the basin, or under the dryer
        else {
          const led = c.by && body(c.by).to, step = led ? Math.round(Math.abs(Math.sin(s.t * 9 + c.id))) * 2 : 0;   // being led: a step at a time
          K.figure('customers', x + shook, y - step, look, 0, led && body(c.by).to.x < body(c.by).x, CUST);          // grown-ups as tall as Mamka
        }
        if (did('wash') && !did('dry')) { const t = p.top + 4, h = p.cx; rect(h - 9, t + 10, 1, 2, '#7CC6F2'); rect(h + 8, t + 4, 1, 2, '#7CC6F2'); rect(h + 10, t + 12, 1, 2, '#7CC6F2'); }   // wet hair, dripping
        return;
      }
      const hair = did('dye') ? c.dye : c.hair, long = c.long && !did('cut'), wet = did('wash') && !did('dry');
      const shake = c.no && s.no && s.no.id === c.id && s.t - s.no.at < 0.6 ? Math.round(Math.sin(s.t * 50) * 2) : 0;
      x = Math.round(x) + shake; y = Math.round(y);
      rect(x - 4, y - 8, 3, 8, '#3A2F33'); rect(x + 1, y - 8, 3, 8, '#3A2F33');                  // legs
      rect(x - 6, y - 19, 12, 11, c.shirt);                                                       // body
      rect(x - 5, y - 28, 10, 9, '#E8B58A'); rect(x + 1, y - 25, 2, 2, INK);                     // head and eye
      rect(x - 6, y - 31 - (did('dry') ? 1 : 0), 12, 4 + (did('dry') ? 1 : 0), hair);            // hair, fluffier once dried
      rect(x - 7, y - 29, 3, long ? 12 : 5, hair);
      if (wet) { rect(x - 8, y - 22, 1, 2, '#7CC6F2'); rect(x + 7, y - 27, 1, 2, '#7CC6F2'); }
    }
    function icon(k, x, y) {
      x = Math.round(x); y = Math.round(y);
      if (k === 'wash') { rect(x - 5, y - 1, 10, 5, '#3E7BD6'); rect(x - 4, y, 8, 3, '#7CC6F2'); rect(x - 1, y - 5, 2, 3, '#7CC6F2'); }
      if (k === 'cut') { rect(x - 5, y + 1, 3, 3, '#8A8F9C'); rect(x + 2, y + 1, 3, 3, '#8A8F9C'); for (let i = 0; i < 5; i++) { rect(x - 3 + i, y - i, 1, 1, '#46536A'); rect(x + 2 - i, y - i, 1, 1, '#46536A'); } }
      if (k === 'dye') { rect(x - 3, y - 2, 6, 7, '#8E5BC8'); rect(x - 2, y - 5, 4, 3, '#FFF8E7'); rect(x - 2, y, 4, 1, '#F0448F'); }
      if (k === 'dry') { rect(x - 5, y - 3, 8, 5, '#F0448F'); rect(x + 3, y - 2, 3, 3, '#46536A'); rect(x - 3, y + 2, 3, 4, '#F0448F'); }
      if (k === 'pay') { rect(x - 4, y - 4, 8, 8, '#E6B340'); rect(x - 3, y - 3, 6, 6, '#FFD43A'); rect(x - 1, y - 2, 2, 4, '#B98850'); }
    }
    function bubble(c, p) {                                                                       // what they want next, and how patient they still are
      const k = c.order[c.step], ready = c.at >= 0 && ST[c.at].k !== k, b = ready ? Math.round(Math.abs(Math.sin(s.t * 6)) * 2) : 0;
      const x = Math.round(p.cx), y = Math.round(Math.min(p.top, p.how === 'side' && p.flip ? 90 : p.top)) - 14 - b;
      rect(x - 8, y - 8, 16, 15, INK); rect(x - 7, y - 7, 14, 13, '#FFF8E7'); rect(x - 1, y + 7, 2, 2, INK);
      icon(k, x, y - 1);
      const f = clamp(c.pat / c.max, 0, 1);
      rect(x - 8, y + 10, 16, 3, INK); rect(x - 7, y + 11, Math.max(1, Math.round(14 * f)), 1, f > 0.5 ? '#1FA463' : f > 0.25 ? '#FFD43A' : '#CC2233');
    }
    return {
      s, kind: 'salon',
      peek: () => ({ me: { x: s.me.x, y: s.me.y, walking: !!s.me.to }, mine: leading(who) && leading(who).id, workers: live.workers, stations: ST.map((st, i) => ({ k: st.k, i, x: st.x, y: st.y, busy: live.cust.some((c) => c.at === i) })),
        cust: live.cust.map((c) => ({ id: c.id, at: c.at, by: c.by, want: c.order[c.step], work: c.work, ...where(c) })) }),
      sync(n) {
        for (const c of n.cust) {
          const was = live.cust.find((q) => q.id === c.id);
          if (c.by === who && was && was.at >= 0 && was.by !== who) { beep(660, 880); say(`Hotovo! Teď chce ${NAME[c.order[c.step]]}. Klepni tam.`); }
        }
        for (const c of n.cust) if (c.no && c.no !== s.seenNo[c.id]) {
          s.seenNo[c.id] = c.no;
          if (c.by === who) { s.no = { id: c.id, at: s.t }; beep(180); const st = ST.find((x) => x.k === c.order[c.step]), i = ST.indexOf(st); say(n.cust.some((q) => q.at === i) ? 'Tam už někdo sedí. Počkej, nebo ho pusť.' : `Teď chce ${NAME[c.order[c.step]]}.`); }
        }
        // someone leaves: paid, with coins at the till, or fed up, with a cross little cloud where they stood
        const gone = live.cust.filter((c) => !n.cust.some((q) => q.id === c.id));
        if (n.served > live.served) { const p = ST.find((x) => x.k === 'pay'); s.pops.push({ coin: true, x: p.x + 4, y: p.y - 40, at: s.t }); beep(880, 1100); }
        if (n.lives < live.lives) for (const c of gone) { const p = where(c); s.pops.push({ coin: false, x: p.x, y: p.y - 50, at: s.t }); }
        live = n; paint(); keys.show('drop', !s.over && !!leading(who));
      },
      fx(m) { if (m.k === 'walk') s.mate.to = { x: m.x, y: m.y }; },
      over(won) { s.over = true; s.lost = !won; shout.hidden = true; paint(); view.end(won, won ? 'Zvládnuto!' : 'Zákazníci utekli.', won ? `Obsloužili jste ${live.served} zákazníků a v kase je ${live.coins} korun.` : `Obsloužili jste ${live.served} z ${live.need}. Zkuste to ještě jednou.`); },
      down(x, y) {
        if (s.over || s.t < 0 || y < 22) return;
        const mineNow = leading(who);
        const hit = live.cust.filter((q) => !q.by).map((q) => ({ q, p: where(q) })).find(({ p }) => Math.abs(p.cx - x) < 14 && y > p.top - 26 && y < p.y + 3);
        if (hit && worked(hit.q)) { if (live.workers[who] !== hit.q.at) { beep(440); const i = hit.q.at, p = spot(i); return walk(p.x, p.y, { st: i }); } return say('Ještě chvilku, pracuje se.'); }   // help, never pull them away
        if (!mineNow && hit) {                                                                     // a customer to take: one waiting, or one left at a place
          beep(520); view.tip.textContent = '';
          const p = hit.q.at >= 0 ? spot(hit.q.at) : { x: hit.p.x + 12, y: hit.p.y + 2 };
          return walk(p.x, p.y, { take: hit.q.id });
        }
        const i = ST.findIndex((st) => Math.abs(st.x - x) < 18 && y > st.y - 48 && y < st.y + 28);
        if (i > -1) { beep(440); const p = spot(i); return walk(p.x, p.y, { st: i }); }
        walk(x, y, null);
      },
      update(dt) {
        if (s.over) return;
        s.t = clock(live);
        for (const b of [s.me, s.mate]) {
          if (!b.to) continue;
          const dx = b.to.x - b.x, dy = b.to.y - b.y, d = Math.hypot(dx, dy), step = SPEED * dt;
          if (d <= step) { b.x = b.to.x; b.y = b.to.y; b.to = null; if (b === s.me) arrive(); }
          else { b.x += dx / d * step; b.y += dy / d * step; if (b === s.me) s.me.walked.push([s.t, step]); }
        }
        // Mamka does not like running about her salon
        s.me.walked = s.me.walked.filter(([t]) => s.t - t < 3);
        if (sc.cast && s.me.walked.reduce((a, [, d]) => a + d, 0) > 240 && s.t - s.shout > 10) { s.shout = s.t; beep(300, 300); }   // only for real running about
        if (s.tipAt && s.t - s.tipAt > 2.6) { view.tip.textContent = ''; s.tipAt = 0; }
        shout.hidden = !(s.shout && s.t - s.shout < 2);
        paint();
      },
      draw() {
        K.background(sc.bg, 0, place.look);
        ST.forEach((st, i) => {                                                                   // the places to work, as mats on the floor
          if (!st.chair) { if (K.has('stations', st.k)) K.figure('stations', st.x, st.y + 2, st.k, 0, st.k === 'dry' && !SITS, 0.64); else { rect(st.x - 13, st.y - 3, 26, 9, INK); rect(st.x - 12, st.y - 2, 24, 7, '#FFF8E7'); icon(st.k, st.x, st.y + 1); } }
          if (st.k === 'dry' && SITS) {                                                           // a stool in front of the dryer, to sit on under the hood
            rect(STOOL.x - 9, STOOL.y - 1, 18, 4, '#8D8C96'); rect(STOOL.x - 8, STOOL.y, 16, 2, '#3B3A42');
            rect(STOOL.x - 1, STOOL.y + 3, 3, 8, '#B8BEC6'); rect(STOOL.x - 7, STOOL.y + 11, 15, 2, '#55545C'); rect(STOOL.x - 8, STOOL.y + 12, 2, 2, INK); rect(STOOL.x + 7, STOOL.y + 12, 2, 2, INK);
          }
          if (st.k !== 'pay') { const py = 38; rect(st.x - 8, py - 7, 16, 14, INK); rect(st.x - 7, py - 6, 14, 12, '#FFF8E7'); icon(st.k, st.x, py - 1); }   // a little sign on the wall: what is done here
        });
        const things = [];                                                                        // everyone on the floor, drawn from the back to the front
        for (const c of live.cust) {
          const p = where(c);
          things.push([p.how === 'back' ? BACK + 25 : p.y, () => {
            customer(c, p);
            if (c.at >= 0 && ST[c.at].k === 'dry' && p.how === 'side') { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, 108); ctx.clip(); K.figure('stations', ST[c.at].x, ST[c.at].y + 2, 'dry', 0, false, 0.64); ctx.restore(); }   // the hood, down over their head
            if (!worked(c)) bubble(c, p);
          }]);
        }
        if (sc.cast) things.push([286, () => K.figure(sc.cast[0], 178, 286, 'three', s.t, true)]);           // Mamka keeps an eye on things from the corner
        const busyAt = (w) => { const at = live.workers[w]; return at !== null && at !== undefined && live.cust.some((c) => c.at === at && ST[at].k === c.order[c.step]); };   // hands busy with the work
        // at work: standing at the customer with the tool of the job in hand, going to and fro
        // the tool of the job, small, in the hand that works (no card over the face): shampoo, scissors, dye, the dryer
        const TOOL = { wash: 'shampoo', cut: 'scissors', dye: 'dye', dry: 'dryer' };
        const tool = (w, b) => {
          if (!busyAt(w)) return; const st = ST[live.workers[w]], d = st.x < b.x ? -1 : 1, tx = b.x + d * 9 + Math.round(Math.sin(s.t * 10) * 2), ty = b.y - 17 + Math.round(Math.cos(s.t * 10));
          if (TOOL[st.k] && K.has('salonkit', TOOL[st.k])) K.figure('salonkit', tx, ty + 6, TOOL[st.k], 0, d < 0, 0.18); else icon(st.k, tx, ty);
        };
        if (mateHere()) things.push([s.mate.y, () => { K.hero(mate(), s.mate.x, s.mate.y, s.mate.to ? 'run' : 'stand', s.mate.to ? s.t * 0.7 : s.t, s.mate.to ? s.mate.to.x < s.mate.x : busyAt(mate()) && ST[live.workers[mate()]].x < s.mate.x); tool(mate(), s.mate); }]);
        things.push([s.me.y, () => { K.hero(who, s.me.x, s.me.y, s.lost ? 'dizzy' : s.me.to ? 'run' : 'stand', s.me.to ? s.t * 0.7 : s.t, s.me.to ? s.me.to.x < s.me.x : busyAt(who) && ST[live.workers[who]].x < s.me.x); tool(who, s.me); }]);
        things.sort((a, b) => a[0] - b[0]).forEach(([, f]) => f());
        ST.forEach((st, i) => {                                                                   // how far the work has got, on top of everyone
          const c = live.cust.find((q) => q.at === i);
          if (c && st.k === c.order[c.step]) { const p = where(c), f = clamp(c.work / cfg.work[st.k], 0, 1), bx = Math.round(p.cx), by = Math.round(Math.min(p.top, st.k === 'dry' ? 90 : p.top)) - 12; rect(bx - 13, by - 9, 26, 14, INK); rect(bx - 12, by - 8, 24, 12, '#FFF8E7'); icon(st.k, bx, by - 3); rect(bx - 12, by + 5, 24, 4, INK); rect(bx - 11, by + 6, Math.max(1, Math.round(22 * f)), 2, '#1FA463'); }
        });
        s.pops = s.pops.filter((p) => s.t - p.at < 0.9);
        for (const p of s.pops) {
          const u = (s.t - p.at) / 0.9, y = Math.round(p.y - u * 18);
          if (p.coin) { for (let k = 0; k < 3; k++) { rect(p.x - 8 + k * 6, y - k * 3, 6, 6, '#B8862A'); rect(p.x - 7 + k * 6, y - k * 3 + 1, 4, 4, '#FFD43A'); } }    // coins into the till
          else { rect(p.x - 7, y - 3, 14, 7, '#7A6F6A'); rect(p.x - 5, y - 5, 10, 11, '#7A6F6A'); for (let k = 0; k < 4; k++) rect(p.x - 4 + k * 2, y - 1 + (k % 2) * 2, 2, 2, '#CC2233'); }   // a cross little cloud
        }
      },
    };
  }

  // Pexeso: pairs of cards face down on the table. With two playing, one turns the first card over and the other
  // turns the second, looking for its pair; then they swap. Whoever waits may tap a card to point at it on the
  // partner's phone ("Tady!"), so they talk and help. A pair stays up and is named; otherwise both turn back over.
  // A tapped card turns at once on the phone that tapped it, and the pair is judged there at once; the room's answer
  // (and the other phone) follows. Too many wrong guesses and the game is lost, but the pairs found stay for another go.
  // A golden key, drawn pixel by pixel as finely as the characters: a round bow with a hole, the shaft, two teeth.
  const KEY = (() => {
    const w = 72, h = 30, c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'), img = g.createImageData(w, h), E = [184, 134, 42], B = [255, 212, 58], L = [255, 241, 168];
    const put = (i, j, col) => img.data.set([...col, 255], (j * w + i) * 4);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const d = Math.hypot(i - 14.5, j - 14.5);
      const bow = d < 14.5 && d > 5.5, shaft = i >= 26 && i < 70 && j >= 11 && j < 19, cap = i >= 66 && i < 71 && j >= 9 && j < 21;
      const tooth = (i >= 50 && i < 56 && j >= 19 && j < 27) || (i >= 59 && i < 65 && j >= 19 && j < 25);
      if (!(bow || shaft || cap || tooth)) continue;
      const edge = (bow && (d > 12.5 || d < 7.5)) || (!bow && (j === 11 && !cap || j === 18 && !tooth || i === 70 || j === 9 || j === 20 || (tooth && (j >= 23 || i === 50 || i === 55 || i === 59 || i === 64))));
      const lit = bow ? d > 8.5 && d < 11.5 && i + j < 22 : (j === 12 || j === 13) && i > 28 && i < 66;
      put(i, j, edge ? E : lit ? L : B);
    }
    g.putImageData(img, 0, 0);
    return c;
  })();

  // A hand pointing down, for a partner's "Tady!": X outline, S skin, C a cuff in the colour of whoever points.
  const HAND = ['....XXXXXXXX..', '....XCCCCCCX..', '...XSSSSSSSX..', '...XSSSSSSSSX.', '..XSSSSSSSSSX.', '..XSSSSSSSSSSX', '.XSSSSSSSSSSSX',
    'XSSSXSSSSSSSSX', 'XSSXXSSSSSSSSX', '.XX.XSSXSSXSSX', '....XSSXSSXXX.', '....XSSXXX....', '....XSSX......', '....XSSX......', '....XSSX......', '.....XX.......'];
  function Memory(sc, place, sn) {
    const cfg = sc.memory, who = me(), COLS = 4, CW = 40, CH = 50, GAP = 6, X0 = Math.round((W - (COLS * CW + (COLS - 1) * GAP)) / 2), Y0 = 36;
    const FLIP = 0.26;                                                                 // seconds a card takes to turn over
    const s = { t: 0, over: false, lost: false, keyAt: null, endIn: 0, pend: [], bits: [], later: [], seen: new Set(), hint: null, hintAt: -9, xs: sn.misses, xsAt: -9, note: '', noteTill: 0, could: false, wave: -9, tipWas: null, hudWas: null, deal: clock(sn) < -0.6 };
    let live = sn;
    const card = sn.deck.map((f, i) => ({ up: sn.done.includes(i) || sn.open.includes(i), at: -9, pop: -9, bad: -9, wob: -9 }));
    for (const i of sn.done) s.seen.add('p' + sn.deck[i]);                            // pairs found before (a go after a lost one): no fuss over them again
    for (let k = 1; k <= sn.misses; k++) s.seen.add('m' + k);
    const view = stage('<span class="count"></span><span class="chyby"></span>', '');
    const two = () => !!live.turn;
    const finish = (won) => view.end(won, won ? 'Všechny dvojice!' : 'Moc chyb!', won ? (cfg.won || 'Výborná paměť!') : live.done.length ? `Nalezené dvojice ${two() ? 'vám' : 'ti'} zůstanou.` : `${two() ? 'Zkuste' : 'Zkus'} to ještě jednou.`);
    const spot = (i) => ({ x: X0 + (i % COLS) * (CW + GAP), y: Y0 + Math.floor(i / COLS) * (CH + GAP) });
    const cardAt = (x, y) => live.deck.findIndex((f, i) => { const p = spot(i); return x >= p.x && x < p.x + CW && y >= p.y && y < p.y + CH; });
    // With two, each turns one card and the turn passes on. This phone knows it the moment its first card is tapped, before the room says so.
    const passed = () => two() && live.turn === who && !live.open.length && s.pend.length > 0;
    const turn = () => (passed() ? mate() : live.turn);
    const mine = () => !live.turn || turn() === who;
    const started = () => clock(live) >= 0;
    // The cards up on this phone: those the room has up, and those just tapped here that it has not answered yet.
    const opened = () => [...live.open, ...s.pend.map((p) => p.i).filter((i) => !live.open.includes(i) && !live.done.includes(i))];
    const isUp = (i) => live.done.includes(i) || opened().includes(i);
    const canAct = () => !s.over && started() && mine() && opened().length < 2;
    const say = (html, secs) => { s.note = html; s.noteTill = s.t + (secs || 2.2); };
    if (sn.done.length) say('Dvojice zůstaly!', 3);

    // A pair: both cards pop up with a sparkle, and the thing on them is named. A wrong pair: both shake.
    function burst(i) {
      const p = spot(i);
      for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2 + Math.random() * 0.4, v = 60 + Math.random() * 50; s.bits.push({ x: p.x + CW / 2, y: p.y + CH / 2, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 50, t: s.t, life: 0.5 + Math.random() * 0.3, c: k % 3 ? '#FFD43A' : '#FFF8E7' }); }
    }
    // Judged the moment the second card is tapped, on the phone that turned it; the other phone when the room says so.
    // `seen` keeps either from making the fuss twice. It shows once the card has finished turning, so it is seen first,
    // and once the room has taken the flip: one it refused must not cheer or shake, nor use up the fuss of the real one.
    function judge(a, b, misses) {
      const pair = live.deck[a] === live.deck[b], k = pair ? 'p' + live.deck[a] : 'm' + misses;
      if (s.seen.has(k)) return; s.seen.add(k);
      const name = cfg.faces[live.deck[a]][2];
      const ok = () => (pair ? live.done.includes(a) && live.done.includes(b) : live.open.includes(a) && live.open.includes(b));
      const show = pair
        ? () => { card[a].pop = card[b].pop = s.t; card[a].hold = card[b].hold = false; hud(); burst(a); burst(b); beep(660, 880, 1100); if (name) cheer(name + '!'); }
        : () => { card[a].bad = card[b].bad = s.t; s.xs = Math.max(s.xs, misses); hud(); beep(200, 160); if (live.maxMiss - misses === 1) say('Pozor, poslední šance!'); };
      const drop = () => { s.seen.delete(k); card[a].hold = card[b].hold = false; };
      const then = (at) => s.later.push({ at, fn: () => (ok() ? show() : s.pend.some((p) => p.i === a || p.i === b) ? then(s.t) : drop()) });   // no answer yet: look again next frame
      if (pair) card[a].hold = card[b].hold = true;                                  // not green until it is seen to be a pair
      then(s.t + FLIP);
    }
    // A partner's "Tady!": a hand taps on the card, with the word over it, on both phones; the line below says who.
    function hintOn(i, from, note) {
      hintOff();
      const p = spot(i);
      s.hint = { i, at: s.t, from, note, el: add(`<p class="tady" style="${pinAt([p.x + CW / 2, p.y])}">Tady!</p>`) };
      say(note, 3.5);
    }
    function hintOff() { if (s.hint) { s.hint.el.remove(); if (s.note === s.hint.note) s.noteTill = 0; } s.hint = null; }
    // Pairs found as a number; the wrong pairs as boxes filling up with red crosses, the empty ones what is left.
    // Both count what the cards have shown: a pair once it has popped, a cross once the wrong pair shakes.
    function hud() {
      const got = live.done.filter((i) => !card[i].hold).length, m = Math.min(live.misses, s.xs), key = `${got}/${m}/${live.maxMiss}`; if (key === s.hudWas) return;
      const fresh = s.hudWas !== null && m > +s.hudWas.split('/')[1]; s.hudWas = key;
      view.hud.querySelector('.count').innerHTML = `<i class="dvojice"></i>${got / 2}/${live.deck.length / 2}`;
      const el = view.hud.querySelector('.chyby');
      el.classList.toggle('warn', live.maxMiss - m <= 2);
      el.innerHTML = '<span>Chyby</span>' + Array.from({ length: live.maxMiss }, (_, k) => `<i class="${k < m ? 'x' : ''}${fresh && k === m - 1 ? ' new' : ''}"></i>`).join('');
    }
    // What to do now, in a few words: whose turn it is (with their face), and what the cards on the table ask for.
    function tip() {
      let html = '';
      if (s.over) html = '';
      else if (s.t < s.noteTill) html = s.note;
      else {
        const open = opened(), whose = turn(), name = two() ? esc(heroName(whose)) : '';
        if (open.length === 2) html = live.deck[open[0]] !== live.deck[open[1]] ? 'Zapamatuj si je!' : s.tipWas;
        else if (!two()) html = open.length ? 'Najdi k ní dvojici!' : 'Otoč kartičku.';
        else if (mine()) html = face(who, 3, 1) + (open.length ? 'Najdi k ní dvojici!' : 'Tvůj tah! Otoč kartičku.');
        else html = face(whose, 3, 1) + (open.length ? `${name} hledá. Ukaž ${whose === 'kel' ? 'jí' : 'mu'}, kde je!` : `Otáčí ${name}, pak ty.`);
      }
      if (html !== s.tipWas) { s.tipWas = html; view.tip.innerHTML = html; }
    }
    hud(); tip();

    const outline = (x, y, w, h, c, k) => { rect(x, y, w, k, c); rect(x, y + h - k, w, k, c); rect(x, y, k, h, c); rect(x + w - k, y, k, h, c); };
    function drawCard(i, f) {
      const c = card[i], p = spot(i), open = opened();
      let cx = p.x + CW / 2, cy = p.y + CH / 2, k = 1, lift = 0;
      if (s.deal) {                                                                  // dealt out from the bench as the game starts
        const d = (s.t - 0.15 - i * 0.05) / 0.4; if (d <= 0) return;
        if (d < 1) { const e = 1 + 1.8 * (d - 1) ** 3 + 0.8 * (d - 1) ** 2; cx = W / 2 + (cx - W / 2) * e; cy = H + 30 + (cy - H - 30) * e; }   // a little past its place, and back
      }
      // turning over: it narrows to an edge and widens again with the other side up, lifted a little on the way
      const v = clamp((s.t - c.at) / FLIP, 0, 1), up = v < 0.5 ? !c.up : c.up, kx = Math.max(0.08, Math.abs(Math.cos(v * Math.PI)));
      lift += Math.sin(v * Math.PI) * 4;
      const q = (s.t - c.pop) / 0.45; if (q >= 0 && q < 1) { k = 1 + 0.18 * Math.sin(q * Math.PI) * (1 - q * 0.6); lift += Math.sin(q * Math.PI) * 3; }   // a pair: up it jumps
      const b = (s.t - c.bad) / 0.55; if (b >= 0 && b < 1) cx += Math.sin(b * 40) * 3 * (1 - b);              // wrong: a shake that dies away
      const w = (s.t - c.wob) / 0.3; if (w >= 0 && w < 1) cx += Math.sin(w * 32) * 2 * (1 - w);              // not now: a little wobble
      const r = (s.t - s.wave - i * 0.035) / 0.25; if (r > 0 && r < 1 && !c.up) lift += Math.sin(r * Math.PI) * 3;   // your turn: a ripple across the cards
      cx = Math.round(cx); cy = Math.round(cy);
      const hw = Math.round(CW * kx * k / 2), hh = Math.round(CH * k / 2), y = cy - Math.round(lift);
      rect(cx - hw, cy - hh + 2, hw * 2, hh * 2, 'rgba(43,31,26,.5)');                // its shadow stays on the table
      const done = live.done.includes(i) && !c.hold, bad = open.length === 2 && open.includes(i) && live.deck[open[0]] !== live.deck[open[1]], pulse = Math.sin(s.t * 7) > 0;
      if (v >= 1 && !done) {                                                         // what to look at: the card whose pair is wanted, the cards to tap
        if (open.length === 1 && open[0] === i && canAct()) outline(cx - hw - 2, y - hh - 2, hw * 2 + 4, hh * 2 + 4, pulse ? '#FFD43A' : '#FFF1A8', 2);
        else if (!c.up && canAct()) outline(cx - hw - 1, y - hh - 1, hw * 2 + 2, hh * 2 + 2, `rgba(255,212,58,${(0.3 + 0.25 * Math.sin(s.t * 4)).toFixed(2)})`, 1);
        if (s.hint && s.hint.i === i) outline(cx - hw - 2, y - hh - 2, hw * 2 + 4, hh * 2 + 4, pulse ? '#FFD43A' : '#FFF8E7', 2);
      }
      ctx.save(); ctx.translate(cx, y); ctx.scale(kx * k, k);
      if (!up) {                                                                     // the back: a pattern of diamonds
        rect(-20, -25, CW, CH, '#7A4A22'); rect(-19, -24, CW - 2, CH - 2, '#CC2233'); rect(-17, -22, CW - 6, CH - 6, '#E8505E');
        for (let j = 0; j < 4; j++) for (let n = 0; n < 3; n++) rect(-13 + n * 10, -18 + j * 10 + (n % 2) * 5, 4, 4, '#FFD9A8');
      } else {                                                                       // the face: green round a pair found, red round a wrong one
        const edge = bad ? '#CC2233' : done ? '#1FA463' : '#B98850', thick = bad || done ? 2 : 1;
        rect(-20, -25, CW, CH, edge); rect(-20 + thick, -25 + thick, CW - 2 * thick, CH - 2 * thick, '#FFF8E7');
        const [sheet, pose] = cfg.faces[f], sp = K.sprites[sheet];
        if (sp) K.figure(sheet, 0, 18, pose, 0, false, Math.min(34 / sp.w, 38 / sp.h));
        if (done) { rect(12, -23, 7, 6, '#1FA463'); for (const [a, d] of [[1, 2], [2, 3], [3, 2], [4, 1], [5, 0]]) rect(13 + a - 1, -22 + d, 1, 2, '#FFF8E7'); }   // a tick in the corner
      }
      ctx.restore();
    }
    // The hint: a hand tapping on the card, the finger on its middle.
    function drawHand() {
      const p = spot(s.hint.i), u = s.t - s.hint.at, tap = Math.round(Math.abs(Math.sin(u * 5)) * 4), cuff = (WORLD.heroes[s.hint.from] || {}).shirt || '#FFD43A';
      const x0 = p.x + CW / 2 - 5, y0 = p.y + CH / 2 - 15;
      HAND.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] !== '.') rect(x0 + i + 1, y0 + j + 2, 1, 1, 'rgba(43,31,26,.45)'); });   // its shadow on the card stays put
      HAND.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] !== '.') rect(x0 + i, y0 + j - tap, 1, 1, row[i] === 'X' ? INK : row[i] === 'C' ? cuff : '#F6D2B0'); });
    }
    // The cards are cleared away and a golden key rises from under the last pair, turning, with a sparkle, and flies to the door.
    function drawKey(u) {
      const DOOR = [100, 114], v = clamp((u - 0.9) / 0.5, 0, 1), from = s.keyFrom || { x: W / 2, y: 150 };   // where the salon's door is on the picture
      if (v >= 1) {                                                                        // unlocked: the door glows
        const w = clamp((u - 1.4) / 0.6, 0, 1);
        for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2, r = 6 + w * 30; rect(Math.round(DOOR[0] + Math.cos(a) * r), Math.round(DOOR[1] + Math.sin(a) * r), 3, 3, i % 2 ? '#FFF1A8' : '#FFD43A'); }
        return;
      }
      const e = Math.min(1, u / 0.8), out = 1 - (1 - e) ** 3, y0 = Math.round(from.y + (64 - from.y) * out + (e >= 1 ? Math.sin(u * 3) * 2 : 0)), x0 = from.x + (W / 2 - from.x) * out, turn = Math.cos(u * 5);
      const y = Math.round(y0 + (DOOR[1] - y0) * v), cx = Math.round(x0 + (DOOR[0] - x0) * v), size = (0.5 + 0.5 * out) * (1 - 0.6 * v);
      for (let i = 0; i < 8; i++) {                                                     // sparkles round it
        const a = i / 8 * Math.PI * 2 + u * 1.5, r = 22 + Math.sin(u * 4 + i) * 4;
        if (Math.sin(u * 9 + i * 2) > -0.2) rect(Math.round(cx + Math.cos(a) * r * size), Math.round(y + Math.sin(a) * r * 0.8 * size), 2, 2, i % 2 ? '#FFF1A8' : '#FFD43A');
      }
      ctx.save(); ctx.translate(cx, y); ctx.scale(Math.max(0.12, Math.abs(turn)) * size, size);
      ctx.drawImage(KEY, -KEY.width / 4, -KEY.height / 4, KEY.width / 2, KEY.height / 2);    // each of its pixels half a game pixel, as fine as the people
      ctx.restore();
    }

    return {
      s, kind: 'memory', peek: () => ({ deck: live.deck, open: opened(), done: live.done, mine: canAct(), turn: live.turn, hint: s.hint && s.hint.i, spot }),
      sync(n) {
        s.pend = s.pend.filter((p) => !n.open.includes(p.i) && !n.done.includes(p.i));    // answered
        const was = live; live = n;
        for (const i of n.done) if (!was.done.includes(i)) judge(i, n.done.find((j) => j !== i && n.deck[j] === n.deck[i]), n.misses);   // turned on the other phone
        if (n.misses > was.misses) { s.xsAt = s.t; if (n.open.length === 2) judge(n.open[0], n.open[1], n.misses); }
        hud();
      },
      over(won) {
        s.over = true; s.lost = !won; hintOff(); tip();
        if (won && cfg.key) {                                                         // the last pair has its moment; then the key comes out, flies to the door and unlocks it; then the card
          const p = spot(live.done[live.done.length - 1]); s.keyFrom = { x: p.x + CW / 2, y: p.y + CH / 2 };
          s.keyAt = s.t + 0.8; s.endIn = 2.9;
        } else finish(won);
      },
      down(x, y) {
        const i = cardAt(x, y); if (s.over || i < 0) return;
        const c = card[i];
        if (!started()) { c.wob = s.t; beep(180); return; }                            // still being dealt
        if (!mine()) {                                                                 // the partner's turn: point at a card for them
          if (passed()) { c.wob = s.t; beep(180); return say(face(mate(), 3, 1) + `Teď hledá ${esc(heroName(mate()))}.`, 1.5); }   // one card each: the second is the partner's
          if (isUp(i) || s.t - s.hintAt < 0.5) { c.wob = s.t; beep(180); return; }
          s.hintAt = s.t; beep(880, 1175); Net.send({ type: 'fx', k: 'hint', i });
          return hintOn(i, who, `${esc(heroName(mate()))} to uvidí.`);
        }
        const open = opened();
        if (isUp(i) || open.length >= 2) { c.wob = s.t; beep(180); return; }          // up already, or two are up: wait
        s.pend.push({ i, at: s.t });                                                   // it turns now, before the room hears of it
        beep(open.length ? 660 : 520);
        Net.send({ type: 'ev', e: 'flip', i });
        if (open.length === 1) judge(open[0], i, live.misses + 1);
        hintOff();
      },
      fx(m) {
        if (m.k !== 'hint' || s.over || !WORLD.heroes[m.from] || !mine()) return;      // given for a turn that is over already: no use now
        const i = m.i | 0; if (i < 0 || i >= live.deck.length || isUp(i)) return;
        hintOn(i, m.from, face(m.from, 3, 1) + `${esc(heroName(m.from))} radí: tady!`); beep(1320, 990);
      },
      update(dt) {
        s.t += dt;
        card.forEach((c, i) => { const u = isUp(i); if (u !== c.up) { c.up = u; c.at = s.t; } });
        const late = s.pend.filter((p) => s.t - p.at > 2.5);                          // the room never took it: it turns back
        if (late.length) { s.pend = s.pend.filter((p) => !late.includes(p)); for (const p of late) card[p.i].wob = s.t; }
        const due = s.later.filter((l) => s.t >= l.at); if (due.length) { s.later = s.later.filter((l) => !due.includes(l)); due.forEach((l) => l.fn()); }
        for (const b of s.bits) { b.x += b.vx * dt; b.y += b.vy * dt; b.vy += 240 * dt; }
        s.bits = s.bits.filter((b) => s.t - b.t < b.life);
        if (s.hint && (s.t - s.hint.at > 3.5 || isUp(s.hint.i) || (s.hint.from === who) === mine())) hintOff();   // a hint lasts the turn it was given for
        if (live.misses > s.xs && s.t - s.xsAt > FLIP + 0.5) s.xs = live.misses;      // a cross whose shake was missed (a phone asleep) still shows
        hud();
        const can = canAct();                                                          // your turn now: the cards ripple, and with two, a chime
        if (can && !s.could) { s.wave = s.t; if (two() && clock(live) > 0.5) beep(660, 990); }
        s.could = can;
        tip();
        if (s.keyAt !== null && !s.rang && s.t >= s.keyAt) { s.rang = true; beep(660, 880, 1100, 1320); }
        if (s.keyAt !== null && !s.clicked && s.t - s.keyAt > 1.4) { s.clicked = true; beep(300, 600, 900); }
        if (s.endIn > 0 && (s.endIn -= dt) <= 0) finish(true);
      },
      draw() {
        K.background(sc.bg, 0, place.look);
        const u = s.keyAt === null ? -1 : s.t - s.keyAt, fade = clamp(u / 0.3, 0, 1);  // the key: the cards clear away
        rect(0, 22, W, H - 22, `rgba(43,31,26,${(0.55 * (1 - fade * 0.5)).toFixed(2)})`);
        if (fade < 1) {
          ctx.save(); ctx.globalAlpha = 1 - fade;
          live.deck.forEach((f, i) => drawCard(i, f));
          if (s.hint) drawHand();
          ctx.restore();
        }
        for (const b of s.bits) {                                                      // sparkles: little squares, every third a cross
          const x = Math.round(b.x), y = Math.round(b.y);
          if (b.c === '#FFF8E7') { rect(x - 1, y, 3, 1, b.c); rect(x, y - 1, 1, 3, b.c); } else rect(x, y, 2, 2, b.c);
        }
        if (u >= 0) drawKey(u);
      },
    };
  }

  // The beach: the waves wash up torn pieces of the message and the odd bottle; run along the sand to pick them up
  // before the sea takes them back. Jellyfish wash up too: running into one stings. Each runs for themselves; what
  // they pick up counts for both.
  function Collect(sc, place, sn) {
    const cfg = sc.collect, who = me(), GY = sc.ground || GROUND, SPEED = 92, IY = GY - 4;
    const items = Room.course.collect(sn.seed, sc);
    const s = { t: 0, over: false, lost: false, me: { x: 60, to: null, y: 0, vy: 0 }, mate: { x: 130, to: null, y: 0, vy: 0 }, sent: 0, asked: new Set(), stungBy: new Set(), hurt: -9 };
    let live = sn;
    const view = stage('<span class="lives"></span><span class="count"></span><span class="meter time"><i></i></span>', 'Sbírej kousky vzkazu. Medúzu přeskoč!');
    const runTo = (x) => { if (s.over || s.t < 0) return; s.me.to = clamp(x, 10, W - 10); Net.send({ type: 'fx', k: 'walk', x: s.me.to }); };
    const hop = () => { if (s.over || s.t < 0 || s.me.y > 0) return; s.me.vy = 170; beep(520); Net.send({ type: 'fx', k: 'hop' }); };
    pad([{ id: 'left', side: 'left', press: () => runTo(10), release: () => runTo(s.me.x) }, { id: 'right', side: 'left', press: () => runTo(W - 10), release: () => runTo(s.me.x) },
      { id: 'jump', label: 'Skok', big: true, press: hop }]);
    const out = (it) => s.t >= it.at && s.t < it.at + cfg.stay;
    const taken = (it) => live.got.includes(it.id) || s.asked.has(it.id);
    const paint = () => {
      hearts(view.hud.children[0], live.lives, sn.lives);
      view.hud.children[1].textContent = `${live.got.length} / ${live.need}`;
      view.hud.children[2].firstElementChild.style.width = clamp(1 - s.t / cfg.seconds, 0, 1) * 100 + '%';
    };
    paint();
    return {
      s, kind: 'collect', peek: () => ({ me: s.me.x, items: items.filter((it) => out(it) && !taken(it)).map((it) => ({ id: it.id, x: it.x, kind: it.kind, left: it.at + cfg.stay - s.t })) }),
      sync(n) { live = n; paint(); },
      fx(m) { if (m.k === 'walk') s.mate.to = m.x; if (m.k === 'hop' && s.mate.y <= 0) s.mate.vy = 170; },
      over(won) { s.over = true; s.lost = !won; paint(); view.end(won, won ? 'Celý vzkaz!' : live.lives <= 0 ? 'Au, medúzy!' : 'Moře bylo rychlejší.', won ? (cfg.won || 'Kousky do sebe zapadly.') : `Máte ${live.got.length} z ${live.need}. Zkuste to ještě jednou.`); },
      down(x, y) { if (s.over || s.t < 0 || y < 22) return; runTo(x); },
      move(x, y) { if (y >= 22) runTo(x); },                              // or follow a finger dragged along the sand
      update(dt) {
        if (s.over) return;
        s.t = clock(live);
        for (const b of [s.me, s.mate]) {
          if (b.vy !== 0 || b.y > 0) { b.y += b.vy * dt; b.vy -= 560 * dt; if (b.y <= 0) { b.y = 0; b.vy = 0; } }
          if (b.to === null) continue;
          const d = b.to - b.x, step = SPEED * dt;
          if (Math.abs(d) <= step) { b.x = b.to; b.to = null; } else b.x += Math.sign(d) * step;
        }
        for (const it of items) {
          if (!out(it) || Math.abs(it.x - s.me.x) > 8) continue;
          if (it.kind === 'jelly') {                                     // it stings once it has washed up and is plain to see, unless hopped over
            if (s.t - it.at > 0.6 && s.me.y < 6 && !s.stungBy.has(it.id)) { s.stungBy.add(it.id); s.hurt = s.t; beep(200, 150); Net.send({ type: 'ev', e: 'sting', id: it.id }); }
          }
          else if (!taken(it)) { s.asked.add(it.id); beep(660, 880); Net.send({ type: 'ev', e: 'grab', id: it.id }); }
        }
        if (s.t >= cfg.seconds && Net.now() - s.sent > 1000) { s.sent = Net.now(); Net.send({ type: 'ev', e: 'finish' }); }
        paint();
      },
      draw() {
        K.background(sc.bg, 0, place.look);
        for (const it of items) {
          if (!out(it) || taken(it)) continue;
          const u = s.t - it.at, left = it.at + cfg.stay - s.t;
          if (u < 0.35) { const w = Math.round(28 * (u / 0.35)); rect(it.x - w / 2, IY - 3, w, 3, '#FFFFFF'); continue; }   // a wave brings it in
          if (left < 0.8 && Math.floor(s.t * 10) % 2) continue;                                // about to be taken back
          rect(it.x - 11, IY, 22, 3, 'rgba(176,132,72,.45)'); rect(it.x - 8, IY + 3, 16, 1, 'rgba(176,132,72,.35)');   // a patch of wet sand
          if (K.has('beach', it.kind)) K.figure('beach', it.x, IY + 2 - (it.kind === 'jelly' ? Math.round(Math.abs(Math.sin(s.t * 4 + it.id))) : 0), it.kind, 0, it.id % 2 === 1, { bottle: 0.42, paper: 0.5, jelly: 0.46 }[it.kind]);
          else rect(it.x - 4, IY - 6, 8, 6, it.kind === 'jelly' ? '#8E5BC8' : '#FFF8E7');
        }
        const pose = (b) => (b.to !== null ? 'run' : 'stand'), flip = (b) => b.to !== null && b.to < b.x;
        const pose2 = (b) => (b.y > 0 ? 'jump' : pose(b));
        if (mateHere()) K.hero(mate(), s.mate.x, GY + 4 - s.mate.y, pose2(s.mate), s.t + 0.3, flip(s.mate));
        const stung = s.t - s.hurt < 0.8;                                  // stung: dizzy for a moment, blinking
        if (!stung || Math.floor(s.t * 12) % 2) K.hero(who, s.me.x, GY + 6 - s.me.y, s.lost || stung ? 'dizzy' : pose2(s.me), s.t, flip(s.me));
      },
    };
  }

  // The reef: the two of them are stranded on the rock. First throw lifebuoys to them: a meter swings up and down,
  // tap to throw, and the buoy has to land right by them. When enough have reached them, they hold on and the heroes
  // pull them across to the jetty, tapping as fast as they can, before the shark gets there.
  function Rescue(sc, place, sn) {
    const cfg = sc.rescue, who = me(), GY = sc.ground || GROUND, G = 520, HX = 34, HY = GY - 26, LAND = cfg.land;
    const s = { t: 0, over: false, lost: false, buoys: [], mateBuoys: [], cool: 0, taps: 0, sentTaps: 0, lastSend: 0, splash: [], stuck: 0 };
    let live = sn, stage0 = sn.stage;
    const view = stage('<span class="lives"></span><span class="count"></span><span class="meter"><i></i></span>', 'Hoď, když je ručička v zeleném!');
    const keys = pad([{ id: 'act', label: 'Hoď', big: true, press: () => press() }]);
    const meter = (t) => (Math.sin(t * 2.6) + 1) / 2;                                    // swings 0..1
    const pulling = () => live.stage === 'pull';
    const pullT = () => ((live.paused || Net.now()) - live.pullAt) / 1000;              // stands still while paused
    const paint = () => {
      hearts(view.hud.children[0], live.lives, sn.lives);
      view.hud.children[1].textContent = pulling() ? `${Math.min(live.pull, live.needPull)} / ${live.needPull}` : `${live.hits} / ${live.needHits}`;
      view.hud.children[2].firstElementChild.style.width = (pulling() ? clamp(live.pull / live.needPull, 0, 1) : clamp(live.hits / live.needHits, 0, 1)) * 100 + '%';
    };
    paint();
    function launch(list, p, x0) { list.push({ x: x0, y: HY, vx: 20 + 190 * p, vy: -300, done: false }); }
    function press() {                                                                    // throw a lifebuoy, or once they hold on, pull
      if (s.over || s.t < 0) return;
      if (pulling()) { if (pullT() >= 0) { s.taps++; beep(300 + (s.taps % 4) * 40); } return; }
      if (s.cool > 0) return;
      const p = meter(s.t); launch(s.buoys, p, HX); s.cool = 0.9; beep(440, 660);
      Net.send({ type: 'fx', k: 'buoy', p });
    }
    return {
      s, kind: 'rescue', peek: () => ({ stage: live.stage, meter: meter(s.t), cool: s.cool, pullT: pullT() }),
      sync(n) {
        live = n; paint();
        if (n.stage !== stage0) { stage0 = n.stage; keys.label('act', 'Táhni!'); beep(520, 660, 780); }
      },
      fx(m) { if (m.k === 'buoy') launch(s.mateBuoys, m.p, HX); },                      // the same arc as on their own screen
      over(won) { s.over = true; s.lost = !won; paint(); view.end(won, won ? 'Jsou na molu!' : pulling() ? 'Žralok byl rychlejší!' : 'Došly záchranné kruhy.', won ? 'Žralok odplouvá s prázdnou.' : 'Zkuste to ještě jednou.'); },
      down() { press(); },
      update(dt) {
        if (s.over) return;
        s.t = clock(live); s.cool -= dt;
        for (const [list, real] of [[s.buoys, true], [s.mateBuoys, false]]) {
          for (const b of list) {
            if (b.done) continue;
            b.x += b.vx * dt; b.vy += G * dt; b.y += b.vy * dt;
            if (b.vy > 0 && b.y >= LAND.y) {                                                   // it comes down: by them on the rock, or in the sea
              b.done = true;
              const hit = Math.abs(b.x - LAND.x) <= LAND.w;
              if (hit) { s.stuck = 1.2; beep(660, 880, 1100); } else { s.splash.push({ x: b.x, at: s.t }); beep(160); }
              if (real) Net.send({ type: 'ev', e: hit ? 'hit' : 'miss' });
            }
          }
        }
        if (s.stuck > 0) s.stuck -= dt;
        s.buoys = s.buoys.filter((b) => !b.done); s.mateBuoys = s.mateBuoys.filter((b) => !b.done);
        s.splash = s.splash.filter((q) => s.t - q.at < 0.6);
        if (pulling() && !s.over) { const c = Math.ceil(-pullT()); view.tip.textContent = c > 0 ? `Připravte se… ${c}` : 'Táhni! Mačkej co nejrychleji, ať jsou u mola dřív než žralok!'; }
        if (pulling() && s.taps > s.sentTaps && Net.now() - s.lastSend > 150) { Net.send({ type: 'ev', e: 'pull', n: s.taps - s.sentTaps }); s.sentTaps = s.taps; s.lastSend = Net.now(); }
        paint();
      },
      draw() {
        K.background(sc.bg, 0, place.look);
        const f = pulling() ? clamp(live.pull / live.needPull, 0, 1) : 0;
        // the stranded two: on the rock, then on the raft coming across
        const rx = LAND.x + (132 - LAND.x) * f, ry = LAND.y - 4 + (cfg.jetty - LAND.y + 4) * f, far = 0.31 + 0.13 * f;   // smaller far out, bigger as they come

        if (pulling()) {
          if (K.has('beach', 'raft')) K.figure('beach', rx, ry + 6, 'raft', 0, false, 0.62);
          rect(Math.min(HX + 8, rx), HY + 4, 1, 1, '#000');
          for (let k = 0; k <= 10; k++) { const u = k / 10; rect(Math.round(HX + 8 + (rx - HX - 8) * u), Math.round(HY + (ry - 6 - HY) * u + Math.sin(u * Math.PI) * 6), 2, 1, '#D9C08A'); }   // the rope
        }
        (sc.cast || []).forEach((id, i) => K.figure(id, rx - 10 + i * 20, ry - (pulling() ? 2 : Math.round(Math.abs(Math.sin(s.t * 4 + i * 1.7)) * 3)), pulling() ? 'three' : 'cheer', s.t, true, far));   // hopping and calling for help, then holding on
        if (!pulling() && s.stuck > 0 && K.has('beach', 'buoy')) K.figure('beach', LAND.x, LAND.y + 2, 'buoy', 0, false, 0.32);
        // the shark: circling during the throws, closing in on the raft while they pull
        const sx = pulling() ? 196 - (196 - rx - 14) * clamp(pullT() / cfg.seconds, 0, 1) : 100 + Math.sin(s.t * 0.9) * 70, sy = pulling() ? ry + 4 : 178;
        if (K.has('aussie', 'fin')) K.figure('aussie', sx, sy, Math.floor(s.t * 5) % 2 ? 'fin' : 'fin2', 0, pulling() || Math.cos(s.t * 0.9) < 0, 0.34);
        for (const q of s.splash) { const u = (s.t - q.at) / 0.6; rect(q.x - 6 * u - 1, LAND.y - 4 - 8 * (1 - u), 3, 3, '#FFFFFF'); rect(q.x + 6 * u - 1, LAND.y - 4 - 8 * (1 - u), 3, 3, '#FFFFFF'); }
        for (const b of [...s.buoys, ...s.mateBuoys]) { if (K.has('beach', 'buoy')) K.figure('beach', b.x, b.y + 6, 'buoy', 0, false, 0.3); else rect(b.x - 4, b.y - 4, 8, 8, '#CC2233'); }
        if (mateHere()) K.hero(mate(), HX + 22, GY + 2, pulling() ? (Math.floor(s.t * 6) % 2 ? 'aim' : 'stand') : 'stand', s.t + 0.3);
        K.hero(who, HX, GY + 4, s.lost ? 'dizzy' : pulling() ? (s.taps % 2 ? 'aim' : 'stand') : 'aim', s.t);
        if (!pulling() && !s.over) {                                                         // the throwing meter, by the hero
          const mx = 6, my = 120, mh = 90, p = meter(s.t);
          rect(mx - 1, my - 1, 10, mh + 2, INK); rect(mx, my, 8, mh, '#3A2F33');
          const lo = cfg.green[0], hi = cfg.green[1];
          rect(mx, my + Math.round(mh * (1 - hi)), 8, Math.round(mh * (hi - lo)), '#1FA463');
          rect(mx - 3, my + Math.round(mh * (1 - p)) - 1, 14, 3, s.cool > 0 ? '#8A8F9C' : '#FFD43A');
        }
      },
    };
  }

  // The tower: Sami's house in Sydney goes up storey by storey. Kendrick drives the crane along its arm (drag), and
  // Kellyn lets each storey go (tap) when it hangs over the top of the house; the higher the house, the more the
  // storey swings on the hook. A storey that misses falls off. On one device, one player does both.
  function Tower(sc, place, sn) {
    const cfg = sc.tower, who = me(), GY = 236, SH = 25, JIB = 30, CABLE = 30, SW = 40;
    const two = () => mateHere(), steers = () => !two() || who === 'ken', drops = () => !two() || who === 'kel';
    const POSES = ['floor', 'plants', 'lights'];
    const STACK = cfg.stack || 24, LIFT = 1;                                     // the storeys wait on the ground at STACK; fetching one takes LIFT seconds
    const s = { t: 0, over: false, lost: false, crane: sn.crane, mateCrane: sn.crane, sent: 0, told: 0, cam: 0, fall: null, seen: 0, spark: null, target: null, lifts: sn.lifts, liftAt: -9 };
    let live = sn;
    const view = stage('<span class="lives"></span><span class="count"></span><span class="meter"><i></i></span>', '');
    const crane = () => (steers() ? s.crane : s.mateCrane);
    const hook = () => crane() + Room.course.sway(s.t, live.floors.length - 1);
    const top = () => live.floors[live.floors.length - 1];
    const pose = (i, n) => (i === 0 ? 'lobby' : i === n - 1 ? 'roof' : POSES[i % 3]);
    const paint = () => {
      hearts(view.hud.children[0], live.lives, sn.lives);
      view.hud.children[1].textContent = `${live.floors.length - 1} / ${live.need - 1}`;          // storeys built on top of the lobby
      view.hud.children[2].firstElementChild.style.width = clamp(live.floors.length / live.need, 0, 1) * 100 + '%';
    };
    const tip = () => { if (!s.over && !s.seen) view.tip.textContent = !two() ? 'Jeď nad hromádku, zvedni patro, přivez ho nad dům a pusť.' : steers() ? `Ty řídíš jeřáb: k hromádce pro patro a pak nad dům. ${heroName(mate())} patra zvedá a pouští.` : `Ty patra zvedáš a pouštíš. Jeřáb řídí ${heroName(mate())}.`; };
    view.tip.classList.add('up'); paint(); tip();
    // The arrows for whoever drives the crane, the big button for whoever lets the storeys go (alone: both).
    const hold = (to) => ({ press: () => { if (!s.over) s.target = to; }, release: () => { s.target = null; } });
    const keys = pad([...(steers() ? [{ id: 'left', side: 'left', ...hold(12) }, { id: 'right', side: 'left', ...hold(168) }] : []), ...(drops() ? [{ id: 'drop', label: 'Zvedni', big: true, press: () => hookIt() }] : [])]);
    function dropIt() { if (s.over || s.t < 0 || Net.now() < live.busyUntil || !live.holding) return; beep(330); Net.send({ type: 'ev', e: 'drop', x: hook() }); }
    function pickIt() { if (s.over || s.t < 0 || Net.now() < live.busyUntil || live.holding) return; if (Math.abs(crane() - STACK) > 12) { beep(180); view.tip.textContent = 'Nejdřív jeď jeřábem nad hromádku pater.'; s.toldAt = s.t; return; } beep(440, 520); Net.send({ type: 'ev', e: 'pick', x: crane() }); }
    const hookIt = () => (live.holding ? dropIt() : pickIt());                       // one button: pick up, then let go
    function steer(x) {
      s.crane = clamp(x, 12, 168);
      const now = Net.now();
      if (now - s.sent > 60) { s.sent = now; Net.send({ type: 'fx', k: 'crane', x: s.crane }); }
      if (now - s.told > 140) { s.told = now; Net.send({ type: 'ev', e: 'crane', x: s.crane }); }
    }
    return {
      s, kind: 'tower',
      peek: () => ({ steers: steers(), drops: drops(), crane: crane(), hook: hook(), top: top(), busy: Net.now() < live.busyUntil, floors: live.floors.length, need: live.need, holding: live.holding, stack: STACK }),
      steerTo: (x) => { s.target = x; },
      sync(n) {
        if (n.last && n.last.n !== s.seen) {                           // a storey has been let go: show it falling
          s.seen = n.last.n; if (!s.over) view.tip.textContent = '';
          s.fall = { x: n.last.x, ok: n.last.ok, perfect: n.last.perfect, at: s.t, i: n.last.ok ? n.floors.length - 1 : -1, from: JIB + CABLE - s.cam };
          if (n.last.perfect && !s.over) cheer('Perfektní!');
          // a new stage of the climb: say what gets harder
          const built = n.floors.length - 1, said = { 5: 'Výš se to víc houpe. Pouštěj, když je patro přesně nad domem!', 7: 'Fouká vítr! Jeřáb musí vítr dorovnávat.', 11: 'Už jsme skoro nahoře. Opatrně!' }[built];
          if (said && n.last.ok && !s.over) { view.tip.textContent = said; s.toldAt = s.t; }
          beep(...(n.last.ok ? (n.last.perfect ? [660, 880, 1100] : [520, 660]) : [200, 150]));
        }
        if (n.lifts !== s.lifts) { s.lifts = n.lifts; s.liftAt = s.t; beep(300, 400, 500); }      // the hook goes down for a storey and brings it up
        if (!steers()) s.mateCrane = n.crane;
        live = n; paint();
      },
      fx(m) { if (m.k === 'crane' && !steers()) s.mateCrane = m.x; },
      over(won) { s.over = true; s.lost = !won; paint(); view.end(won, won ? 'Dům stojí!' : 'Spadlo to.', won ? 'Sydney má nový mrakodrap.' : 'Zkuste to ještě jednou.'); },
      down(x, y) {
        if (s.over || y < 22) return;
        if (drops() && !steers()) return hookIt();                     // Kellyn: a tap anywhere works the hook
        if (steers()) s.target = x;                                    // Kendrick: the crane heads for the finger
      },
      move(x, y) { if (!s.over && steers()) s.target = x; },
      update(dt) {
        if (s.over) return;
        s.t = clock(live);
        if (s.target !== null && steers()) { const d = s.target - s.crane; steer(s.crane + clamp(d, -110 * dt, 110 * dt)); if (Math.abs(d) < 0.5) s.target = null; }
        if (drops()) {                                                       // the hook's button: Zvedni over the stack, Pusť! with a storey; lit when it is the moment
          keys.label('drop', live.holding ? 'Pusť!' : 'Zvedni');
          keys.mark('drop', !s.over && Net.now() >= live.busyUntil && (live.holding ? Math.abs(hook() - top()) <= Room.course.slack(cfg.slack, live.floors.length - 1) * 0.6 : Math.abs(crane() - STACK) <= 12));
        }
        if (s.toldAt && s.t - s.toldAt > 3.5) { view.tip.textContent = ''; s.toldAt = 0; }
        const want = Math.max(0, (live.floors.length - (s.fall && s.fall.ok && s.t - s.fall.at < 0.5 ? 1 : 0)) * SH - (GY - 170));
        s.cam += (want - s.cam) * Math.min(1, dt * 3);
        if (s.fall && s.t - s.fall.at > 1.2) s.fall = null;
        paint();
      },
      draw() {
        const cam = Math.round(s.cam), img = K.picture(sc.bg), back = Math.round(cam * 0.5);
        if (img) { ctx.drawImage(img, 0, back); if (back > 0) ctx.drawImage(img, 0, 0, W, 1, 0, 0, W, back + 1); }   // the sky stretches up as the camera rises
        else K.background(sc.bg, 0, place.look);
        const sy = (y) => y + cam, n = live.need;
        // the house so far; a storey still falling is drawn by the fall
        live.floors.forEach((x, i) => {
          if (s.fall && s.fall.ok && s.fall.i === i && s.t - s.fall.at < 0.45) return;
          if (K.has('storeys', pose(i, n))) K.figure('storeys', x, sy(GY - i * SH), pose(i, n), 0, false);
          else { rect(x - SW / 2, sy(GY - (i + 1) * SH), SW, SH, INK); rect(x - SW / 2 + 1, sy(GY - (i + 1) * SH) + 1, SW - 2, SH - 2, '#E6CFA0'); }
        });
        // the people down on the site, who scroll away as the house rises
        // the stack of storeys waiting on the ground, as many as are still to come (up to three)
        const left = live.need - live.floors.length - (live.holding ? 1 : 0);
        for (let k = 0; k < Math.min(3, left); k++) if (K.has('storeys', 'floor')) K.figure('storeys', STACK, sy(GY + 2 - k * SH * 0.8), POSES[(live.floors.length + k + 1) % 3], 0, false, 0.4);
        (sc.cast || []).forEach((id, i) => K.figure(id, 150 + i * 24, sy(GY + 4), 'three', s.t, true));
        if (mateHere()) K.hero(mate(), 62, sy(GY + 6), 'stand', s.t + 0.3);
        K.hero(who, 46, sy(GY + 6), s.lost ? 'dizzy' : 'stand', s.t);
        const wind = Room.course.wind(s.t, live.floors.length - 1);
        if (Math.abs(wind) > 1) for (let k = 0; k < 7; k++) {                                      // the wind, as streaks blowing across the sky
          const dir = Math.sign(Math.cos(s.t * 0.35 + 1)) || 1, sp = 40 + Math.abs(wind) * 6, y = 44 + ((k * 37) % 150);
          const x = ((k * 53 + dir * s.t * sp) % (W + 40) + W + 40) % (W + 40) - 20;
          rect(Math.round(x), y, 14, 1, 'rgba(255,255,255,.7)'); rect(Math.round(x) + (dir > 0 ? -6 : 14), y + 2, 6, 1, 'rgba(255,255,255,.5)');
        }
        // the crane: only its arm across the top (the mast is out of the picture), the cabin, the trolley, the cable and the hook
        rect(4, JIB, 188, 5, '#B8860B'); rect(4, JIB + 1, 188, 1, '#F2C94C'); for (let x = 6; x < 190; x += 6) rect(x, JIB + 2, 1, 2, '#F2C94C');
        rect(172, JIB - 9, 18, 9, '#B8860B'); rect(174, JIB - 7, 7, 5, '#BFE3F2');                    // the cabin
        const c = Math.round(crane()), lift = s.t - s.liftAt < LIFT ? (s.t - s.liftAt) / LIFT : -1;
        // fetching: the cable runs down to the stack on the ground and back up with a storey
        const deep = lift >= 0 ? Math.sin(lift * Math.PI) * (sy(GY) - JIB - CABLE - SH * 0.8) : 0;
        const hx = lift >= 0 ? c : live.holding ? hook() : c, hy = JIB + CABLE + Math.round(deep);
        rect(c - 5, JIB + 5, 10, 3, INK);
        for (let k = 0; k <= 10; k++) rect(Math.round(c + (hx - c) * k / 10), Math.round(JIB + 8 + (hy - JIB - 8) * k / 10), 1, 2, '#46536A');
        rect(Math.round(hx) - 3, hy - 1, 6, 2, INK);                                                // the hook
        if (!live.holding && !s.over && lift < 0) for (let y = JIB + 10; y < sy(GY) - SH; y += 7) rect(STACK, y, 1, 3, 'rgba(255,212,58,.55)');   // where to fetch the next one
        if (lift > 0.5 && K.has('storeys', 'floor')) K.figure('storeys', hx, hy + SH + 1, pose(live.floors.length, n), 0, false);   // on its way up
        if (!s.over && Net.now() >= live.busyUntil && live.holding && live.floors.length < n) {
          const i = live.floors.length;
          if (K.has('storeys', pose(i, n))) K.figure('storeys', hx, hy + SH + 1, pose(i, n), 0, false);
          // a faint line straight down, to help aim
          for (let y = hy + SH + 4; y < sy(GY - live.floors.length * SH); y += 6) rect(Math.round(hx), y, 1, 2, 'rgba(255,248,231,.35)');
        }
        // a storey on its way down: onto the house, or past it and off the screen
        if (s.fall) {
          const u = s.t - s.fall.at, i = s.fall.ok ? s.fall.i : live.floors.length;
          const land = s.fall.ok ? sy(GY - i * SH) : H + 60, y0 = s.fall.from + SH + 1 + cam;    // from the hook, where it hung (`from` is on the house, not the screen)
          const y = Math.min(land, y0 + 420 * u * u), x = s.fall.ok ? s.fall.x : s.fall.x + u * 30;
          if (y < land || s.fall.ok) K.figure('storeys', x, y, pose(i, n), 0, false);
          if (s.fall.ok && y >= land && s.fall.perfect && u < 1) { for (let k = 0; k < 4; k++) rect(Math.round(x - 22 + k * 14), Math.round(land - SH - 6 - (u - 0.45) * 20), 3, 3, '#FFD43A'); }
        }
      },
    };
  }

  // ---- a place is finished: the people are free, and now they can be named ----
  const Rescued = (place) => {
    let t = 0;
    return {
      enter() {
        const lines = (place.done || []).map(([key, text]) => (key ? `<p class="line">${face(key, 1)}<span><strong>${esc((place.saves.find((s) => s.id === key) || { name: key }).name)}:</strong> ${esc(text)}</span></p>` : `<p>${esc(text)}</p>`)).join('');
        const card = add(`<div class="card top"><h2>${place.saves.length ? 'Zachráněno!' : 'Hotovo!'}</h2>${lines}<button class="btn">${place.saves.length ? 'Dál' : 'Na mapu'}</button></div>`);
        card.querySelector('button').addEventListener('click', () => { beep(520, 660); Net.send({ type: 'home' }); });
        beep(520, 660, 780, 1040);
      },
      update(dt) { t += dt; },
      draw() {
        const sc = place.scenes[place.scenes.length - 1], gy = sc.ground || GROUND, two = mateHere();
        K.background(sc.bg, 0, place.look);
        K.hero(me(), two ? 30 : 52, gy - Math.abs(Math.sin(t * 6)) * 6, 'cheer', t);
        if (two) K.hero(mate(), 66, gy - Math.abs(Math.sin(t * 6 + 2)) * 6, 'cheer', t);
        place.saves.forEach((sv, i) => {
          if (K.sprites[sv.id]) K.figure(sv.id, 118 + i * 40, gy - Math.round(Math.abs(Math.sin(t * 5 + i * 1.7)) * 5), 'cheer', t, true);   // hopping for joy
          else { rect(104 + i * 26, gy - 30, 12, 30, INK); rect(105 + i * 26, gy - 29, 10, 28, '#FFD43A'); }
        });
      },
    };
  };

  // ---- the album: everyone rescued so far ----
  // ---- saving. The game saves by itself: the room counts a level the moment it is won, and every phone keeps a
  // copy. The save code carries it to another phone or browser: how many levels are done (they are played in
  // order), as the word of the last one won and four digits that check it, e.g. KOALA-4721. Nothing is kept on the
  // server for it, so it works even after the server has forgotten everything.
  const LEVELS = places.flatMap((p) => p.scenes);
  const levelsDone = () => {
    let n = 0;
    for (const p of places) { const pr = progress(p); if (pr.done) { n += p.scenes.length; continue; } n += Math.min(pr.scene | 0, p.scenes.length); break; }
    return n;
  };
  const digits = (n) => String((n * 1543 + 2718) % 10000).padStart(4, '0');
  const codeOf = (n) => `${n ? LEVELS[n - 1].code || 'MISE' : 'START'}-${digits(n)}`;
  const fromCode = (text) => {
    const d = (String(text).match(/\d/g) || []).join('');
    for (let n = 0; d.length === 4 && n <= LEVELS.length; n++) if (digits(n) === d) return n;
    return null;
  };
  const progressFor = (n) => Object.fromEntries(places.map((p) => { const k = Math.min(p.scenes.length, n); n -= k; return [p.id, { scene: k, done: k === p.scenes.length }]; }));
  const Saves = {
    enter() {
      const bar = add('<div class="bar"><button data-back>&lt; Zpět</button><span>Uložení</span></div>');
      bar.querySelector('[data-back]').addEventListener('click', () => { beep(440); backToMap(); });
      const box = add(`<div class="saves">
        <p>Hra se ukládá sama po každé vyhrané úrovni.</p>
        <p class="code"></p>
        <p class="small">To je váš kód. Vyfoťte si ho nebo opište. Na jiném telefonu ho zadáte a hrajete dál.</p>
        <form><input name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="24" placeholder="Zadej kód" aria-label="Kód"><button class="btn">Načíst</button></form>
        <p class="note" aria-live="polite"></p>
        <button class="btn red" data-new>Nová hra</button>
      </div>`);
      const code = box.querySelector('.code'), note = box.querySelector('.note');
      const show = () => { code.textContent = codeOf(levelsDone()); };
      show();
      box.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        const field = box.querySelector('input'), n = fromCode(field.value), had = levelsDone();
        if (n === null) { beep(180); note.textContent = 'Tenhle kód neznám. Zkontrolujte čtyři čísla.'; return; }
        if (n <= had) { beep(180); note.textContent = 'Tady už jste stejně daleko, nebo dál.'; return; }
        beep(520, 660, 780); field.value = '';
        Net.send({ type: 'load', places: progressFor(n) });
        note.textContent = `Načteno! ${n < LEVELS.length ? `Pokračujete: ${LEVELS[n].name}.` : 'Všechno je hotové.'}`;
        setTimeout(show, 600);
      });
      box.querySelector('[data-new]').addEventListener('click', () => {
        beep(330);
        const ask = add(`<div class="card"><h2>Nová hra?</h2><p>Všechno odehrané se smaže, i na druhém telefonu. Kód si nejdřív vyfoťte, kdybyste se chtěli vrátit.</p>
          <div class="two"><button class="btn red" data-a="yes">Smazat</button><button class="btn" data-a="no">Ne</button></div></div>`);
        ask.addEventListener('click', (e) => {
          const b = e.target.closest('[data-a]'); if (!b) return;
          ask.remove();
          if (b.dataset.a === 'no') return beep(440);
          beep(660, 520, 330);
          Net.send({ type: 'restart' });
          setTimeout(backToMap, 500);
        });
      });
    },
    draw() { rect(0, 0, W, H, '#3A2F33'); },
  };

  const Album = {
    enter() {
      const bar = add('<div class="bar"><button data-back>&lt; Zpět</button><span>Album</span></div>');
      bar.querySelector('[data-back]').addEventListener('click', () => { away = false; shown = null; route(); });
      const people = places.flatMap((p) => p.saves);
      add(`<div class="album">${people.map((s) => {
        const got = st().save.album.includes(s.id), sp = K.sprites[s.id], x = got && sp && sp.extra;
        const pic = x ? `<img alt="" src="${K.asset(`assets/sprites/${x.file}`)}" style="width:${x.w / 8}em;height:${x.h / 8}em">` : '';
        const head = got ? face(s.id, 3) || `<span>${esc(s.name.charAt(0))}</span>` : '<span>?</span>';
        return `<div data-got="${got ? 1 : 0}">${head}${got ? esc(s.name) : '???'}${pic}</div>`;
      }).join('')}</div>`);
    },
    draw() { rect(0, 0, W, H, '#3A2F33'); },
  };

  K.net = Net;                                 // for looking in from outside when testing
  go(Title);
  // Every other picture, asked for while the title is up, so a level opens without waiting for its pictures.
  setTimeout(() => [...new Set(WORLD.places.flatMap((p) => p.scenes.map((s) => s.music)).filter(Boolean))].forEach(K.loadTune), 1500);
  setTimeout(() => K.preload([...((window.ASSETS && window.ASSETS.bg) || []).map((id) => `assets/bg/${id}.png`),
    ...Object.values(K.sprites).flatMap((sp) => [sp.file, sp.faces && sp.faces.file, sp.still && sp.still.file].filter(Boolean)).map((f) => `assets/sprites/${f}`)]), 400);
  if (save.who) Title.join(save.who);          // back again: straight to one's seat
})();
