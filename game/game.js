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
      if (sn.phase === 'play' && !act) act = { run: Runner, platform: Platform, drums: Drums, shoot: Shoot, echo: Echo, find: Find, salon: Salon, memory: Memory, collect: Collect, rescue: Rescue, tower: Tower, flat: Flat }[sc.play](sc, place, sn);
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
      down(x, y, id) { if (act && sn.phase === 'play' && !sn.paused) act.down(x, y, id); },      // games answer the moment a finger lands, not when it lifts
      move(x, y, dx, id) { if (act && act.move && !sn.paused) act.move(x, y, dx, id); },
      up(x, y, tapped, id) { if (act && act.up) act.up(x, y, tapped, id); },                   // always heard, paused or not: whatever is held is let go
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
    const PROP = { car1: 'street', car2: 'street', bench: 'street', bin: 'street', wall: 'street', boulder: 'hill', logs: 'hill', box: 'kerb', tv: 'kerb' };
    L.blocks.forEach((b, i) => { const c = b.x + b.w / 2; b.base = L.blocks.slice(0, i).reduce((m, o) => (c > o.x && c < o.x + o.w ? Math.max(m, o.h) : m), 0); });
    const art = (sheet, pose) => K.has(sheet, pose) && K.sprites[sheet].sizes && K.sprites[sheet].sizes[pose];
    const hillImg = new Image(); hillImg.src = K.asset(`assets/sprites/${(K.sprites.hill || {}).file || 'hill.png'}`);
    const towerImg = cfg.gate === 'flat' ? new Image() : null; if (towerImg) towerImg.src = K.asset(`assets/sprites/${(K.sprites.storeys || {}).file || 'storeys.png'}`);   // its door opens: drawn from the picture
    const SIZE = { pigeon: [9, 16], flyer: [9, 7], crow: [10, 7], cone: [6, 12], puddle: [9, 2], ibis: [9, 19], magpie: [10, 7] };   // half-width, and height (flyers: half-height round their middle)
    const FLIES = ['flyer', 'crow', 'magpie'];
    const CLUES = { comb: ['prague', 'comb'], clip: ['salonkit', 'clip'], note: ['strahov', 'note'] };
    // Nábytek: a list of furniture to find (cfg.list). Each piece stands true to size next to the kids (sheet, scale)
    // and has its name as it is written on the list (and as in "Soused vynesl …", where that is different).
    const PIECE = { sofa: ['furniture', 0.5, 'gauč'], armchair: ['furniture', 0.5, 'křeslo'], lamp: ['furniture', 0.5, 'lampa', 'lampu'], table: ['furniture', 0.5, 'stolek'],
      chair: ['furniture', 0.5, 'židle', 'židli'], shelf: ['furniture', 0.5, 'knihovna', 'knihovnu'], rugroll: ['furniture', 0.5, 'koberec'], plant: ['furniture', 0.5, 'kytka', 'kytku'], bed: ['kerb', 0.75, 'postel'] };
    const LIST = cfg.list ? cfg.list.filter((k) => PIECE[k]) : null, SOFT = !!cfg.forgiving;
    const pieces = LIST ? L.items.filter((it) => LIST.includes(it.kind)) : [];
    const dims = (kind) => { const [sheet, k] = PIECE[kind], sz = art(sheet, kind) || [40, 40]; return { w: Math.round(sz[0] * k), h: Math.round(sz[1] * k), k, sheet }; };
    const named = (kind) => PIECE[kind][2];
    const taken = new Set(), seen = new Set(sn.got || []);    // taken: found on this phone (the room hears of it a moment later); seen: shown as found
    // cfg.later: a piece that a neighbour puts out only once another is found; until then it is not on the kerb.
    const LATER = cfg.later || {}, there = (it) => !LATER[it.kind] || pieces.some((o) => o.kind === LATER[it.kind] && found(o));
    const s = { t: 0, over: false, lost: false, me: { x: who === 'kel' && mateHere() ? 18 : 36, y: 0, vy: 0, face: 1, ground: true, inv: 0, hurt: -9, cool: 0, sent: 0, done: false },
      mate: { x: who === 'kel' ? 36 : 18, y: 0, face: 1, pose: 'stand', tx: null, ty: 0 }, dir: 0, held: { left: false, right: false }, jumpHeld: false,
      shots: [], cam: 0, pops: [], whack: -9, told: false, freed: -9, sw: {}, flying: {}, sent: {}, hunt: false, bumpAt: -9, allAt: 0, quake: -9, stuck: 0,
      born: {}, news: null, short: 0, holdTold: -99 };
    let live = sn;
    const found = (it) => taken.has(it.id) || live.got.includes(it.id);
    const missing = () => pieces.filter((it) => !found(it));
    const view = LIST ? stage('<span class="lives"></span><span class="meter"><i></i></span>', mateHere() ? 'Najděte všechno ze seznamu!' : 'Najdi všechno ze seznamu!')
      : stage('<span class="lives"></span><span class="count"></span><span class="meter"><i></i></span>', 'Šipkami jdeš, Skok skáče, Hoď hází.');
    if (LIST) s.tipAt = 1.5;                                                                     // the advice goes once the walk is under way
    const steer = () => { s.dir = (s.held.right ? 1 : 0) - (s.held.left ? 1 : 0); };
    const keys = pad([
      { id: 'left', side: 'left', press: () => { s.held.left = true; steer(); if (SOFT && out(who) && !s.over) blub(); }, release: () => { s.held.left = false; steer(); } },
      { id: 'right', side: 'left', press: () => { s.held.right = true; steer(); if (SOFT && out(who) && !s.over) blub(); }, release: () => { s.held.right = false; steer(); } },
      { id: 'throw', label: 'Hoď', press: () => throwIt() },
      { id: 'jump', label: 'Skok', big: true, press: () => { s.jumpKey = true; jump(); }, release: () => { s.jumpKey = false; cut(); } },
    ], 'walk');                                                                                  // big arrows: walking is most of the game here
    const out = (w) => !!(live.out && live.out[w]);
    const powered = () => !!sc.pickup && Net.now() < live.power;
    const beaten = (id) => live.beaten.includes(id);
    const paint = () => {
      hearts(view.hud.firstElementChild, out(who) ? 0 : live.hp[who], live.max);
      if (!LIST) view.hud.children[1].textContent = `★ ${live.got.length}`;
      view.hud.lastElementChild.firstElementChild.style.width = clamp(s.me.x / L.goal, 0, 1) * 100 + '%';
      for (const it of pieces) {                                                               // grey until found (and landed in its place), pulsing when the door asks for it
        const el = slots[it.kind], got = found(it) && !s.flying[it.kind], want = !found(it) && (s.hunt || (s.news === it && s.t - s.born[it.id] < 2.5));
        if (el.classList.contains('got') !== got) el.classList.toggle('got', got);
        if (el.classList.contains('miss') !== want) el.classList.toggle('miss', want);
      }
    };
    // The list, under the bar: a small picture of every piece.
    const slots = {}, sheets = {};
    const sheetImg = (id) => { if (!sheets[id]) { sheets[id] = new Image(); sheets[id].src = K.asset(`assets/sprites/${K.sprites[id].file}`); } return sheets[id]; };
    function pic(kind, mw, mh) {                                                               // one piece cut out of its sheet, fitted into mw x mh (em)
      const [id] = PIECE[kind], sp = K.sprites[id], [w, h] = sp.sizes[kind], f = sp.poses[kind][0], c = document.createElement('canvas');
      c.width = w; c.height = h;
      if (mw) { const u = Math.min(mw / w, mh / h); c.style.width = `${w * u}em`; c.style.height = `${h * u}em`; }
      const img = sheetImg(id), put = () => c.getContext('2d').drawImage(img, f * sp.w + Math.floor((sp.w - w) / 2), sp.h - h, w, h, 0, 0, w, h);
      if (img.complete && img.naturalWidth) put(); else img.addEventListener('load', put);
      return c;
    }
    if (LIST) {
      for (const it of pieces) if (there(it)) s.born[it.id] = -9;                               // already out on the kerb (a game picked up again)
      s.strip = add(`<div class="list">${LIST.map((k, i) => `<i data-k="${k}" style="--n:${i}" title="${esc(named(k))}"></i>`).join('')}</div>`);
      for (const k of LIST) { slots[k] = s.strip.querySelector(`[data-k="${k}"]`); slots[k].appendChild(pic(k, 2, 1.6)); }
      for (const id of seen) { const it = L.items[id]; if (it && slots[it.kind]) slots[it.kind].classList.add('got'); }
    }
    paint();
    function jump() {
      const m = s.me; if (SOFT && out(who) && !s.over) return blub();
      if (s.over || s.t < 0 || out(who) || m.done) return;
      // forgiving: a moment after stepping off an edge still jumps, and a press just before landing is kept for it
      if (!m.ground && !(SOFT && m.vy <= 0 && s.t - (m.left || -9) < 0.1)) { if (SOFT) m.want = s.t; return; }
      m.vy = JUMP; m.ground = false; s.jumpHeld = true; m.want = 0; m.left = -9; s.stuck = 0; m.from = m.y; m.short = false; beep(520);
    }
    function cut() { s.jumpHeld = false; if (s.me.vy > 90) { s.me.vy = 90; s.me.short = true; } }   // let go early: a little hop
    function blub() {                                                                          // forgiving: in a bubble a press wobbles it, and says who can help
      if (s.t - (s.wobble || -9) < 0.35) return;
      s.wobble = s.t; beep(330, 440);
      say(mateHere() && !out(mate()) ? `${heroName(mate())} pro tebe vyskočí.` : 'Došla srdíčka.');
    }
    function throwIt() {
      const m = s.me; if (SOFT && out(who) && !s.over) return blub();
      if (s.over || s.t < 0 || out(who) || m.done) return;
      if (m.cool > 0) { if (SOFT) m.wantThrow = true; return; }                                  // forgiving: pressed too soon, thrown the moment it can be
      m.cool = 0.45;
      const shot = shoot(who, m.x + m.face * 8, m.y + 28, m.face, true);
      s.shots.push(shot); beep(who === 'ken' ? 330 : 660);
      Net.send({ type: 'fx', k: 'throw', x: Math.round(shot.x), y: Math.round(shot.y), f: m.face });
    }
    // Kendrick's puck slides fast along the ground: off the edge of a wall or a car it drops to the pavement and slides
    // on, and against a wall it stops. Kellyn's bunny goes up a little and comes down again.
    const shoot = (w, x, y, face, real) => (w === 'ken' ? { w, x, y: y - 25, vx: face * 230, vy: 0, g: 0, left: 0.8, slide: true, real } : { w, x, y: y - 12, vx: face * 150, vy: 110, g: 420, left: 1.1, real });
    // Where everyone is, and what touches what.
    const foesNow = () => L.foes.map((f) => dive(f, L.at(f, s.t))).filter(Boolean).map((p, i) => p).filter((p) => !beaten(p.id));
    // A magpie dives now and then at whoever walks below it: it stops to flap and cry, a shadow shows where it will
    // come down, and down it comes and up again; walk out of the shadow and it misses. When it may dive is set by the
    // clock, the same on both phones, and both aim it at the same one: the nearer of the two kids (each phone knows
    // where the other is, a moment late). It leaves alone one who was hurt a moment ago, and nobody dives while one
    // of them floats in a bubble and the other has stopped to free them.
    const WARN = 0.9, DIVE = 1.0, REST = 8;
    function dive(f, p) {
      if (!p || f.kind !== 'magpie' || !f.every) return p;
      const c = s.t + f.id * 1.3, k = Math.floor(c / f.every), u = c - k * f.every;
      let sw = s.sw[f.id];
      if (!sw || sw.k !== k) {
        if (u > 0.15) return p;                                                                  // only at the start of its turn
        const calm = s.t <= 1 || s.over || out(who) || (mateHere() && out(mate()));
        const kids = [{ x: s.me.x, ok: !s.me.done && s.t - s.me.hurt > REST, mine: true }];
        if (mateHere()) kids.push({ x: s.mate.x, ok: !(live.fin && live.fin[mate()]) && s.t - (s.mate.hurt || -99) > REST, mine: false });
        const aim = calm ? null : kids.filter((q) => q.ok && Math.abs(q.x - p.x) < 72).sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
        sw = s.sw[f.id] = { k, tx: aim ? Math.round(clamp(aim.x, p.x - 64, p.x + 64)) : null };
        if (aim && Math.abs(p.x - s.cam - W / 2) < W / 2 + 20) beep(1500, 1150, 1500);           // its cry, if it is on this screen
      }
      if (sw.tx === null || u >= WARN + DIVE) return p;
      const ty = L.top(sw.tx, 4) + 30;                                                           // as low as a head
      if (u < WARN) return { ...p, warn: u / WARN, tx: sw.tx, ty };
      const v = (u - WARN) / DIVE, e = Math.sin(Math.PI * v);
      return { ...p, x: p.x + (sw.tx - p.x) * e, y: p.y + (ty - p.y) * e, dive: v, tx: sw.tx, ty, dir: (v < 0.5) === (sw.tx >= p.x) ? 1 : -1 };
    }
    const kindOf = (id) => L.foes[parseInt(id, 10)].kind;
    function beat(p, how) {
      if (beaten(p.id)) return;
      live.beaten.push(p.id);                                                                  // gone here at once; the room tells the other phone
      Net.send({ type: 'ev', e: 'beat', id: p.id });
      s.pops.push({ x: p.x, y: p.y + 10, at: s.t, kind: kindOf(p.id), dir: p.dir || 1, away: p.x >= s.me.x ? 1 : -1, how });
      beep(how === 'stomp' ? 700 : 300, 900);
    }
    function hurt(p) {
      const m = s.me; if (m.inv > 0 || out(who) || m.done) return;
      m.inv = 1.4; m.hurt = s.t; m.vy = 120; m.ground = false; beep(200, 150);
      if (SOFT) {                                                                              // knocked back off what hurt, the picture jolts, the hearts shake
        m.push = (p && p.x > m.x ? -1 : 1) * 120; s.quake = s.t;
        const el = view.hud.firstElementChild; el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit');
      }
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
      const walk = SOFT && s.t - m.hurt < 0.3 ? 0 : s.dir;                                       // forgiving: a knock stops you for a moment
      let nx = m.x + walk * SPEED * dt + (m.push || 0) * dt;
      if (m.push) { m.push *= Math.pow(0.02, dt); if (Math.abs(m.push) < 4) m.push = 0; }         // a knock back, dying away
      const go = m.push ? Math.sign(nx - m.x) : walk, want = nx;
      if (s.dir) m.face = s.dir;
      for (const b of L.blocks) {
        if (nx + HALF > b.x && nx - HALF < b.x + b.w && b.h > m.y + (m.ground ? STEP : 0.5)) nx = go > 0 ? Math.min(nx, b.x - HALF) : Math.max(nx, b.x + b.w + HALF);
      }
      if (SOFT) {                                                                                // pushing against something too tall to step up: the Skok button nudges
        s.stuck = s.dir && m.ground && Math.abs(nx - want) > 0.01 ? s.stuck + dt : 0;
        if ((s.stuck > 0.35) !== !!s.nudged) { s.nudged = s.stuck > 0.35; keys.mark('jump', s.nudged); }
      }
      if (LIST && nx > L.goal - 26 && missing().length) { nx = L.goal - 26; if (s.dir > 0) knock(); }   // the door (at the goal) stays shut until the list is complete
      m.x = clamp(nx, 8, LEN - 8);
      const floor = L.top(m.x, HALF - 2);
      if (m.ground && floor > m.y && floor - m.y <= STEP) m.y = floor;                         // up a step
      if (m.ground && floor < m.y) m.ground = false;                                           // off an edge
      if (!m.ground) {
        m.vy -= G * dt * (s.jumpHeld && m.vy > 0 ? 0.75 : 1);
        m.y += m.vy * dt;
        if (m.y <= floor && m.vy <= 0) {
          const fall = m.vy;
          m.y = floor; m.vy = 0; m.ground = true; if (wasAir) beep(180);
          if (SOFT && fall < -200) s.pops.push({ x: m.x, y: m.y, at: s.t, dust: true });          // a puff of dust from a big landing
          if (SOFT) hopped(m);
          // Skok pressed just before landing, or pressed in the air and still held: off again
          if (SOFT && m.want && (s.t - m.want < 0.15 || s.jumpKey)) { jump(); if (!s.jumpKey) cut(); }
        }
      }
      if (m.ground) m.left = s.t;
    }
    // A jump let go of too soon that did not get up onto what is in front: after the second one, a tip to hold Skok.
    function hopped(m) {
      const from = m.from; m.from = undefined;
      if (!s.dir || from === undefined) return;
      if (m.y > from + 1) { s.short = 0; return; }                                              // got up: well done
      const gap = (b) => (s.dir > 0 ? b.x - m.x : m.x - (b.x + b.w));
      const wall = L.blocks.some((b) => gap(b) > -2 && gap(b) < HALF + 6 && b.h > m.y + STEP && b.h < m.y + 50);
      if (wall && m.short && ++s.short >= 2 && s.t - s.holdTold > 8) { s.holdTold = s.t; s.short = 0; say('Drž Skok déle!'); }
    }
    // At the shut door: it rattles, the padlock swings, the list shows what is still missing, and an arrow points to it.
    function knock() {
      const m = s.me; if (s.t - s.bumpAt < 1.4) return;
      s.bumpAt = s.t; s.hunt = true; if (SOFT) m.push = -70;
      beep(150, 110); say(lacking());
    }
    function lacking() {
      const left = missing(), n = left.length;
      if (n === 1) return `Ještě chybí: ${named(left[0].kind)}.`;
      if (n === 2) return `Ještě chybí: ${named(left[0].kind)} a ${named(left[1].kind)}.`;
      return `Ještě chybí: ${n} ${n < 5 ? 'věci' : 'věcí'}.`;
    }
    // A neighbour puts a piece out (cfg.later): it drops onto the kerb with a puff, its place on the list blinks, and an
    // arrow points to it until it is taken.
    function putOut(it) {
      s.born[it.id] = s.t; if (found(it)) return;
      s.news = it; beep(392, 523, 659);
      s.pops.push({ x: it.x, y: it.h, at: s.t + 0.35, dust: true });
      say(`Soused vynesl ${PIECE[it.kind][3] || named(it.kind)}!`);
    }
    // A piece taken here: it is gone from the kerb at once, its name rises from where it stood, and it flies up into the list.
    function take(it) {
      const d = dims(it.kind);
      taken.add(it.id); seen.add(it.id); live.got.push(it.id); s.sent[it.id] = s.t;
      Net.send({ type: 'ev', e: 'got', id: it.id });
      beep(660, 990); plus(named(it.kind).replace(/^./, (c) => c.toUpperCase()) + '!', clamp(it.x - s.cam, 20, W - 20), GY - it.h - d.h - 14);
      s.pops.push({ x: it.x, y: it.h + d.h / 2, at: s.t, got: 'piece' });
      flyHome(it);
    }
    // Up into its place on the list: a little hop first, then off it goes, faster and smaller, and its place pops.
    function flyHome(it) {
      const el = slots[it.kind], to = el && el.querySelector('canvas'); if (!to) return;
      if (!Element.prototype.animate) return;
      const d = dims(it.kind), ui = K.ui.getBoundingClientRect(), u = ui.width / W, box = to.getBoundingClientRect();
      const x = clamp(it.x - s.cam - d.w / 2, 0, W - d.w), y = clamp(GY - it.h - d.h, 30, H - d.h);   // one found off the screen (by the other) comes in from the edge
      const fly = add('<div class="flying"></div>'); fly.appendChild(pic(it.kind));
      Object.assign(fly.style, { left: `${x * u}px`, top: `${y * u}px`, width: `${d.w * u}px`, height: `${d.h * u}px` });
      const dx = box.left - ui.left - x * u, dy = box.top - ui.top - y * u, f = box.width / (d.w * u);
      s.flying[it.kind] = true;
      const land = () => { if (!s.flying[it.kind]) return; delete s.flying[it.kind]; fly.remove(); el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); beep(1320, 1760); };
      const a = fly.animate([{ transform: 'translate(0,0) scale(1)', easing: 'cubic-bezier(.2,.8,.4,1)' },
        { transform: `translate(${-d.w * u * 0.06}px,${-12 * u}px) scale(1.12)`, offset: 0.28, easing: 'cubic-bezier(.6,0,.9,.5)' },
        { transform: `translate(${dx}px,${dy}px) scale(${f})` }], { duration: 760, fill: 'forwards' });
      a.onfinish = land; setTimeout(land, 1200);                                                // land even if the animation is cut short
    }
    function touch() {
      const m = s.me;
      if (out(who) || m.done) return;
      for (const p of foesNow()) {
        const k = kindOf(p.id), [hw, h] = SIZE[k], flying = FLIES.includes(k);
        if (p.falling) continue;                                                               // a cone still dropping from its tree
        if (k === 'magpie' && p.dive === undefined) continue;                                  // a magpie only matters when it dives, and that is seen coming
        const lo = flying ? p.y - h : p.y, hi = flying ? p.y + h : p.y + h;
        if (Math.abs(p.x - m.x) > hw + HALF - 2 || m.y > hi || m.y + TALL < lo) continue;
        if (k === 'puddle') { if (m.ground && m.y < 1) hurt(p); continue; }
        if (powered()) { beat(p, 'whack'); s.whack = s.t; continue; }                         // the drumstick: everything in the way is knocked flying
        if (m.vy < 0 && m.y > lo + (hi - lo) * 0.45) { beat(p, 'stomp'); m.vy = JUMP * 0.62; m.ground = false; continue; }   // landed on it
        hurt(p);
      }
      for (const it of pieces) {                                                                // a piece on the list: reached when standing (or jumping) where it stands
        const d = dims(it.kind);
        if (!found(it) && there(it) && Math.abs(it.x - m.x) < d.w / 2 + HALF - 1 && m.y > it.h - 6 && m.y < it.h + d.h - 4) take(it);
      }
      for (const it of L.items) {
        if (pieces.includes(it)) continue;
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
      if (b && !m.ground && Math.abs(b.x - m.x) < 14 && m.y + TALL + 4 > b.y - 12) {
        s.freed = t(); Net.send({ type: 'ev', e: 'revive' }); beep(523, 659, 784, 1047);
        if (SOFT) { m.inv = Math.max(m.inv, 1.2); cheer(mate() === 'kel' ? 'Volná!' : 'Volný!'); }                             // forgiving: the one who helped is safe a moment too
      }
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
          const [hw, h] = SIZE[k], mid = FLIES.includes(k) ? p.y : p.y + h / 2;
          if (Math.abs(p.x - sh.x) < hw + 4 && Math.abs(mid - sh.y) < h / (FLIES.includes(k) ? 1 : 2) + 6) { beat(p, 'hit'); return false; }
        }
        return true;
      });
    }
    return {
      s, kind: 'platform',
      control: { hold(dir) { s.held.left = dir < 0; s.held.right = dir > 0; steer(); }, jump, cut, throwIt },
      peek: () => ({ x: s.me.x, y: s.me.y, ground: s.me.ground, done: s.me.done, out: out(who), mateOut: mateHere() && out(mate()), face: s.me.face,
        foes: foesNow().map((p) => ({ dx: p.x - s.me.x, y: p.y, kind: kindOf(p.id) })), wall: L.blocks.filter((b) => b.x - s.me.x > -4 && b.x - s.me.x < 26 && b.h > s.me.y + STEP).map((b) => b.h)[0] || 0,
        bubble: mateHere() && out(mate()) ? bubbleAt() : null, goal: L.goal, got: live.got.length, cool: s.me.cool,
        wallL: L.blocks.filter((b) => s.me.x - (b.x + b.w) > -4 && s.me.x - (b.x + b.w) < 26 && b.h > s.me.y + STEP).map((b) => b.h)[0] || 0,
        list: LIST && { left: missing().filter(there).map((it) => ({ kind: it.kind, x: it.x, h: it.h, w: dims(it.kind).w })), hunt: s.hunt, shut: missing().length > 0, news: s.news && !found(s.news) ? s.news.kind : null },
        dives: foesNow().filter((p) => p.tx !== undefined).map((p) => ({ tx: p.tx, warn: p.warn, dive: p.dive })) }),
      sync(n) {
        const wasOut = out(who), mateWas = mateHere() && out(mate()); live = n;
        if (wasOut && !out(who)) { s.me.x = s.bub ? s.bub.x : s.mate.x; s.me.y = L.top(s.me.x); s.me.vy = 0; s.me.ground = true; s.me.inv = 1.6; say(who === 'kel' ? 'Jsi volná! Díky.' : 'Jsi volný! Díky.'); }   // let out of the bubble, where it was
        if (!wasOut && out(who)) say(mateHere() && !out(mate()) ? `Jsi v bublině. ${heroName(mate())} se zastaví a vyskočí pro tebe.` : 'Došla srdíčka.');
        if (!mateWas && mateHere() && out(mate()) && !out(who)) say(`${heroName(mate())} je v bublině! Zastav se a vyskoč.`);
        if (live.picked && sc.pickup && !s.told) { s.told = true; say(WORLD.items[sc.pickup].dash); }
        for (const it of pieces) if (live.got.includes(it.id) && !seen.has(it.id)) {               // found by the other one: it flies up into the list here too
          seen.add(it.id); flyHome(it);
          const x = it.x - s.cam; if (x > -20 && x < W + 20) plus(named(it.kind).replace(/^./, (c) => c.toUpperCase()) + '!', clamp(x, 20, W - 20), GY - it.h - dims(it.kind).h - 14, '#BFE8FF');
        }
        paint();
      },
      fx(m) {
        if (m.k === 'pos') { s.mate.tx = m.x; s.mate.ty = m.y; s.mate.face = m.f; s.mate.pose = m.p; }
        if (m.k === 'throw') s.shots.push(shoot(mate(), m.x, m.y, m.f, false));
        if (m.k === 'hurt') s.mate.hurt = s.t;
      },
      over(won) {
        s.over = true; s.lost = !won; paint();
        const spent = mateHere() ? 'Došla vám srdíčka. Zkuste to ještě jednou.' : 'Došla ti srdíčka. Zkus to ještě jednou.';   // alone: to one child
        if (LIST) return view.end(won, won ? 'Všechno máme!' : 'Au!', won ? 'Celý seznam je hotový. Jde se zařizovat byt!' : spent);
        const count = (k) => live.got.filter((id) => k.includes(L.items[id].kind)).length, n = count(['coin']), clues = count(['comb', 'clip']), notes = count(['note']);
        const found = cfg.gate === 'salon' ? `Sebrali jste ${n} mincí${clues ? ` a ${clues === 2 ? 'hřeben i sponku' : 'jednu stopu'}` : ''}.` : `Sebrali jste ${notes} not.`;
        view.end(won, won ? (cfg.gate === 'salon' ? 'Jste u kadeřnictví!' : 'Jste nahoře!') : 'Au!', won ? found : spent);
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
        if (SOFT && m.wantThrow && m.cool <= 0) { m.wantThrow = false; throwIt(); }
        fly(dt); drift(dt);
        if (LIST) {
          for (const id of taken) if (!live.got.includes(id) && s.t - s.sent[id] > 1.5) { s.sent[id] = s.t; Net.send({ type: 'ev', e: 'got', id }); }   // in case it was lost on the way
          for (const it of pieces) if (s.born[it.id] === undefined && there(it)) putOut(it);
          if (!s.allAt && !missing().length && !Object.keys(s.flying).length) {                  // the last piece has landed: the door opens
            s.allAt = s.t; cheer('Máme všechno!'); beep(523, 659, 784, 1047);
            s.strip.classList.add('all'); if (s.hunt) say('Dveře jsou otevřené!');
          }
        }
        if (!m.done && !out(who) && m.x >= L.goal) { m.done = true; Net.send({ type: 'ev', e: 'finish' }); beep(784, 988, 1175); if (mateHere() && !out(mate()) && !live.fin[mate()]) say(`Hotovo! Počkej, ${heroName(mate())} ještě jde.`); }   // the name as it is (Czech would bend it after "na")
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
        const tt = Math.max(0, s.t), jolt = SOFT && tt - s.quake < 0.25 ? Math.round(Math.sin(tt * 70) * 2) : 0;   // hurt: the picture jolts
        const cam = Math.round(s.cam) + jolt, X = (x) => Math.round(x - cam), Y = (y) => Math.round(GY - y);
        K.background(sc.bg, cam * 0.6, place.look, sc.tile === 'repeat');
        for (const f of L.foes) if (f.kind === 'cone') pine(X(f.x1 + 4), Y(L.top(f.x1)));         // the spruces the cones drop from
        for (const b of L.blocks) if (b.x + b.w > cam - 4 && b.x < cam + W + 4) block(b, X(b.x));
        if (cfg.gate === 'flat') tower(X(L.goal), tt); else gate(cfg.gate, X(L.goal + 12));
        for (const it of pieces) if (!found(it) && there(it)) piece(it, X(it.x), Y(it.h), tt);
        for (const it of L.items) {
          if (pieces.includes(it)) continue;
          if (it.kind === 'pickup' ? live.picked || !sc.pickup : live.got.includes(it.id)) continue;
          const x = X(it.x), y = Y(it.h) - Math.round(Math.sin(tt * 4 + it.id) * 2);
          if (x < -10 || x > W + 10) continue;
          if (it.kind === 'coin') coin(x, y, tt + it.id * 0.3);
          else if (it.kind === 'heart') { const sz = art('street', 'heart'), k = 1 + Math.sin(tt * 6) * 0.08; if (sz) K.figure('street', x, y + 6, 'heart', 0, false, 12 / sz[1] * k); else { rect(x - 5, y - 4, 4, 4, '#CC2233'); rect(x + 1, y - 4, 4, 4, '#CC2233'); rect(x - 4, y, 8, 3, '#CC2233'); } }
          else if (it.kind === 'pickup') item(sc.pickup, x, y - 6, tt);
          else { const a = CLUES[it.kind]; if (a && K.has(a[0], a[1])) { const sp = K.sprites[a[0]]; K.figure(a[0], x, y + 6, a[1], 0, false, 16 / Math.max(sp.w, sp.h) * 1.2); } else coin(x, y, tt); }
        }
        const now = foesNow();
        for (const p of now) if (p.tx !== undefined) shadow(p, X, Y);                               // where a magpie is about to dive
        for (const p of now) { const x = X(p.x); if (x > -20 && x < W + 20 && p.dive === undefined) foe(kindOf(p.id), x, Y(p.y), p, tt); }
        // knocked out: a pigeon flaps off, a crow tumbles, a cone bursts
        s.pops = s.pops.filter((q) => tt - q.at < 0.8);
        for (const q of s.pops) {
          const u = (tt - q.at) / 0.8, x = X(q.x), y = Y(q.y);
          if (u < 0) continue;                                                                     // one still to come
          if (q.got) { const r = Math.round(u * 10); rect(x - 1, y - 8 - r, 2, 2, '#FFD43A'); rect(x - 6 - r / 2, y - 4 - r, 2, 2, '#FFF1A8'); rect(x + 5 + r / 2, y - 4 - r, 2, 2, '#FFF1A8'); continue; }
          if (q.dust) { if (u < 0.4) { const r = Math.round(u * 20); rect(x - 5 - r, y - 2, 3, 2, '#E9DCCB'); rect(x + 3 + r, y - 2, 3, 2, '#E9DCCB'); rect(x - 3 - r, y - 4, 2, 1, '#F4ECE0'); rect(x + 2 + r, y - 4, 2, 1, '#F4ECE0'); } continue; }
          if (q.kind === 'ibis' || q.kind === 'magpie') { bird(q, u, x, y, tt); continue; }
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
        for (const p of now) if (p.dive !== undefined) foe(kindOf(p.id), X(p.x), Y(p.y), p, tt);     // a diving magpie comes down in front of the heroes
        if (LIST) pointers(X, Y, tt);
      },
    };
    function say(text) { view.tip.textContent = text; s.tipAt = s.t || 0.01; }
    // A piece on the list, standing on the kerb: it glints now and then, so it reads as something to take, and gives a
    // little hop when someone comes close.
    function piece(it, x, foot, tt) {
      const d = dims(it.kind); if (x < -d.w || x > W + d.w) return;
      const m = s.me, close = !out(who) && Math.abs(m.x - it.x) < d.w / 2 + 24 && Math.abs(m.y - it.h) < 30;
      const u = (tt - (s.born[it.id] || -9)) / 0.5;                                             // just put out: it drops in and bounces once
      const lift = u < 0.7 ? Math.round(36 * (1 - u / 0.7) * (1 - u / 0.7)) : u < 1 ? Math.round(Math.sin((u - 0.7) / 0.3 * Math.PI) * 4) : 0;
      K.figure(d.sheet, x, foot - lift - (close ? Math.round(Math.abs(Math.sin(tt * 9))) : 0), it.kind, 0, false, d.k);
      for (let i = 0; i < 3; i++) {
        const ph = (tt * 0.9 + i / 3 + it.id * 0.37) % 1; if (ph > 0.32) continue;
        const r = Math.round(Math.sin(ph / 0.32 * Math.PI) * 2), gx = Math.round(x + [-0.42, 0.38, -0.05][i] * d.w), gy = Math.round(foot - [0.7, 0.45, 1][i] * d.h);
        rect(gx - r, gy, r * 2 + 1, 1, '#FFF1A8'); rect(gx, gy - r, 1, r * 2 + 1, '#FFF1A8'); rect(gx, gy, 1, 1, '#FFFFFF');
      }
    }
    // The goal in Sydney: the entrance of Sami's new glass tower, its storeys going up out of the picture. The glass
    // door wears a padlock until the list is complete; then the padlock drops off and the door slides open.
    function tower(x, tt) {
      if (x < -80 || x > W + 80 || !K.has('storeys', 'lobby')) return;
      const k = 2, foot = GY + 2, fill = (a, b, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(a, b, w, h); };
      ['lobby', 'floor', 'plants', 'floor'].forEach((pose, i) => K.figure('storeys', x, foot - i * 50 * k, pose, 0, false, k));
      const left = x - 43 * k, top = foot - 92 * k, gx = left + 36 * k, gy = top + 69 * k, gw = 13 * k, gh = 19 * k;   // the glass of the door, in the lobby's picture
      const open = s.allAt ? clamp((s.t - s.allAt - 0.45) / 0.55, 0, 1) : 0, e = 1 - Math.pow(1 - open, 3);
      if (open > 0 && towerImg.complete && towerImg.naturalWidth) {
        fill(gx, gy, gw, gh, '#FFE29A'); fill(gx, gy + gh - 3, gw, 3, '#F2C46A');                   // light inside
        ctx.save(); ctx.beginPath(); ctx.rect(gx, gy, gw, gh); ctx.clip();
        const slide = Math.round(e * 5) * k;                                                      // the two panes slide apart, slowing as they go
        ctx.drawImage(towerImg, 36, 69, 6, 19, gx - slide, gy, 6 * k, gh);
        ctx.drawImage(towerImg, 43, 69, 6, 19, gx + 7 * k + slide, gy, 6 * k, gh);
        ctx.restore();
      }
      if (K.has('prague', 'padlock')) {
        const since = s.t - s.bumpAt, swing = since < 0.7 ? Math.round(Math.sin(since * 22) * 3 * (1 - since / 0.7)) : 0;
        const drop = s.allAt ? s.t - s.allAt : 0, fall = Math.round(drop * drop * 300);
        if (drop < 0.5) { ctx.save(); ctx.globalAlpha = 1 - drop * 2; K.figure('prague', x + swing, gy + 24 + fall, 'padlock', 0, false, 0.32); ctx.restore(); }
      }
    }
    // The shadow a diving magpie will fall on: wider than a child, it grows and darkens as the magpie gets ready, and
    // red marks at its ends blink with the magpie's "!": step out of it.
    function shadow(p, X, Y) {
      const u = p.warn !== undefined ? p.warn : 1, w = Math.round(9 + 8 * u), x = X(p.tx), y = Y(L.top(p.tx, 4)) + 1;
      ctx.save(); ctx.globalAlpha = 0.4 + 0.4 * u;
      rect(x - w + 4, y - 2, w * 2 - 8, 1, INK); rect(x - w + 1, y - 1, w * 2 - 2, 1, INK); rect(x - w, y, w * 2, 2, INK); rect(x - w + 3, y + 2, w * 2 - 6, 1, INK);
      ctx.restore();
      if (p.warn !== undefined && Math.floor(s.t * 8) % 2 === 0) for (const side of [-1, 1]) {
        const ex = side < 0 ? x - w - 4 : x + w + 1;
        rect(ex, y - 4, 3, 7, INK); rect(ex + 1, y - 3, 1, 5, '#FF4A4A');
      }
    }
    // Knocked out: an ibis is squashed for a moment and flaps off, a magpie tumbles away; a few feathers drift down.
    function bird(q, u, x, y, tt) {
      const foot = y + 10, a = q.away || 1;
      if (q.kind === 'ibis' && u < 0.18 && q.how === 'stomp') { ctx.save(); ctx.translate(x, foot); ctx.scale(1.2, 0.55); K.figure('kerb', 0, 0, 'ibis', 0, a > 0, 0.36); ctx.restore(); return; }
      if (q.how === 'hit' && u < 0.2 && K.has('things', 'flash')) K.figure('things', x, foot - 8, 'flash', 0, false, 0.6);
      const v = Math.max(0, (u - 0.15) / 0.85), e = v * v, pose = q.kind === 'ibis' ? 'ibisfly' : 'magpie2';
      if (K.has('kerb', pose)) K.figure('kerb', x + Math.round(e * 70 * a), foot - Math.round(e * 90) - Math.round(v * 6), pose, 0, a > 0, 0.36);
      for (let i = 0; i < 3; i++) rect(x - 6 + i * 6 + Math.round(Math.sin(u * 9 + i) * 2), foot - 14 + Math.round(u * 16) + i * 2, 2, 1, q.kind === 'magpie' && i === 1 ? INK : '#FFF8E7');
    }
    // Where to go next. A piece left behind gets an arrow at the edge of the screen, with the piece beside it (in two,
    // not one the other has still to walk past: that one is theirs). Once the shut door has said what is missing, or a
    // neighbour has just put a piece out, the arrow bounces and points the way to it, and an arrow over it marks it.
    // With everything found, the arrow points to the door.
    function pointers(X, Y, tt) {
      if (s.over || s.me.done || out(who)) return;
      const left = missing().filter(there), hop = Math.round(Math.abs(Math.sin(tt * 6)) * 3);
      if (!missing().length) {
        if (!s.allAt) return;
        const x = X(L.goal);
        if (x > W + 4) edge(1, null, tt); else arrow(x, Y(48) - hop, 0, '#7CE07C');
        return;
      }
      if (!left.length) return;
      const near = (list) => list.reduce((a, b) => (Math.abs(b.x - s.me.x) < Math.abs(a.x - s.me.x) ? b : a));
      const theirs = (it) => mateHere() && !out(mate()) && !(live.fin && live.fin[mate()]) && s.mate.x < it.x - 10;
      const news = s.news && !found(s.news) && !theirs(s.news) ? s.news : null;
      const behind = left.filter((it) => X(it.x) < -dims(it.kind).w / 2 && !theirs(it)), it = s.hunt ? near(left) : news || (behind.length ? near(behind) : null);
      if (!it) return;
      const x = X(it.x), d = dims(it.kind), hot = s.hunt || it === news;
      if (x < 6) edge(-1, it, tt, hot); else if (x > W - 6) edge(1, it, tt, hot); else arrow(x, Y(it.h + d.h) - 4 - hop, 0, '#FFD43A');   // half off the screen: the edge arrow, which is seen
    }
    function edge(dir, it, tt, hot) {                                                           // at the side of the screen: an arrow out, and what it points to
      const wob = hot || !it ? Math.round(Math.sin(tt * 9) * 2) * dir : 0, y = 120, tip = dir < 0 ? 2 + wob : W - 3 + wob;
      arrow(tip, y, dir, it ? (hot ? '#FFD43A' : '#FFF8E7') : '#7CE07C');
      const cx = tip - dir * 26, top = y - 11;
      rect(cx - 12, top, 24, 22, INK); rect(cx - 11, top + 1, 22, 20, '#FFF8E7');
      if (it) { const [sheet] = PIECE[it.kind], sz = art(sheet, it.kind); if (sz) K.figure(sheet, cx, top + 19, it.kind, 0, false, Math.min(18 / sz[0], 17 / sz[1])); }
      else { rect(cx - 5, top + 4, 10, 15, '#46536A'); rect(cx - 4, top + 5, 8, 14, '#B4E0F5'); rect(cx - 4, top + 5, 2, 14, '#FFE29A'); }   // the glass door
    }
    // A chunky arrow with a dark edge: dir -1 left, 1 right (its tip at x, y), 0 down (its tip at x, y).
    function arrow(x, y, dir, col) {
      for (const [c, g] of [[INK, 1], [col, 0]]) {
        if (dir) {
          for (let i = 0; i <= 6 + g; i++) rect(x - dir * (i - g), y - i, 1, i * 2 + 1, c);
          rect(dir < 0 ? x + 7 - g : x - 13 - g, y - 2 - g, 7 + g * 2, 5 + g * 2, c);
        } else {
          for (let i = 0; i <= 6 + g; i++) rect(x - i, y - (i - g), i * 2 + 1, 1, c);
          rect(x - 2 - g, y - 13 - g, 5 + g * 2, 7 + g * 2, c);
        }
      }
    }
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
      if (k === 'ibis') {                                                                          // it turns to watch whoever comes close
        const near = !out(who) && Math.abs(s.me.x - p.x) < 48 && Math.abs(s.me.y - p.y) < 30, face = near ? Math.sign(s.me.x - p.x) || 1 : p.dir;
        const bob = p.x === L.foes[parseInt(p.id, 10)].x0 && !near ? 0 : Math.round(Math.abs(Math.sin(tt * 7 + p.x * 0.3)));
        if (K.has('kerb', 'ibis')) K.figure('kerb', x, y + 1 - bob, 'ibis', 0, face > 0, 0.36); else rect(x - 7, y - 18, 14, 18, '#F2EEE6');
        return;
      }
      if (k === 'magpie') {                                                                        // gliding; flapping hard before a dive, then down head first
        const pose = p.dive !== undefined ? (p.dive < 0.5 ? 'magpie1' : 'magpie2') : p.warn !== undefined ? (Math.floor(tt * 14) % 2 ? 'magpie1' : 'magpie2') : 'magpie2';
        if (K.has('kerb', pose)) K.figure('kerb', x, y + (pose === 'magpie1' ? 11 : 9), pose, 0, p.dir > 0, 0.36); else rect(x - 8, y - 4, 16, 8, INK);
        if (p.warn !== undefined && Math.floor(tt * 8) % 2 === 0) { rect(x - 2, y - 24, 4, 9, INK); rect(x - 1, y - 23, 2, 7, '#CC2233'); rect(x - 2, y - 13, 4, 4, INK); rect(x - 1, y - 12, 2, 2, '#CC2233'); }   // "!"
        return;
      }
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
      const x = X(b.x), y = Y(b.y), r = 13 + (w === who && tt - (s.wobble || -9) < 0.4 ? Math.round(Math.sin((tt - s.wobble) * 30) * 2) : 0);
      for (let a = 0; a < 40; a++) { const u = a / 40 * Math.PI * 2; rect(Math.round(x + Math.cos(u) * r), Math.round(y + Math.sin(u) * r), 1, 1, a % 5 ? '#BFE8FF' : '#FFFFFF'); }
      rect(x - 7, y - 9, 3, 2, '#FFFFFF');
      K.figure(w, x, y + 10, 'dizzy', tt, false, 0.3);
    }
  }

  // The surf: the sea scrolls past, a little faster all the time, and things come at you. A fin is jumped (Skok, or a
  // tap anywhere); under a parrot you stay down. Each surfs on their own phone, with hearts of their own; out of them,
  // you ride on the partner's board until the partner has passed three more things. The partner surfs a little way
  // behind, so what they did (a jump, a stumble) is shown a moment later, just as the same thing reaches them here.
  // The boomerang, picked up by jumping into it, knocks out the next thing for both of them.
  function Runner(sc, place, sn) {
    const cfg = sc.run, G = 560, JUMP = 200, X = 50, BEHIND = 30, GY = sc.ground || GROUND, who = me(), T = cfg.seconds;
    const V = cfg.speed || [86, 86], vAt = (t) => V[0] + (V[1] - V[0]) * clamp(t / T, 0, 1);
    const D = (t) => (t <= 0 ? V[0] * t : t <= T ? V[0] * t + (V[1] - V[0]) * t * t / (2 * T) : D(T) + V[1] * (t - T));   // how far the sea has gone by
    const { obs, pickAt, heartAt, finale } = Room.course.run(sn.seed, sc);
    obs.forEach((o, i) => { o.i = i; o.d = D(o.at); });
    const how = sc.pickup && WORLD.items[sc.pickup].use;                    // 'hit' (the drumstick) or 'throw' (the boomerang)
    const s = { t: 0, y: 0, vy: 0, inv: 0, over: false, lost: false, obs, pickAt, asked: false, told: false, sent: 0, how, mate: { y: 0, vy: 0, hurt: -9, hop: -9 }, mateOutAt: -9,
      q: [], throws: 0, fly: null, mateFly: null, whack: -9, hurt: -9, hop: -9, queued: -9, shake: -9, cam: 0, parts: [], streak: 0, learnt: {}, note: null, swap: null, end: 0, hud: '' };
    let live = sn;
    const view = stage(`<span class="lives"></span><span class="meter"><i></i></span>${mateHere() ? `<span style="display:flex;align-items:center;gap:.25em">${face(mate(), 0, 1)}<span class="lives" style="font-size:.7em"></span></span>` : ''}`, 'Klepni a skočíš.');
    const keys = pad([{ id: 'throw', label: 'Hoď', side: 'left', hidden: true, count: 0, press: () => throwIt() }, { id: 'jump', label: 'Skok', big: true, press: () => jump() }]);
    const powered = () => how === 'hit' && Net.now() < live.power;
    const out = (w) => !!(live.out && live.out[w]);
    const rides = (w) => mateHere() && out(w) && !out(w === who ? mate() : who);   // out of hearts, at the back of the partner's board
    const riding = () => rides(who), carrying = () => rides(mate());
    const seenRiding = (w) => rides(w) && (w === who || s.t >= s.mateOutAt);     // the partner hops over once their stumble has been shown here
    const xOf = (o) => X + o.d - D(s.t);                                       // where a thing is now, on the screen (before the camera)
    function paint() {
      const hp = (w) => (out(w) || !live.hp ? 0 : live.hp[w]), key = `${hp(who)}/${mateHere() ? hp(mate()) : ''}`;
      if (key !== s.hud) {
        s.hud = key; hearts(view.hud.firstElementChild, hp(who), live.max || 3);
        if (mateHere()) hearts(view.hud.lastElementChild.lastElementChild, hp(mate()), live.max || 3);
      }
      view.hud.children[1].firstElementChild.style.width = clamp(D(s.t) / D(T), 0, 1) * 100 + '%';
    }
    // Answers and hints along the tip line: an answer to a tap first, then what just happened, then what comes next.
    const note = (text, secs) => { s.note = { text, at: s.t, secs: secs || 1.6 }; };
    function nope(text, id) {                                                  // not possible now: a shake of the button, and why
      beep(180); note(text);
      const b = K.ui.querySelector(`.key[data-k="${id}"]`);
      if (b && b.animate) b.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-.3em)' }, { transform: 'translateX(.3em)' }, { transform: 'translateX(0)' }], { duration: 240, easing: 'steps(4)' });
    }
    function burst(x, y, cols, n, up) {                                       // a few drops or feathers, flying off and falling
      for (let k = 0; k < n; k++) s.parts.push({ x, y, vx: (Math.random() - 0.6) * 70, vy: -(up || 40) - Math.random() * 50, c: cols[k % cols.length], age: 0, life: 0.4 + Math.random() * 0.25 });
    }
    const SPRAY = ['#FFFFFF', '#BFE8FF', '#FFFFFF'], FEATHERS = ['#1FA463', '#CC2233', '#3E7BD6', '#FFD43A'];
    function jump() {
      if (s.over) return;
      if (out(who)) { s.hop = s.t; beep(660); Net.send({ type: 'fx', k: 'hop', at: s.t }); return; }        // riding along: a hop on the board, just for fun
      if (s.y > 0 || s.vy !== 0) {                                           // still in the air: a little trick, and it jumps again if it lands soon
        s.queued = s.t; s.trick = s.t; beep(880); burst(X - 10, GY - s.y + 2, SPRAY, 2, 10);
        return;
      }
      const at = clock(live);
      s.vy = JUMP; beep(520); burst(X - 8, GY + 2, SPRAY, 4);
      Net.send({ type: 'fx', k: 'jump', at });
    }
    function giveBoomerang() { s.throws = 3; s.gotAt = s.t; keys.show('throw', true); keys.count('throw', s.throws); }
    // The boomerang flies at the next thing still to come, waits at the edge of the screen if that is not here yet,
    // knocks it out and comes back. That thing is gone for both of them: the room is told at once. Only a thing at
    // least half a second away, by the game's clock (not by where I am drawn, which is further back when riding), so
    // the news reaches the partner's phone over a slow network before that thing reaches them there.
    function throwIt() {
      if (s.over) return;
      if (s.fly) return nope('Bumerang ještě letí.', 'throw');
      if (!s.throws) return nope('Bumerangy došly.', 'throw');
      const from = spot(who).x, o = obs.find((q) => !q.hit && !q.ko && q.smashed === undefined && q.at - s.t > 0.5);
      if (!o) return nope('Už není co srazit.', 'throw');
      s.throws--; keys.count('throw', s.throws); s.threw = true;
      o.ko = true; o.aimed = true;
      s.fly = { x: from + 6, y: GY - spot(who).y - 26, o, home: who };
      beep(660, 880);
      Net.send({ type: 'ev', e: 'ko', i: o.i }); Net.send({ type: 'fx', k: 'throw', at: s.t, i: o.i });
    }
    function flyStep(f, dt) {
      const ox = xOf(f.o), ty = f.back ? GY - spot(f.home).y - 26 : f.o.high ? GY - 64 : GY - 12;
      f.y += (ty - f.y) * Math.min(1, dt * 6);
      if (!f.back) {
        f.x = Math.min(f.x + 190 * dt, W - 14 - s.cam);
        if (f.x >= ox - 4 || f.o.smashed !== undefined) { if (f.o.smashed === undefined) smash(f.o); f.back = true; }
      } else if ((f.x -= 190 * dt) <= spot(f.home).x + 4) { beep(990); return null; }   // caught
      return f;
    }
    function smash(o) {
      o.smashed = s.t; beep(300, 700);
      const x = xOf(o), y = o.high ? GY - 64 : GY - 8;
      burst(x, y, o.high ? FEATHERS : SPRAY, 9, 60);
    }
    function hurt(o) {
      o.hit = true; o.knock = s.t; s.hurt = s.t; s.inv = 1.1; s.shake = s.t; s.streak = 0;
      beep(200, 150); try { if (navigator.vibrate) navigator.vibrate(60); } catch (e) {}
      if (live.hp) live.hp[who] = Math.max(0, live.hp[who] - 1);              // shown at once; the room counts it too
      paint(); const h = view.hud.firstElementChild; if (h.animate) h.animate([{ transform: 'scale(1.4)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'steps(3)' });
      burst(X + 4, GY - s.y - 20, ['#CC2233', '#FFF8E7'], 5);
      Net.send({ type: 'ev', e: 'hurt', i: o.i }); Net.send({ type: 'fx', k: 'hurt', at: s.t, i: o.i });
    }
    // Something went by without hurting me: a ding, and every fifth in a row some praise. The partner riding along
    // counts it towards getting back on their own board.
    function passed(o) {
      o.passed = true;
      if (carrying()) Net.send({ type: 'ev', e: 'pass', i: o.i });
      if (out(who) || o.ko || o.smashed !== undefined || s.inv > 0) return;
      s.learnt[o.high ? 'parrot' : 'fin'] = true; s.streak++;
      beep(1175);
      const praise = { 5: 'Super!', 10: 'Paráda!', 15: 'Skvělá jízda!', 20: 'Mistr vln!' }[s.streak]; if (praise) cheer(praise);
    }
    // Where a surfer stands (x on the screen before the camera, y above the water): on their own board, or riding at
    // the back of the partner's. A change of board is a hop across.
    function spot(w) {
      const mine = w === who;
      if (seenRiding(w)) { const c = mine ? s.mate : s; return { x: (mine ? X - BEHIND : X) - 13, y: c.y }; }
      return { x: mine ? X : X - BEHIND, y: mine ? s.y : s.mate.y };
    }
    const swap = (w, from, at) => { s.swap = { w, from, at: at === undefined ? s.t : at }; };
    function placed(w) {
      const p = spot(w), sw = s.swap && s.swap.w === w && s.t >= s.swap.at && s.t - s.swap.at < 0.45 ? s.swap : null;
      if (!sw) return p;
      const u = (s.t - sw.at) / 0.45, e = 1 - (1 - u) * (1 - u);
      return { x: sw.from.x + (p.x - sw.from.x) * e, y: sw.from.y + (p.y - sw.from.y) * e + Math.sin(u * Math.PI) * 16 };
    }
    // The heart floating by: each may catch it once, for a heart back. Worth a hint only to one who has lost one.
    const heartHere = () => heartAt !== null && !s.healed && !(live.healed && live.healed[who]) && !out(who);
    const wantHeart = () => heartHere() && live.hp && live.hp[who] < (live.max || 3);
    // What the tip line says now. Hints go once they are learnt.
    function tipText() {
      if (s.note && s.t - s.note.at < s.note.secs) return s.note.text;
      if (out(who)) return '';
      if (s.t < 0) return 'Klepni a skočíš.';
      const next = obs.find((o) => !o.passed && !o.hit && !o.ko && o.smashed === undefined);
      if (pickAt !== null && !live.picked && !s.asked && xOf({ d: D(pickAt) }) < W && xOf({ d: D(pickAt) }) > X - 10) return 'Skoč pro bumerang!';
      if (s.throws && !s.threw && live.picked && WORLD.items[sc.pickup].dash && s.t - s.gotAt < 3) return WORLD.items[sc.pickup].dash;   // then the blinking Hoď says it
      if (wantHeart() && xOf({ d: D(heartAt) }) < W && xOf({ d: D(heartAt) }) > X - 10) return 'Skoč pro srdíčko!';
      if (next && !next.high && !s.learnt.fin && xOf(next) < W) return 'Skoč přes žraloka!';
      if (next && next.high && !s.learnt.parrot && next.at - s.t < 1.4) return 'Papoušek! Zůstaň dole.';
      return '';
    }
    return {
      s, kind: 'run', throwIt,
      peek: () => ({ heartAt, healed: !heartHere(), out: out(who), riding: riding(), mateOut: mateHere() && out(mate()), ride: live.ride, throws: s.throws, cam: s.cam, mateY: s.mate.y, mateHurt: s.mate.hurt, xs: obs.map((o) => Math.round(xOf(o))) }),
      sync(n) {
        const was = { me: out(who), mate: mateHere() && out(mate()) }, from = { me: spot(who), mate: mateHere() ? spot(mate()) : null };
        live = n;
        for (const i of live.ko || []) { const o = obs[i]; if (o && !o.ko) { o.ko = true; o.koAt = s.t; } }   // knocked out by the partner
        if (!was.me && out(who)) { swap(who, from.me); s.outAt = s.t; note(mateHere() ? 'Došla srdíčka. Svezeš se!' : 'Došla srdíčka.', 3); }
        if (was.me && !out(who)) { swap(who, from.me); s.inv = 1.5; s.y = 0; s.vy = 0; note('Zase na prkně!', 2); beep(523, 784, 1047); }
        if (mateHere() && !was.mate && out(mate())) {
          const o = live.outAt && obs[live.outAt[mate()]];                       // what knocked them out has yet to reach them here
          s.mateOutAt = Math.max(s.t, o ? o.at + BEHIND / vAt(o.at) : s.t);
          swap(mate(), from.mate, s.mateOutAt); note(`${heroName(mate())} se veze s tebou!`, 3);
        }
        if (mateHere() && was.mate && !out(mate())) { swap(mate(), from.mate); s.mate.y = 0; s.mate.vy = 0; s.mate.back = s.t; note(`${heroName(mate())} je zpátky!`, 2); beep(523, 784); }
        if (live.picked && !s.told) { s.told = true; if (how === 'throw') giveBoomerang(); else note(WORLD.items[sc.pickup].dash, 3); }
        paint();
      },
      // The partner: a jump, a stumble or a hop is shown as late as they surf behind, so it happens just as the same
      // thing reaches them here. A throw is shown at once, and its target is harmless from now on.
      fx(m) {
        const at = Number.isFinite(+m.at) ? +m.at : s.t, o = obs[m.i | 0];
        if (m.k === 'throw') { if (o) { o.ko = true; o.koAt = s.t; o.aimed = true; s.mateFly = { x: spot(mate()).x + 6, y: GY - spot(mate()).y - 26, o, home: mate() }; } return; }
        const due = at + (out(mate()) ? 0 : BEHIND / vAt(at));
        s.q.push({ k: m.k, i: m.i | 0, due }); s.q.sort((a, b) => a.due - b.due);
      },
      over(won) {
        s.over = true; s.lost = !won; paint();
        const two = mateHere();
        view.end(won, won ? 'Zvládnuto!' : 'Au!', won ? (two ? 'Jste na místě.' : 'Jsi na místě.') : (two ? 'Zkuste to ještě jednou.' : 'Zkus to ještě jednou.'));
      },
      down() { jump(); },
      update(dt) {
        s.parts = s.parts.filter((p) => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt; return (p.age += dt) < p.life; });
        if (s.over) { s.end += dt; return; }
        s.t = clock(live);
        const t = s.t;
        // the boards: mine, and the partner's as their messages come due
        for (; s.q.length && s.q[0].due <= t; s.q.shift()) {
          const m = s.q[0], late = t - m.due, o = obs[m.i];
          if (m.k === 'jump' && late < 0.6) { s.mate.vy = JUMP - G * late; s.mate.y = Math.max(0.01, JUMP * late - G * late * late / 2); burst(X - BEHIND - 8, GY + 2, SPRAY, 3); }
          if (m.k === 'hurt' && !(o && o.ko)) { s.mate.hurt = m.due; if (o && !o.hit && o.smashed === undefined) { o.hit = true; o.knock = m.due; } burst(X - BEHIND + 4, GY - s.mate.y - 20, ['#CC2233', '#FFF8E7'], 5); }   // knocked out: the room does not count it either
          if (m.k === 'hop') s.mate.hop = m.due;
        }
        for (const [b, x] of [[s, X], [s.mate, X - BEHIND]]) {
          if (b.vy === 0 && b.y <= 0) continue;
          b.y += b.vy * dt; b.vy -= G * dt;
          if (b.y <= 0) { b.y = 0; b.vy = 0; burst(x, GY + 2, SPRAY, 6); if (b === s && t - s.queued < 0.2) jump(); }
        }
        if (s.inv > 0) s.inv -= dt;
        if (s.fly) { s.fly = flyStep(s.fly, dt); if (!s.fly && !s.throws) keys.show('throw', false); }   // the last one is back: the button goes
        if (s.mateFly) s.mateFly = flyStep(s.mateFly, dt);
        if (pickAt !== null && !live.picked && !s.asked && !out(who) && Math.abs(D(pickAt) - D(t)) < 11 && s.y > 10) {   // jumped into the pick-up
          s.asked = true; s.told = true; beep(660, 880, 1100); burst(X, GY - 50, ['#FFD43A', '#FFF1A8'], 8, 50);
          Net.send({ type: 'ev', e: 'pick' });
          if (how === 'throw') giveBoomerang(); else note(WORLD.items[sc.pickup].dash, 3);
        }
        if (heartHere() && Math.abs(D(heartAt) - D(t)) < 11 && s.y > 10) {           // jumped into the heart
          if (live.hp && live.hp[who] < (live.max || 3)) {
            s.healed = true; Net.send({ type: 'ev', e: 'heal' });
            burst(X, GY - 50, ['#CC2233', '#FFF1A8'], 8, 50);
            live.hp[who]++; paint(); beep(660, 990, 1320); note('Srdíčko navíc!'); plus('+1', X, GY - 62, '#FF6B7A');
          } else if (!s.full) { s.full = true; beep(660); note('Srdíčka máš všechna.'); }   // not needed: it floats on
        }
        for (const o of obs) {
          if (o.passed || o.hit) continue;
          const d = o.d - D(t);
          if (o.ko && o.smashed === undefined && !o.aimed && t - o.koAt > 0.6) smash(o);    // knocked out by the partner, whose boomerang was not seen here
          if (o.ko || o.smashed !== undefined || out(who)) { if (d < -10) passed(o); continue; }
          if (powered() && d > 0 && d < 16) { smash(o); s.whack = t; continue; }   // the drumstick: whack it before it reaches you
          if (d < -10) { passed(o); continue; }
          if (Math.abs(d) <= 8 && s.inv <= 0 && (o.high ? s.y > 12 : s.y < 9)) hurt(o);
          else if (o.high && !o.chirped && o.at - t < 1.25) { o.chirped = true; beep(1568, 1318); }   // a parrot is coming: it squawks
        }
        if (!s.cheered && t > finale - 1.6) { s.cheered = true; cheer('Poslední vlny!'); }
        if (t >= T && Net.now() - s.sent > 1000) { s.sent = Net.now(); Net.send({ type: 'ev', e: 'finish' }); }
        s.cam += ((riding() ? BEHIND : 0) - s.cam) * Math.min(1, dt * 4);          // riding: the camera moves to the board I am on
        const next = obs.find((o) => !o.passed && !o.hit && !o.ko && o.smashed === undefined), soon = (o) => o && o.at - t > 0.15 && o.at - t < 0.6;
        const pick = (pickAt !== null && !live.picked && !s.asked && pickAt - t > 0.15 && pickAt - t < 0.6) || (wantHeart() && heartAt - t > 0.15 && heartAt - t < 0.6);
        keys.mark('jump', !out(who) && ((soon(next) && !next.high && !s.learnt.fin) || pick));   // Skok blinks when it is time
        keys.mark('throw', !!s.throws && !s.threw);
        const tip = tipText(); if (view.tip.textContent !== tip) view.tip.textContent = tip;
        paint();
      },
      draw() {
        const t = Math.max(0, s.t), sx = t - s.shake < 0.25 ? (Math.floor(t * 30) % 2 ? 2 : -2) : 0, cam = Math.round(s.cam) + sx;   // a hit shakes the picture
        K.background(sc.bg, D(s.t) - cam, place.look, sc.tile === 'repeat');                // already moving during 2, 1, Start!
        const at = (o) => Math.round(xOf(o)) + cam, signs = [], bounce = Math.round(Math.abs(Math.sin(t * 7)) * 3);
        // a parrot about to arrive: its shadow on the water grows, and a sign under it says stay down
        for (const o of obs) {
          const u = o.at - t;
          if (!o.high || o.hit || o.ko || o.smashed !== undefined || u > 1.25 || u < -0.2) continue;
          const x = at(o), w = 8 + Math.round(clamp(1 - u / 1.25, 0, 1) * 12);
          rect(x - (w >> 1), GY + 2, w, 3, 'rgba(18,48,92,.45)'); rect(x - (w >> 1) + 2, GY + 1, w - 4, 5, 'rgba(18,48,92,.3)');
          if (u > 0.12 && !out(who)) signs.push([x, GY - 42 + bounce, true]);   // riding along, there is nothing to do
        }
        goal(Math.round(xOf({ d: D(T) })) + cam, t);
        for (const o of obs) {
          const x = at(o);
          if (x < -16 || x > W + 16) continue;
          if (o.smashed !== undefined) {                                        // knocked out: a flash
            const u = t - o.smashed; if (u > 0.35 || !K.has('things', 'flash')) continue;
            K.figure('things', x, (o.high ? GY - 50 : GY - 2) - Math.round(u * 24), 'flash', 0, false, 0.6);
            continue;
          }
          const look = cfg.art && cfg.art[o.high ? 'high' : 'low'];
          let dx = 0, dy = 0;
          if (o.knock !== undefined) { const u = t - o.knock; if (u > 0.7) continue; dy = -Math.round(u * 70); dx = Math.round(u * 40); }   // bumped into: knocked away
          if (o.high) {
            const k = clamp((W + 12 - x) / (W - X - 38), 0, 1);
            dy += Math.round(Math.sin(t * 8 + o.at) * 2) - Math.round((1 - k) * (1 - k) * 22) - (x < X - 14 ? Math.round((X - 14 - x) * 0.6) : 0);   // swoops down to head height, and up again once past
            if (look && K.has(look[0], look[1])) K.figure(look[0], x + dx, GY - 54 + dy, look.length > 2 && Math.floor(t * 6) % 2 ? look[2] : look[1], t, false, 0.36);
            else { rect(x - 7, GY - 62 + dy, 14, 5, INK); rect(x - 6, GY - 61 + dy, 12, 3, '#D2A064'); }
          } else {
            const rise = clamp((W + 14 - x) / 34, 0, 1);                       // comes up out of the water as it arrives
            dy += Math.round((1 - rise) * (1 - rise) * 16);
            ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, GY + 3); ctx.clip();
            if (look && K.has(look[0], look[1])) K.figure(look[0], x + dx, GY + 1 + dy, look.length > 2 && Math.floor(t * 6) % 2 ? look[2] : look[1], t, false, 0.36);
            else { rect(x - 6, GY - 10 + dy, 12, 10, INK); rect(x - 5, GY - 9 + dy, 10, 9, '#8A8F9C'); }
            ctx.restore();
            if (!s.learnt.fin && !out(who) && o === obs.find((q) => !q.high && !q.passed && !q.hit && !q.ko)) signs.push([x, GY - 30 - bounce, false]);   // until a fin is jumped: an arrow up
          }
        }
        if (pickAt !== null && !live.picked && !s.asked) {
          const x = Math.round(xOf({ d: D(pickAt) })) + cam;
          if (x > -12 && x < W + 12) { item(sc.pickup, x, GY - 50 + Math.round(Math.sin(t * 5) * 2), t); if (!out(who)) signs.push([x, GY - 30 - bounce, false]); }
        }
        if (heartHere()) {
          const x = Math.round(xOf({ d: D(heartAt) })) + cam, y = GY - 50 + Math.round(Math.sin(t * 5) * 2), sz = K.has('street', 'heart') && (K.sprites.street.sizes || {}).heart;
          if (x > -12 && x < W + 12) {
            if (sz) K.figure('street', x, y + 6, 'heart', 0, false, 12 / sz[1] * (1 + Math.sin(t * 6) * 0.08));   // beating
            else { rect(x - 5, y - 4, 4, 4, '#CC2233'); rect(x + 1, y - 4, 4, 4, '#CC2233'); rect(x - 4, y, 8, 3, '#CC2233'); }
            if (wantHeart()) signs.push([x, GY - 30 - bounce, false]);
          }
        }
        // the surfers: the partner's board behind, mine in front; one out of hearts rides at the back of the other's
        const joy = (k) => (s.over && !s.lost ? Math.round(Math.abs(Math.sin(s.end * 6 + k)) * 4) : 0);   // won: hopping for joy
        const wave = (k) => Math.round(Math.sin(t * 3 + k));                    // the boards rock on the swell
        const height = (p, k) => Math.round(p.y) + (p.y > 0 ? 0 : wave(k)) + joy(k);
        function surfer(w, back) {
          const mine = w === who, k = mine ? 0 : 2, own = spot(w), p = placed(w), bx = Math.round(own.x) + cam, by = height(own, k);
          if (by <= 0) for (let j = 0; j < 3; j++) if ((Math.floor(t * 12) + j) % 3) rect(bx - 16 - j * 4 - (back ? 6 : 0), GY + 3 + (j % 2), 3, 1, '#FFFFFF');   // the wake
          if (K.has('aussie', 'surfboard')) K.figure('aussie', bx - 2 - (back ? 6 : 0), GY - Math.max(0, by) + 4, 'surfboard', 0, true, back ? 0.66 : 0.48);
          else { rect(bx - 12, GY - by - 1, 24, 4, INK); rect(bx - 11, GY - by, 22, 2, '#F2C94C'); }
          if (back) rider(back, true);
          rider(w, false);
        }
        function rider(w, behind) {
          const mine = w === who, p = placed(w), x = Math.round(p.x) + cam, hurtAt = mine ? s.hurt : s.mate.hurt;
          if (behind) {                                                       // sitting at first, then surfing along; a tap is a hop
            const hop = t - (mine ? s.hop : s.mate.hop) < 0.35, y = height(p, mine ? 3 : 1) + (hop ? 4 : 0);
            K.hero(w, x, GY - y - 1, s.over ? (s.lost ? 'dizzy' : 'cheer') : hop ? 'cheer' : t - (mine ? s.outAt : s.mateOutAt) < 0.9 ? 'dizzy' : 'surf', t);
            if (!s.over && !(s.swap && s.swap.w === w && s.t - s.swap.at < 0.45)) dots(x, GY - y - 58, (live.ride && live.ride[w]) || 0);
            return;
          }
          const safe = mine ? s.inv > 0 : t - hurtAt < 1.1 || t - (s.mate.back || -9) < 1.5;            // can't be hurt for a moment (after a stumble, or back on the board): blinks
          const y = height(p, mine ? 0 : 2), blink = !s.over && safe && Math.floor(t * 14) % 2;
          const trick = mine && p.y > 0 && t - (s.trick ?? -9) < 0.25;            // a tap in the air: arms up
          const pose = s.over ? (s.lost ? 'dizzy' : 'cheer') : t - hurtAt < 0.45 ? 'dizzy' : mine && powered() && t - s.whack < 0.25 ? 'drum' : trick ? 'cheer' : p.y > 0 ? 'jump' : 'surf';
          if (!blink) K.hero(w, x, GY - y - 1, pose, t);
        }
        if (mateHere() && !seenRiding(mate())) surfer(mate(), rides(who) ? who : null);
        if (!rides(who)) surfer(who, mateHere() && seenRiding(mate()) ? mate() : null);
        for (const [x, y, down] of signs) arrow(x, y, down);                    // the signs go over everything
        for (const p of s.parts) rect(Math.round(p.x) + cam, Math.round(p.y), p.c === '#FFFFFF' || p.c === '#BFE8FF' ? 1 : 2, p.c === '#FFFFFF' || p.c === '#BFE8FF' ? 1 : 2, p.c);
        const stumble = t - s.hurt < 0.45;
        if (stumble && !out(who)) { const u = (t - s.hurt) / 0.45, hy = Math.round(GY - s.y - 62 - u * 14); rect(X + cam - 4, hy, 3, 3, '#CC2233'); rect(X + cam + 1, hy, 3, 3, '#CC2233'); rect(X + cam - 3, hy + 2, 6, 3, '#CC2233'); rect(X + cam - 1, hy + 5, 2, 2, '#CC2233'); }   // a heart flies off
        const left = (live.power - Net.now()) / 1000;
        if (powered() && t - s.whack >= 0.25 && (left > 1.5 || Math.floor(t * 8) % 2)) item(sc.pickup, X + cam + 8, GY - s.y - 60);   // held up; blinks when nearly spent
        for (const f of [s.fly, s.mateFly]) {                                    // the boomerang spinning through the air
          if (!f) continue;
          const pose = Math.floor(t * 12) % 2 ? 'boomerang2' : 'boomerang', x = Math.round(f.x) + cam, y = Math.round(f.y);
          if (K.has('aussie', pose)) K.figure('aussie', x, y + 7, pose, 0, false, 0.3);
          else { rect(x - 5, y - 2, 10, 3, '#D2A064'); rect(x - 5, y - 2, 3, 7, '#D2A064'); }
        }
      },
    };
    // A fat pixel arrow with a dark rim, its point at (x, y): up (jump), or down onto a bar (stay down).
    function arrow(x, y, down) {
      const dir = down ? -1 : 1, row = (r, c, rim) => rect(x - r - rim, y + dir * r - rim, r * 2 + 1 + rim * 2, 1 + rim * 2, c);
      for (const [c, rim] of [[INK, 1], ['#FFD43A', 0]]) {
        for (let r = 0; r < 6; r++) row(r, c, rim);
        rect(x - 2 - rim, (down ? y - 10 : y + 6) - rim, 5 + rim * 2, 5 + rim * 2, c);           // the stem
        if (down) rect(x - 5 - rim, y + 3 - rim, 11 + rim * 2, 2 + rim * 2, c);                 // the bar: down to the water, and stay
      }
    }
    // How many things the partner has passed since this one fell off: three, and they are back.
    function dots(x, y, n) {
      for (let k = 0; k < 3; k++) { rect(x - 8 + k * 6, y, 5, 5, INK); rect(x - 7 + k * 6, y + 1, 3, 3, k < n ? '#FFD43A' : '#7A6F6A'); }
    }
    // The finish: a buoy with a chequered flag, waving.
    function goal(x, tt) {
      if (x < -24 || x > W + 24) return;
      rect(x - 5, GY - 3, 11, 6, '#CC2233'); rect(x - 4, GY - 4, 9, 1, '#CC2233'); rect(x - 5, GY - 1, 11, 2, '#FFF8E7');
      rect(x, GY - 42, 1, 38, INK);
      for (let c = 0; c < 6; c++) { const wv = Math.round(Math.sin(tt * 6 - c * 0.9)); for (let r = 0; r < 4; r++) rect(x + 1 + c * 2, GY - 42 + r * 2 + wv, 2, 2, (r + c) % 2 ? INK : '#FFF8E7'); }
    }
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

  // The shot: padlocks pop up around the scene and slip away again after a moment. Tap one to shoot at it.
  // Kendrick fires a puck with his hockey stick, flat and fast. Kellyn takes turns lobbing her white bunny in an
  // arc and throwing a star. They stand at either side; each device sees its own hero on the left. With two, every
  // padlock is someone's, in their colour and with their face on it (Kendrick's blue, Kellyn's pink); one that
  // blinks is about to slip away, and then either of them may save it. The ones that get away cost them both.
  // The first one waits until it is shot. Once enough are open, a big golden padlock comes down: both throw at it within
  // two seconds of each other (alone: hit it three times).
  function Shoot(sc, place, sn) {
    const cfg = sc.shoot, who = me(), GY = sc.ground || GROUND, BODY = 26, G = 420, max = sn.lives, BLINK = 0.9, REACH = 20;
    // A padlock out of time takes SLIP seconds to slip away before it counts as gone: long enough for the partner's
    // last-moment shot to reach this phone first. TOGETHER: how close their two throws at the golden padlock must be.
    const SLIP = 0.5, TOGETHER = 2;
    const hand = (w, x, dir) => (w === 'ken' ? { x: x + dir * 28, y: GY - 4 } : { x: x + dir * 20, y: GY - 34 });   // where a shot leaves: the blade of the stick, or her hand
    const mine = hand(who, BODY, 1), theirs = hand(mate(), W - BODY, -1);
    const { targets } = Room.course.shoot(sn.seed, sc, sn.every, sn.need, sn.two);
    const s = { t: 0, over: false, lost: false, shots: [], pops: [], drops: [], sparks: [], marks: [], cool: 0, swing: 0, mateSwing: 0, thrown: 0, again: null, next: null,
      open: new Set(), told: new Set(), asked: false, said: false, seen: 0, mine: 0, streak: 0, tapAt: 0, nudge: {}, quake: -9, tip: '', tipUntil: Infinity, helped: false, gold: null, painted: '' };
    let live = sn;
    // Whose a padlock is (alone, every one is yours), in their colour, which is also on the floor under each hero.
    const COLOUR = { ken: '#2A62D8', kel: '#E23C86' }, ownerOf = (tg) => tg.owner || who, own = (tg) => ownerOf(tg) === who;
    const RAMP = { ken: ['#0B1A4A', '#163FA0', '#2A62D8', '#4F8BF2', '#A9CBFF'], kel: ['#4A0A26', '#A81E5E', '#E23C86', '#F56FAA', '#FFC2DE'], white: ['#7A6F6A', '#E8DCC4', '#FFF8E7', '#FFFFFF', '#FFFFFF'] };
    const view = stage('<span class="lives"></span><span class="count"></span><span class="meter"><i></i></span>', '');
    // A line of advice that goes away by itself after `secs` (0: stays until something else is said).
    const say = (html, secs) => { if (s.tip !== html) { view.tip.innerHTML = html; s.tip = html; } s.tipUntil = secs ? s.t + secs : Infinity; };
    say(sn.two ? `${face(who, 3, 0.6)} Tvoje zámky jsou ${who === 'ken' ? 'modré' : 'růžové'}.` : 'Klepni na zámek.', 0);
    const paint = () => {
      const key = `${live.lives}/${live.hits}/${live.need}`; if (key === s.painted) return; s.painted = key;
      hearts(view.hud.firstElementChild, live.lives, max); view.hud.children[1].textContent = `${live.hits} / ${live.need}`; view.hud.lastElementChild.firstElementChild.style.width = clamp(live.hits / live.need, 0, 1) * 100 + '%';
    };
    const outBack = (u) => 1 + 2.7 * (u - 1) ** 3 + 1.7 * (u - 1) ** 2;                    // eased out, overshooting a little and settling
    const tx = (tg) => tg.x + Math.sin(s.t * 2 + tg.phase) * tg.sway;
    // The first padlock opens (here, or as the room says): the rest come from then on, and a first one still waiting
    // (with two, the other's) starts its time.
    let go = Infinity;
    const goFrom = (at) => { if (at === go) return; go = at; for (const tg of targets) if (!tg.wait) tg.born = go + tg.after; };
    const left = (tg) => tg.stay - (s.t - (tg.wait ? go : tg.born));                   // how long before it slips away
    const done = (tg) => s.open.has(tg.id) || live.hit.includes(tg.id) || live.missed.includes(tg.id);
    const goldAt = () => (live.gold ? live.gold.at : Infinity);
    const up = (tg) => tg.born <= s.t && left(tg) > 0 && !done(tg) && tg.born < goldAt();
    const helpable = (tg) => !own(tg) && left(tg) < BLINK;                               // the partner's, blinking: either of them may save it
    const mayHit = (tg) => own(tg) || helpable(tg);
    const coming = (tg) => !done(tg) && !s.told.has(tg.id) && s.shots.some((sh) => sh.aim === tg.id);   // a shot on its way (either hero's) still counts
    const slipping = (tg) => tg.born <= s.t && left(tg) <= 0 && !done(tg) && !s.told.has(tg.id) && tg.born < goldAt();
    // The golden padlock: half a second after the last one opens it drops in and bounces, then sways from side to side.
    const GOLD = cfg.gold || [96, 120];
    const goldSpot = () => {
      const u = s.t - goldAt() - 0.5, f = clamp(u / 0.7, 0, 1), fall = f < 0.75 ? (f / 0.75) ** 2 : 1 - 0.1 * Math.sin((f - 0.75) / 0.25 * Math.PI);
      return { x: GOLD[0] + Math.sin(Math.max(0, u - 0.7) * 1.3) * 28, y: -30 + (GOLD[1] + 30) * fall };
    };
    const goldUp = () => !!s.gold && s.t >= s.gold.at + 1.2;
    const spotOf = (aim) => (aim === 'gold' ? goldSpot() : { x: tx(targets[aim]), y: targets[aim].y });
    const pickAt = () => (sc.pickup && !live.picked && s.t > 2 ? { x: W + 12 - (((s.t - 2) * 24) % (W + 24)), y: 64 + Math.sin(s.t * 3) * 6 } : null);   // drifts across until it is hit

    // The padlock from the sheet, recoloured once its picture is in: each kid's in their own colour (dark to light, by
    // how light each pixel is), a white one to flash with, and the gold one as it is drawn. A light rim round each,
    // so it stands out on the dark sofa and the pale wall alike.
    const arts = {}, RIM = 3; let sheet = null;
    function lockArt(key) {
      if (arts[key]) return arts[key];
      const sp = K.sprites.prague; if (!sp || !K.has('prague', 'padlock')) return null;
      if (!sheet) { sheet = new Image(); sheet.src = K.asset(`assets/sprites/${sp.file}`); }
      if (!sheet.complete || !sheet.naturalWidth) return null;
      const cw = sp.w + 2 * RIM, ch = sp.h + 2 * RIM, c = document.createElement('canvas'); c.width = cw; c.height = ch;
      const g = c.getContext('2d'), ramp = RAMP[key];
      g.drawImage(sheet, sp.poses.padlock[0] * sp.w, 0, sp.w, sp.h, RIM, RIM, sp.w, sp.h);
      const d = g.getImageData(0, 0, cw, ch), p = d.data, solid = (x, y) => x >= 0 && y >= 0 && x < cw && y < ch && p[(y * cw + x) * 4 + 3] === 255;
      if (ramp) for (let i = 0; i < p.length; i += 4) {
        if (!p[i + 3]) continue;
        const l = (0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]) / 255, hex = ramp[l < 0.25 ? 0 : l < 0.45 ? 1 : l < 0.62 ? 2 : l < 0.78 ? 3 : 4];
        for (let k = 0; k < 3; k++) p[i + k] = parseInt(hex.slice(1 + k * 2, 3 + k * 2), 16);
      }
      const rim = [];
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (!solid(x, y) && [[-2, 0], [2, 0], [0, -2], [0, 2], [-1, -1], [1, -1], [-1, 1], [1, 1]].some(([a, b]) => solid(x + a, y + b))) rim.push((y * cw + x) * 4);
      for (const i of rim) p.set([255, 248, 231, 255], i);
      g.putImageData(d, 0, 0);
      return (arts[key] = c);
    }
    // A padlock with its middle at (x, y), `k` its size; `lift`: how far its shackle has sprung up (on the sheet the
    // shackle is above row 30, the middle at row 36). Placed on the canvas's own pixels, which are half the picture's.
    const half = (v) => Math.round(v * 2) / 2;
    function drawLock(key, x, y, k, lift) {
      const art = lockArt(key), CUT = 30 + RIM, MID = 36 + RIM;
      if (!art) {                                                                          // no picture (yet): a stand-in padlock, in the colour
        const c = RAMP[key] ? RAMP[key][2] : '#E6B340', h = Math.round(k / 0.36 * 8);
        rect(x - h * 0.6, y - h * 1.6 - (lift || 0), h * 1.2, h, '#7A5320'); rect(x - h, y - h * 0.7, h * 2, h * 1.6, '#7A5320'); rect(x - h + 1, y - h * 0.7 + 1, h * 2 - 2, h * 1.6 - 2, c);
        return;
      }
      const x0 = half(x - art.width / 2 * k), top = half(y - MID * k), cut = half(y + (CUT - MID) * k), bottom = half(y + (art.height - MID) * k), w = half(art.width * k), up = Math.round(lift || 0);
      ctx.drawImage(art, 0, 0, art.width, CUT, x0, top - up, w, cut - top);
      ctx.drawImage(art, 0, CUT, art.width, art.height - CUT, x0, cut, w, bottom - cut);
    }
    const disc = (x, y, r, c) => { for (let dy = -r; dy < r; dy++) { const w = Math.round(Math.sqrt(r * r - (dy + 0.5) ** 2)); rect(x - w, y + dy, 2 * w, 1, c); } };
    // Whose padlock it is: the owner's face on it, like a sticker, ringed in their colour.
    const heads = {};
    function badge(w, x, y) {
      const c = K.sprites[w] && K.sprites[w].faces;
      disc(x, y, 6, COLOUR[w]); disc(x, y, 5, '#FFF8E7');
      if (!c) return;
      const img = heads[w] || (heads[w] = Object.assign(new Image(), { src: K.asset(`assets/sprites/${c.file}`) }));
      if (!img.complete || !img.naturalWidth) return;
      const k = 10 / Math.max(c.w, c.h);
      ctx.drawImage(img, 3 * c.w, 0, c.w, c.h, half(x - c.w * k / 2), half(y - c.h * k / 2), half(c.w * k), half(c.h * k));
    }
    // The colour of whoever stands there: a patch of it on the floor round their feet.
    function floor(x, c) {
      [12, 17, 19, 19, 17, 12].forEach((w, i) => rect(x - w, GY - 3 + i, 2 * w, 1, INK));
      [10, 16, 18, 16, 10].forEach((w, i) => rect(x - w, GY - 2 + i, 2 * w, 1, c));
    }
    // Four corners closing in on what a shot is going for, or opening out where a tap found nothing.
    function corners(x, y, rx, ry, c) {
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const cx = Math.round(x + sx * rx), cy = Math.round(y + sy * ry);
        rect(sx < 0 ? cx + 1 : cx - 3, cy + 1, 4, 1, INK); rect(cx + 1, sy < 0 ? cy + 1 : cy - 3, 1, 4, INK);
        rect(sx < 0 ? cx : cx - 4, cy, 4, 1, c); rect(cx, sy < 0 ? cy : cy - 4, 1, 4, c);
      }
    }
    // An arrow pointing down at (x, y): what to tap.
    function arrow(x, y, c) {
      x = Math.round(x); y = Math.round(y);
      rect(x - 3, y - 11, 7, 6, INK); for (let i = 0; i < 5; i++) rect(x - 5 + i, y - 6 + i, 11 - 2 * i, 1, INK);
      rect(x - 2, y - 10, 5, 5, c); for (let i = 0; i < 4; i++) rect(x - 4 + i, y - 6 + i, 9 - 2 * i, 1, c);
    }
    // A burst of sparks from (x, y), from the moment `at`.
    function burst(x, y, c, at = s.t, n = 6) {
      for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2 + 0.4, v = 55 + (k % 3) * 20; s.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 25, at, c: k % 2 ? '#FFD43A' : c }); }
    }
    // A padlock opens: a white flash, its shackle springs up, then it drops, with sparks in the colour of whoever opened it.
    function open(tg, by, delay = 0) {
      s.open.add(tg.id);
      const x = tx(tg), y = tg.y;
      s.drops.push({ x, y, at: s.t + delay, vx: ((tg.id % 3) - 1) * 16, key: ownerOf(tg) });
      burst(x, y, COLOUR[by], s.t + delay);
    }
    const puff = (x, y) => s.pops.push({ x, y, at: s.t, kind: 'dust' });
    // Opened by the partner (their shot landing here, or the room saying so, whichever comes first).
    function theyOpened(tg) {
      open(tg, mate()); if (go === Infinity) goFrom(s.t);
      if (sn.two && own(tg)) say(`${face(mate(), 3, 0.6)} ${heroName(mate())} ti ${mate() === 'kel' ? 'pomohla' : 'pomohl'}!`, 1.6);
    }
    // Opened by one's own shot: the room counts it. Every fifth in a row is cheered; saving the partner's is said so.
    function opened(tg, kind) {
      const x = tx(tg), saved = !own(tg);
      open(tg, who); s.mine++; s.streak++; if (go === Infinity) goFrom(s.t);
      s.pops.push({ x, y: tg.y, at: s.t, kind });
      Net.send({ type: 'ev', e: 'hit', id: tg.id, at: s.t }); beep(780, 1040);                // when: the first one sets the others going
      plus(saved ? 'Zachráněno!' : '+1', clamp(x, saved ? 34 : 12, W - (saved ? 34 : 12)), Math.max(34, tg.y - 12));   // clear of the bar at the top
      if (s.mine === 1 && !saved && s.tipUntil === Infinity) say('', 0);                  // the first advice has done its job
      if (s.streak % 5 === 0) cheer({ 5: 'Pět za sebou!', 10: 'Deset za sebou!', 15: 'Patnáct za sebou!' }[s.streak] || 'Paráda!');
    }
    // One got away: a puff, a heart rising out of it, and the picture jolts.
    function gone(tg) { s.pops.push({ x: tx(tg), y: tg.y, at: s.t, kind: 'gone' }); beep(200, 150); s.streak = 0; s.quake = s.t; }
    // The golden padlock is hit, by this hero or (as this phone sees it) the other one; `at`: when that shot was thrown.
    function goldHit(by, real, at) {
      const p = goldSpot();
      s.gold.hit = s.t; burst(p.x, p.y, COLOUR[by], s.t, 8);
      if (by !== who) { s.gold.mate = Math.max(s.gold.mate, at); return beep(660, 880); }
      s.gold.mine = at; s.gold.n++; beep(880, 1175);
      plus(sn.two ? '+1' : `${s.gold.n}`, clamp(p.x, 12, W - 12), p.y - 22);
      if (real && !s.over) Net.send({ type: 'ev', e: 'gold', at });                          // when it was thrown, by the shared clock: the room checks the two seconds
    }
    // Enough are open: whatever is still up springs open by itself, one after another, and the golden padlock comes.
    function startGold(at) {
      s.gold = { at, mine: -9, mate: -9, hit: -9, n: 0, lift: 0 };
      let k = 0;
      for (const tg of targets) { if (tg.born > s.t) break; if (!done(tg) && !s.told.has(tg.id)) open(tg, ownerOf(tg), 0.1 + 0.08 * k++); }
      cheer('Zlatý zámek!'); beep(523, 659, 784, 1047);
      say(sn.two ? 'Trefte ho oba naráz!' : 'Trefuj! Ještě třikrát.', 0);
    }

    // One shot from `from`: right at a padlock (`aim`: its id, or 'gold'), following it as it sways until it lands
    // on it; or, with nothing near the finger, towards (x, y) and on. Only one's own shots open anything.
    function fire(w, from, x, y, real, star, aim) {
      const dx = x - from.x, dy = y - from.y, back = live.item === 'boomerang', d = Math.hypot(dx, dy) || 1;
      const kind = w === 'ken' ? 'puck' : star ? 'star' : 'bunny';
      if (aim !== null && !back) {                                                        // the bunny goes in an arc, the rest straight
        const T = kind === 'bunny' ? Math.max(0.4, Math.abs(dx) / 170) : Math.max(0.25, d / (kind === 'puck' ? 300 : 260));
        s.shots.push({ kind, real, aim, from, x: from.x, y: from.y, vx: dx, at: s.t, T, arc: kind === 'bunny' ? G * T * T / 2 : 0 });
      } else if (kind !== 'bunny' || back) {                                              // straight and fast; with the boomerang it turns round and comes home
        const v = kind === 'puck' ? 280 : 250;
        s.shots.push({ kind, real, aim: null, from, x: from.x, y: from.y, vx: dx / d * v, vy: dy / d * v, g: 0, r: 12, turn: back ? s.t + Math.max(0.35, d / v + 0.12) : 0 });
      } else { const T = Math.max(0.4, Math.abs(dx) / 170); s.shots.push({ kind, real, aim: null, from, x: from.x, y: from.y, vx: dx / T, vy: (dy - 0.5 * G * T * T) / T, g: G, r: 13 }); }
    }
    function throwAt(x, y, aim) {
      const star = who === 'kel' && s.thrown++ % 2 === 1;                                 // Kellyn takes turns: bunny, star, bunny, star
      fire(who, mine, x, y, true, star, aim);
      Net.send({ type: 'fx', k: 'shot', x, y, star, aim });                               // the other device shows it flying to the same padlock, from where this hero stands there
    }
    // A shot goes the moment the finger lands: it sounds, the hero swings, and corners close in on the padlock.
    function shoot(x, y, aim, cool) {
      throwAt(x, y, aim);
      if (live.item === 'drumstick') s.again = { at: s.t + 0.13, x: x + 7, y: y - 7 };       // the drumstick's second beat, a little to one side
      s.cool = cool; s.swing = 0.25; beep(who === 'ken' ? 330 : 660);
      s.marks.push({ x, y, at: s.t, aim });
    }
    // A tap goes for the nearest padlock this hero may shoot (their own, or the partner's while it blinks), or the
    // golden one. The partner's other padlocks only give a shake: that one is theirs. A tap on nothing throws there.
    // A padlock with a shot already on its way (from either of them) gets the marks again, not a second shot.
    // A tap while the hero is still swinging (`later`) is answered at once, with a tick and the marks on what it went
    // for; its shot goes the moment the swing is over (see update).
    function tap(x, y, later) {
      const wait = (aim) => { s.next = { x, y, aim }; s.marks.push({ x, y, at: s.t, aim }); beep(1320); };
      if (s.gold) {
        const p = goldSpot(), on = goldUp() && Math.hypot(p.x - x, p.y - y) < 28;
        if (later) return wait(on ? 'gold' : null);
        return on ? shoot(p.x, p.y, 'gold', 0.25) : shoot(x, y, null, 0.5);
      }
      const near = (ok) => targets.filter((tg) => tg.born <= s.t && up(tg) && ok(tg)).map((tg) => ({ tg, d: Math.hypot(tx(tg) - x, tg.y - y) })).filter((n) => n.d < REACH).sort((a, b) => a.d - b.d)[0];
      const flying = (tg) => s.shots.some((sh) => sh.aim === tg.id);
      const aim = near((tg) => mayHit(tg) && !flying(tg)), already = !aim && near(mayHit), theirs = !aim && !already && near((tg) => !mayHit(tg));
      if (already) { s.marks.push({ x, y, at: s.t, aim: already.tg.id }); return beep(990); }   // a shot is on its way to that one already
      if (theirs) {
        s.nudge[theirs.tg.id] = s.t; beep(196, 165);
        return say(`${face(mate(), 3, 0.6)} Ten je ${mate() === 'kel' ? 'Kellynin' : 'Kendrickův'}.`, 1.4);
      }
      if (later) return wait(aim ? aim.tg.id : null);
      if (aim) shoot(tx(aim.tg), aim.tg.y, aim.tg.id, 0.25); else shoot(x, y, null, 0.5);
    }
    // An aimed shot arrives: its padlock opens, if it is still there to open.
    function land(sh) {
      sh.dead = true;
      if (sh.aim === 'gold') { if (s.gold && (!s.over || !sh.real)) goldHit(sh.real ? who : mate(), sh.real, sh.at); return; }
      const tg = targets[sh.aim];
      if (done(tg) || s.told.has(tg.id)) return puff(sh.x, sh.y);                          // gone already, or opened
      if (!sh.real) { theyOpened(tg); s.pops.push({ x: sh.x, y: sh.y, at: s.t, kind: sh.kind }); return; }   // the partner's: their phone tells the room
      if (!s.over) opened(tg, sh.kind);
    }
    // Where to look: an arrow over the padlock to shoot next. At the start, after a while without a tap, over one's
    // own padlock while it blinks, then over the partner's while it blinks (now it can be saved), and over the golden one.
    function pointer() {
      if (s.over) return null;
      if (s.gold) return goldUp() && s.t - s.gold.mine > 0.4 ? goldSpot() : null;
      const ups = targets.filter((tg) => tg.born <= s.t && up(tg) && !coming(tg)), soon = (a, b) => left(a) - left(b);
      const hurry = ups.filter((tg) => own(tg) && left(tg) < BLINK).sort(soon)[0];
      if (hurry) return { x: tx(hurry), y: hurry.y };
      const save = ups.filter(helpable).sort(soon)[0];
      if (save) {
        if (!s.helped) { s.helped = true; say(`${face(mate(), 3, 0.6)} Bliká! Pomoz ${mate() === 'kel' ? 'jí' : 'mu'}!`, 1.8); }
        return { x: tx(save), y: save.y };
      }
      if (s.mine > 0 && s.t - s.tapAt < 3) return null;
      const next = ups.filter(own).sort((a, b) => left(a) - left(b))[0];
      return next && s.t - next.born > 0.3 ? { x: tx(next), y: next.y } : null;
    }

    const api = {
      s, kind: 'shoot', spot: (tg) => (tg.id === 'gold' ? goldSpot() : { x: tx(tg), y: tg.y }), pickAt,
      live: () => (s.gold ? (goldUp() && !s.over ? [{ id: 'gold', born: s.gold.at + 1.2 }] : []) : targets.filter((tg) => up(tg) && mayHit(tg))),
      sync(n) {
        live = n;
        for (const id of n.hit.slice(s.seen)) {                                           // opened on the other phone: they open here too
          const tg = targets[id]; if (tg && !s.open.has(id)) theyOpened(tg);
        }
        s.seen = n.hit.length;
        if (n.go !== null && n.go !== undefined) goFrom(n.go);                            // the room's word on when the first one opened
        for (const id of n.missed) if (!s.told.has(id) && targets[id]) { s.told.add(id); gone(targets[id]); }   // the other phone saw it go first
        if (n.gold && !s.gold) startGold(n.gold.at);
        if (s.gold && n.gold && n.gold[mate()] !== undefined && n.gold[mate()] > s.gold.mate) s.gold.mate = n.gold[mate()];
        paint();
        if (live.item && !s.said) { s.said = true; say(esc(WORLD.items[live.item].shot), 2.5); }
      },
      fx(m) {
        if (m.k !== 'shot') return;
        const aim = (m.aim === 'gold' && s.gold) || (Number.isInteger(m.aim) && targets[m.aim]) ? m.aim : null;   // (the golden one may not be here yet)
        fire(mate(), theirs, +m.x || 0, +m.y || 0, false, !!m.star, aim); s.mateSwing = 0.25;
      },
      over(won) {
        s.over = true; s.lost = !won; paint();
        const end = () => view.end(won, won ? 'Trefa!' : `Uteklo ${sn.two ? 'vám' : 'ti'} jich moc.`, won ? 'Cesta je volná.' : `Zkus${sn.two ? 'te' : ''} to ještě jednou.`);
        if (!won) return end();
        if (s.gold) { const p = goldSpot(); s.gold.won = s.t; burst(p.x, p.y, COLOUR.ken, s.t, 8); burst(p.x, p.y, COLOUR.kel, s.t + 0.06, 8); burst(p.x, p.y, '#FFD43A', s.t + 0.12, 10); }
        cheer('Otevřeno!'); say('', 0);
        setTimeout(() => { if (K.scene && K.scene.act === api) end(); }, 1300);         // the golden padlock opens and falls first
      },
      down(x, y) {
        if (s.over || y < 22) return;
        if (s.t < 0) { s.marks.push({ x, y, at: s.t, aim: null }); return beep(196); }            // not yet: 2, 1, Start!
        s.tapAt = s.t;
        tap(x, y, s.cool > 0);
      },
      update(dt) {
        s.t = clock(live); s.cool -= dt; s.swing -= dt; s.mateSwing -= dt;
        if (s.tipUntil < s.t) say('', 0);
        if (!s.over && s.next && s.cool <= 0) {                                           // the swing is over: the tap made during it goes, at the padlock it was meant
          const n = s.next, tg = Number.isInteger(n.aim) && targets[n.aim]; s.next = null;  // for, even one that has only just begun to slip away
          if (tg && !done(tg) && !s.told.has(tg.id) && !coming(tg) && left(tg) > -0.2) shoot(tx(tg), tg.y, tg.id, 0.25); else tap(n.x, n.y);
        }
        if (!s.over && s.again && s.t >= s.again.at) { throwAt(s.again.x, s.again.y, null); s.again = null; }
        const p = pickAt();
        for (const sh of s.shots) {
          if (sh.T) {                                                                       // aimed: it lands on its padlock wherever it has swayed to
            const u = Math.min(1, (s.t - sh.at) / sh.T), q = spotOf(sh.aim);
            sh.x = sh.from.x + (q.x - sh.from.x) * u; sh.y = sh.from.y + (q.y - sh.from.y) * u - sh.arc * u * (1 - u);
            if (u >= 1) land(sh);
            continue;
          }
          sh.x += sh.vx * dt; sh.vy += sh.g * dt; sh.y += sh.vy * dt;
          if (sh.turn && s.t >= sh.turn) { sh.vx = -sh.vx; sh.vy = -sh.vy; sh.turn = 0; sh.home = true; }
          if (sh.home && (sh.vx < 0 ? sh.x <= sh.from.x : sh.x >= sh.from.x)) sh.dead = true;
          if (sh.real && p && !s.asked && Math.hypot(p.x - sh.x, p.y - sh.y) < sh.r + 4) { s.asked = true; beep(660, 880, 1100); Net.send({ type: 'ev', e: 'pick' }); }
          if (sh.real && !s.over && !s.gold) for (const tg of targets) {                    // a shot thrown at nothing may still hit something on its way
            if (tg.born > s.t) break;
            if (!up(tg) || !mayHit(tg) || Math.hypot(tx(tg) - sh.x, tg.y - sh.y) >= sh.r) continue;
            opened(tg, sh.kind);
            if (!sh.turn && !sh.home) sh.dead = true;                                       // a boomerang shot carries on through
            break;
          }
          if (sh.x < -10 || sh.x > W + 10 || sh.y < 10 || sh.y > H + 10) { if (sh.turn) sh.turn = s.t; else sh.dead = true; }
        }
        s.shots = s.shots.filter((sh) => !sh.dead);
        if (!s.over) for (const tg of targets) {                                           // the ones that got away (slipped off, no shot coming): both devices say so, the room counts each once
          if (tg.born > s.t || tg.born >= goldAt()) break;
          if (left(tg) <= -SLIP && !s.told.has(tg.id) && !done(tg) && !coming(tg)) { s.told.add(tg.id); gone(tg); Net.send({ type: 'ev', e: 'miss', id: tg.id }); }
        }
        if (s.gold) {
          const g = s.gold, mineOn = s.t - g.mine < TOGETHER, mateOn = s.t - g.mate < TOGETHER;
          g.lift += ((sn.two ? 3 * (mineOn + mateOn) : 2 * Math.min(3, g.n)) - g.lift) * Math.min(1, dt * 14);   // each hit lifts the shackle a little
          if (goldUp() && !s.over) {                                                         // the one who has hit it keeps going, so the other's hit is sure to count
            if (sn.two) say(mineOn && !mateOn ? 'Trefuj dál!' : mateOn && !mineOn ? 'Rychle, teď ty!' : 'Trefte ho oba naráz!', 0);
            else say(['Trefuj! Ještě třikrát.', 'Ještě dvakrát!', 'Ještě jednou!', ''][Math.min(3, g.n)], 0);
          }
        }
        s.pops = s.pops.filter((q) => s.t - q.at < (q.kind === 'gone' || q.kind === 'dust' ? 0.7 : 0.15));
        s.drops = s.drops.filter((d) => s.t - d.at < 1);
        s.sparks = s.sparks.filter((k) => s.t - k.at < 0.45);
        s.marks = s.marks.filter((m) => s.t - m.at < 0.25 || (m.aim !== null && s.shots.some((sh) => sh.real && sh.aim === m.aim)));
        paint();
      },
      draw() {
        const jolt = s.t - s.quake < 0.25 ? (Math.floor(s.t * 30) % 2 ? 1 : -1) : 0;      // a padlock got away: the picture jolts
        if (jolt) rect(0, 0, W, H, INK);
        ctx.save(); ctx.translate(jolt, 0);
        K.background(sc.bg, 0, place.look);
        floor(BODY, COLOUR[who]); if (mateHere()) floor(W - BODY, COLOUR[mate()]);
        for (const tg of targets) {
          if (tg.born > s.t) break;
          const away = coming(tg) ? 0 : up(tg) ? -1 : slipping(tg) ? clamp(-left(tg) / SLIP, 0, 1) : -2;
          if (away < -1) continue;
          const pop = clamp((s.t - tg.born) / 0.3, 0, 1), hurry = left(tg) < BLINK, n = s.nudge[tg.id], u = n === undefined ? 1 : s.t - n, a = Math.max(0, away) ** 2;
          // it pops into place; blinks white and rattles before it slips away; shakes when it is the partner's to shoot;
          // out of time, it slips off upwards, shrinking (easing in, so a shot arriving just then still finds it in place)
          const x = Math.round(tx(tg)) + (u < 0.35 ? Math.round(Math.sin(u * 45) * 2) : 0) + (hurry ? (Math.floor(s.t * 16) % 2 ? 1 : -1) : 0), y = Math.round(tg.y - 14 * a);
          drawLock(hurry && Math.floor(s.t * 8) % 2 ? 'white' : ownerOf(tg), x, y, 0.36 * outBack(pop) * (1 - 0.5 * a), 0);
          if (sn.two && pop >= 0.7 && a < 0.3) badge(ownerOf(tg), x + 7, y + 8);
        }
        for (const d of s.drops) {                                                          // opening: flash, the shackle springs up, then down it goes
          const u = s.t - d.at, f = Math.max(0, u - 0.3);
          if (u > 0.85 && Math.floor(u * 20) % 2) continue;
          drawLock(u >= 0 && u < 0.08 ? 'white' : d.key, d.x + d.vx * f, d.y - 30 * f + 320 * f * f, u >= 0 && u < 0.08 ? 0.4 : 0.36, u < 0.08 ? 0 : 5 * outBack(clamp((u - 0.08) / 0.2, 0, 1)));
        }
        if (s.gold && s.t >= s.gold.at + 0.5) {
          const g = s.gold, p = goldSpot(), u = s.t - g.hit, w = g.won === undefined ? -1 : s.t - g.won, f = Math.max(0, w - 0.45);
          const x = Math.round(p.x) + (u < 0.3 ? Math.round(Math.sin(u * 50) * 2 * (1 - u / 0.3)) : 0), y = Math.round(p.y) + (w >= 0 ? Math.round(-20 * f + 320 * f * f) : 0);
          for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2 + s.t * 1.5, r = 22 + Math.sin(s.t * 4 + k) * 2; if (w < 0 && Math.sin(s.t * 7 + k * 2) > 0) rect(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r), 2, 2, k % 2 ? '#FFF1A8' : '#FFD43A'); }
          drawLock(u < 0.08 ? 'white' : 'gold', x, y, 0.62, w >= 0 ? 9 * outBack(clamp(w / 0.3, 0, 1)) : g.lift);
          if (w < 0 && s.t >= g.at + 1.2) {                                                // under it: who has hit it in the last two seconds (with two), or how many hits so far
            if (sn.two) [who, mate()].forEach((h, i) => {                                   // this hero's on the left, as they stand
              const bx = x - 10 + i * 20, by = y + 28, v = (s.t - (h === who ? g.mine : g.mate)) / TOGETHER;
              badge(h, bx, by);
              rect(bx - 6, by + 8, 12, 3, INK); if (v < 1) rect(bx - 5, by + 9, Math.ceil(10 * (1 - v)), 1, COLOUR[h]);
            });
            else for (let i = 0; i < 3; i++) { rect(x - 13 + i * 9, y + 24, 8, 8, INK); rect(x - 12 + i * 9, y + 25, 6, 6, i < g.n ? '#FFD43A' : '#7A6F6A'); }
          }
        }
        const pk = pickAt(); if (pk) item(sc.pickup, pk.x, pk.y);
        if (live.item) item(live.item, 12, 34);                                             // what they are holding, up in the corner
        // wound up and ready; swinging through for a moment after each shot. Kellyn's hand stays empty while her bunny is in the air.
        const won = s.over && !s.lost, pose = (w, swing, real) => (won ? 'cheer' : swing > 0 || (w === 'kel' && s.shots.some((sh) => sh.kind === 'bunny' && sh.real === real)) ? 'shoot' : 'aim');
        if (mateHere()) K.hero(mate(), W - BODY, GY, s.lost ? 'dizzy' : pose(mate(), s.mateSwing, false), s.t, true);
        K.hero(who, BODY, GY, s.lost ? 'dizzy' : pose(who, s.swing, true), s.t);
        for (const sh of s.shots) {
          const x = Math.round(sh.x), y = Math.round(sh.y);
          if (sh.kind === 'puck') { if (K.has('things', 'puckfly')) K.figure('things', x, y + 4, 'puckfly', 0, sh.vx < 0, 0.45); else { rect(x - 4, y - 2, 8, 4, INK); rect(x - 3, y - 2, 6, 1, '#7A6F6A'); } }
          else if (sh.kind === 'star' && K.sprites.star) K.prop(K.sprites.star, x, y + 4, Math.floor(s.t * 10) % 2);
          else if (K.has('things', 'bunnyfly')) K.figure('things', x, y + 8, Math.floor(s.t * 6) % 2 ? 'bunnyflip' : 'bunnyfly', 0, sh.vx < 0, 0.5);   // the bunny tumbles as it flies
          else if (K.sprites.bunny) K.prop(K.sprites.bunny, x, y + 11, Math.floor(s.t * 6) % 2);
          else { rect(x - 5, y - 4, 10, 8, '#D9CFC6'); rect(x - 4, y - 3, 8, 6, '#FFFDF8'); }
        }
        for (const k of s.sparks) {
          const u = s.t - k.at; if (u < 0) continue;
          const sz = u < 0.35 ? 2 : 1;
          rect(Math.round(k.x + k.vx * u * (1 - u)), Math.round(k.y + k.vy * u + 160 * u * u), sz, sz, k.c);
        }
        for (const q of s.pops) {
          const x = Math.round(q.x), y = Math.round(q.y), u = (s.t - q.at) / 0.7;
          if (q.kind === 'gone' || q.kind === 'dust') {                                       // a puff; one that got away leaves a heart rising out of it
            for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2, r = 4 + u * 10; rect(Math.round(x + Math.cos(a) * r) - 2, Math.round(y + Math.sin(a) * r) - 2, q.kind === 'gone' ? 4 : 3, q.kind === 'gone' ? 4 : 3, 'rgba(232,220,196,' + (1 - u).toFixed(2) + ')'); }
            if (q.kind === 'gone') { const hy = Math.round(y - 8 - u * 16); rect(x - 4, hy, 3, 3, '#CC2233'); rect(x + 1, hy, 3, 3, '#CC2233'); rect(x - 3, hy + 2, 6, 3, '#CC2233'); rect(x - 1, hy + 5, 2, 2, '#CC2233'); }
            continue;
          }
          const pose = q.kind === 'bunny' ? 'fluff' : 'flash';                              // the moment of the hit
          if (K.has('things', pose)) K.figure('things', x, y + 7, pose, 0, false, 0.45);
          else { rect(x - 9, y - 1, 18, 2, '#FFD43A'); rect(x - 1, y - 9, 2, 18, '#FFD43A'); rect(x - 4, y - 4, 8, 8, '#FFF8E7'); }
        }
        for (const m of s.marks) {                                                          // where each tap went
          const u = s.t - m.at;
          if (m.aim === null) { if (u < 0.25) { const r = 3 + u * 24; corners(m.x, m.y, r, r, COLOUR[who]); } continue; }
          const q = spotOf(m.aim), r = (m.aim === 'gold' ? 18 : 12) - 3 * outBack(clamp(u / 0.15, 0, 1));
          corners(q.x, q.y, r, r * 1.3, COLOUR[who]);
        }
        const next = pointer();
        if (next) arrow(next.x, next.y - (s.gold ? 30 : 13) - Math.round(Math.abs(Math.sin(s.t * 6)) * 3), COLOUR[who]);
        ctx.restore();
      },
    };
    return api;
  }

  // The echo: Alan plays a rhythm on four drums, then it has to be played back in the same order, Simon-style: every
  // round the same rhythm with one stroke more (see teach in room.js). With two playing, each has two of the drums
  // (Kendrick the left pair, Kellyn the right) and they take turns; whose turn it is shows in their colour, round
  // their drums, on the dots and over their head. Every drum looks, sounds and is coloured its own way. A tap sounds,
  // lights up and is judged on this phone at once; the room only confirms it. Waiting long on a stroke lights its
  // drum up as a hint, on the partner's phone sooner, so one can tell the other (a hint costs the third star).
  // A slip plays the rhythm again: the first in a round is free, every further one costs a life.
  function Echo(sc, place, sn) {
    const cfg = sc.echo, who = me(), PW = W / 4, TOP = 230, PH = 50, BAND = 210, DOT = 213, max = sn.lives;
    const PADS = [{ c: '#D8343F', dark: '#8E1F28', snd: 'kick', art: 'bassdrum' }, { c: '#F2B82A', dark: '#A8741A', snd: 'tom' },
      { c: '#2FA35E', dark: '#1B6B3C', snd: 'snare', art: 'snare' }, { c: '#8A5BD6', dark: '#56368F', snd: 'cymbal', art: 'cymbal' }];
    const OWN = { ken: '#58A6FF', kel: '#FF6FB5' };                                       // each one's colour: their turn, their dots
    // The tom has no picture on the sheet: a floor tom drawn here, pixel by pixel, in the style of the snare.
    const TOM = (() => {
      const rows = ['.....kkkkkkkkkkkkkk.....', '...kkHHHHHHHHHHHHHHkk...', '..kHHHHHHHHHHHHHHHHHHk..', '.kCHHHHHHHHHHHHHHHHHHCk.', '.kCChHHHHHHHHHHHHHHhCCk.',
        '.kcCCChhhhhhhhhhhhCCCck.', '.kLBBcCCCCCCCCCCCCcBBDk.', '.kLBBcBBBBBBBBBBBBcBBDk.', '.kLLBCBBBBBBBBBBBBCBDDk.', '.kLLBcBBBBBBBBBBBBcBDDk.',
        '.kLLBBBBBBBBBBBBBBBBDDk.', '.kLLBBBBBBBBBBBBBBBBDDk.', '.kLLBBBBBBBBBBBBBBBBDDk.', '.kLLBcBBBBBBBBBBBBcBDDk.', '.kLLBCBBBBBBBBBBBBCBDDk.',
        '.kLBBcBBBBBBBBBBBBcBBDk.', '.kcCCCCCCCCCCCCCCCCCCck.', '..kcccccccccccccccccck..', '...kkkkkkkkkkkkkkkkkk...', '...kg..............gk...',
        '..kg................gk..', '..kg................gk..', '.kg..................gk.', '.kk..................kk.'];
      const pal = { k: INK, H: '#F7E1C1', h: '#E2C49E', C: '#DDE2E8', c: '#7E8794', B: '#2F5FC0', L: '#5E8BE0', D: '#1F3F86', g: '#9AA1AB' };
      const c = document.createElement('canvas'), g = c.getContext('2d'); c.width = rows[0].length; c.height = rows.length;
      rows.forEach((r, j) => [...r].forEach((ch, i) => { if (pal[ch]) { g.fillStyle = pal[ch]; g.fillRect(i, j, 1, 1); } }));
      return c;
    })();
    const s = { t: 0, over: false, lost: false, hit: [-9, -9, -9, -9], no: [-9, -9, -9, -9], bad: -9, badPad: -1, badDot: -1, sent: new Map(), block: false,
      shownAt: 0, sounded: -1, cued: sn.listenAt <= Net.now() ? sn.listenAt : 0, seen: sn.n, round: sn.round, joy: -9, alan: -9, myHit: -9, mateHit: -9,
      wave: -9, spark: null, tapAt: 0, say: null, help: null, party: 0, fill: -1, endIn: 0, parts: [], notes: [] };
    let live = sn, shownLives = -1, shownTip = null;
    const view = stage('<span class="lives"></span><span class="meter"><i></i></span>', '');
    view.tip.classList.add('up');
    const padOwner = (p) => (!mateHere() ? who : p < 2 ? 'ken' : 'kel');               // alone, all four are yours
    const mine = (p) => padOwner(p) === who;
    const owner = (i) => padOwner(live.pattern[i]);
    const listening = () => Net.now() < live.listenAt;
    const done = (i) => live.got.includes(i) || s.sent.has(i);                          // confirmed by the room, or just played here
    const nextUp = () => live.pattern.findIndex((p, i) => !done(i));
    const myNext = () => live.pattern.findIndex((p, i) => !done(i) && owner(i) === who);
    // How long a stroke waits before its drum lights up as a hint: as the room counts it for whoever plays it, and
    // half that on the other one's phone, so the older can tell the younger first. After one of them slipped, the
    // other sees their drums at once while the rhythm is tried again, to talk them through it; so does Kellyn, the
    // younger, on her own phone after her own slip, so a hasty tap does not go wrong again and again.
    const retry = (o) => s.help && s.help.who === o && s.help.attempt === live.attempt;
    const hintIn = (i) => {
      const o = owner(i);
      if (retry(o) && (o !== who || o === 'kel')) return 0;
      return (live.round ? cfg.hint[o] : cfg.hint.first) * (o === who ? 1000 : 500);
    };
    const hinted = (i) => i >= 0 && !listening() && !s.block && Net.now() - Math.max(live.since, live.listenAt, s.tapAt) > hintIn(i);
    const say = (text, secs) => { s.say = { text, until: s.t + (secs || 1.4) }; paint(); };   // a short tip that goes away by itself
    const tipText = () => {
      if (s.over) return '';
      if (s.say && s.t < s.say.until) return s.say.text;
      if (listening()) return Net.now() >= live.showAt ? 'Poslouchej…' : live.round === live.rounds - 1 ? 'Poslední kolo!' : '';
      const i = nextUp();
      if (i < 0 || owner(i) === who) return '';                                         // your turn: the drums show it
      return hinted(i) ? (owner(i) === 'kel' ? 'Pomoz jí!' : 'Pomoz mu!') : `Teď hraje ${heroName(owner(i))}`;
    };
    const paint = () => {
      if (live.lives !== shownLives) {
        const lost = shownLives > live.lives, el = view.hud.firstElementChild;
        shownLives = live.lives; hearts(el, live.lives, max);
        if (lost && el.children[live.lives]) el.children[live.lives].classList.add('gone');   // the heart just lost blinks out
      }
      const n = live.pattern.length, got = live.pattern.filter((p, i) => done(i)).length;
      view.hud.lastElementChild.firstElementChild.style.width = clamp((live.round + got / n) / live.rounds, 0, 1) * 100 + '%';
      const tip = tipText(); if (tip !== shownTip) view.tip.textContent = shownTip = tip;
    };
    // A drum struck, by anyone: it dips and bounces back up, flashes, throws a few sparks and a note, and sounds.
    const strike = (p) => {
      s.hit[p] = s.t; drum(PADS[p].snd);
      const cx = p * PW + PW / 2;
      for (let k = 0; k < 6; k++) s.parts.push({ x: cx, y: TOP + 8, vx: (Math.random() - 0.5) * 90, vy: -50 - Math.random() * 70, g: 260, life: 0.45, c: [PADS[p].c, '#FFF8E7', '#FFD43A'][k % 3] });
      s.notes.push({ x: cx + 9, y: TOP + 6, t: s.t });
    };
    const unshout = () => K.ui.querySelectorAll('.praise').forEach((e) => e.remove());
    const shout = (text) => { unshout(); cheer(text); };                                  // big words never pile up on each other
    const slip = (p, i) => { unshout(); s.bad = s.t; s.badPad = p; s.badDot = i; beep(150, 110); say('Vedle! Poslouchej znovu.', 1.6); };
    const refuse = (p, text) => { s.no[p] = s.t; beep(140); say(text, 1.2); };          // not now: a shake and why, never nothing
    const finish = () => {
      const won = !s.lost, two = mateHere();
      view.end(won, won ? 'Sedí to!' : two ? 'Rozhodilo vás to.' : 'Rozhodilo tě to.', won ? (two ? 'Rytmus máte v ruce.' : 'Rytmus máš v ruce.') : two ? 'Zkuste to ještě jednou.' : 'Zkus to ještě jednou.');
    };
    // An arrow pointing down, its tip at (x, y): a little one over whose turn it is, a big one on the drum to strike.
    const ARROW = [[-1, 3], [-1, 3], [-1, 3], [-4, 9], [-3, 7], [-2, 5], [-1, 3], [0, 1]];
    const BIG = [[-2, 5], [-2, 5], [-2, 5], [-6, 13], [-5, 11], [-4, 9], [-3, 7], [-2, 5], [-1, 3], [0, 1]];
    const arrow = (x, y, c, rows = ARROW) => {
      x = Math.round(x); y = Math.round(y) - rows.length;
      rows.forEach(([l, w], j) => rect(x + l - 1, y + j - 1, w + 2, 3, INK));
      rows.forEach(([l, w], j) => rect(x + l, y + j, w, 1, c));
    };
    const art = (p, cx, foot, a) => {
      if (p === 1) return ctx.drawImage(TOM, Math.round(cx) - TOM.width / 2, Math.round(foot) - TOM.height);
      const shiver = p === 3 && a >= 0 && a < 0.4 ? (Math.floor(a * 30) % 2 ? -1 : 1) : 0;    // a cymbal shivers when struck
      if (K.has('strahov', PADS[p].art)) K.figure('strahov', cx, foot + shiver, PADS[p].art, 0, false, 0.5);
    };
    paint();
    return {
      s, kind: 'echo',
      peek: () => ({ pattern: live.pattern, step: live.step, round: live.round, attempt: live.attempt, listening: listening(), mine: [0, 1, 2, 3].filter(mine),
        next: myNext(), myTurn: !s.block && myNext() >= 0 && nextUp() === myNext(), hint: hinted(nextUp()), block: s.block }),
      sync(n) {
        if (n.attempt !== live.attempt) { s.sent.clear(); s.block = false; s.tapAt = 0; }      // the rhythm is played again, or a longer one
        if (n.last && n.last.n !== s.seen) {
          const L = n.last; s.seen = L.n;
          if (!L.ok) s.help = { who: L.who, attempt: n.attempt };                              // the rhythm is tried again: see hintIn
          if (L.who !== who) { strike(L.p); s.mateHit = s.t; if (!L.ok) slip(L.p, L.i); }     // the other one's stroke: shown and heard here too
          else if (!L.ok && s.t - s.bad > 1) slip(L.p, L.i);                                   // ours, and a slip after all
        }
        if (n.round > s.round) {                                                              // a whole rhythm played back
          s.round = n.round;
          if (n.phase === 'play') { s.joy = s.t; shout(['Správně!', 'Výborně!', 'Paráda!'][n.round % 3]); beep(660, 880); say(n.round === n.rounds - 1 ? 'Poslední kolo!' : 'O úder víc!', 1.6); }
        }
        live = n; paint();
      },
      over(won) {
        s.over = true; s.lost = !won; paint();
        if (won) { s.party = s.t; s.endIn = 1.7; shout('Bravo!'); } else s.endIn = 0.9;     // a moment to see it, then the card
      },
      down(x, y) {
        if (s.over) return;
        if (y < BAND) {                                                                   // the drums in the picture are only a picture
          if (listening()) return say('Nejdřív poslouchej!');
          s.wave = s.t; beep(300); return say('Bubny jsou dole!');
        }
        const p = clamp(Math.floor(x / PW), 0, 3);
        if (listening() || s.block) return refuse(p, 'Nejdřív poslouchej!');
        if (!mine(p)) return refuse(p, `Ten má ${heroName(padOwner(p))}`);
        const i = myNext();
        if (i < 0 || nextUp() !== i) return refuse(p, nextUp() >= 0 && mateHere() ? `Teď hraje ${heroName(mate())}` : 'Počkej chvilku');   // all played: the room is about to answer
        strike(p); s.myHit = s.t;
        Net.send({ type: 'ev', e: 'pad', p, i, a: live.attempt, at: Net.now() });           // which stroke it is meant for, so the order it arrives in does not matter
        if (p === live.pattern[i]) { s.sent.set(i, s.t); s.tapAt = Net.now(); }
        else { s.block = true; slip(p, i); }
      },
      update(dt) {
        s.t += dt;
        for (const q of s.parts) { q.vy += q.g * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt; }
        s.parts = s.parts.filter((q) => q.life > 0); s.notes = s.notes.filter((q) => s.t - q.t < 0.7);
        for (const [i, at] of s.sent) if (!live.got.includes(i) && s.t - at > 2.5) s.sent.delete(i);   // lost on the way: it may be played again
        if (s.block && s.t - s.bad > 3) s.block = false;
        if (s.party) {                                                                    // won: a little drum fill and confetti
          const u = s.t - s.party, k = Math.floor(u / 0.13);
          if (k > s.fill && k < 6) { s.fill = k; strike([0, 1, 2, 1, 2, 3][k]); }
          if (u < 1.3) for (let j = 0; j < 2; j++) s.parts.push({ x: Math.random() * W, y: 24, vx: (Math.random() - 0.5) * 30, vy: 20 + Math.random() * 40, g: 30, life: 1.8, c: PADS[j + Math.floor(Math.random() * 3)].c });
        }
        if (s.endIn > 0 && (s.endIn -= dt) <= 0) finish();
        if (s.over) return;
        // Alan's showing: each stroke lights its drum and sounds, on the room's clock, so both phones show it together
        if (live.showAt !== s.shownAt) { s.shownAt = live.showAt; s.sounded = -1; }
        const k = Math.floor((Net.now() - live.showAt) / (live.beat * 1000));
        if (k > s.sounded && k >= 0 && k < live.pattern.length) {
          s.sounded = k; strike(live.pattern[k]); s.alan = s.t;
          if (live.round && k === live.pattern.length - 1) s.spark = { p: live.pattern[k], t: s.t };   // the stroke that is new this round
        }
        if (s.cued !== live.listenAt && !listening()) { s.cued = live.listenAt; s.wave = s.t; shout(mateHere() ? 'Teď vy!' : 'Teď ty!'); beep(523, 784); }
        paint();
      },
      draw() {
        K.background(sc.bg, 0, place.look);
        const two = mateHere(), up = s.over ? -1 : nextUp(), turn = up >= 0 && !listening() && !s.block ? owner(up) : null, hint = turn && hinted(up) ? live.pattern[up] : -1;
        // Alan crouches over his drum while he shows the rhythm, dipping on every stroke; watches them; jumps for joy
        const joyAt = s.party || (s.t - s.joy < 0.9 ? s.joy : 0), hop = joyAt ? -Math.round(Math.abs(Math.sin((s.t - joyAt) * 7)) * 5) : 0;
        const showing = listening() && Net.now() > live.showAt - 500;
        (sc.cast || []).forEach((id, k) => K.figure(id, W / 2 + k * 26, 206 + hop + (s.t - s.alan < 0.1 ? 2 : 0), joyAt ? 'joy' : showing ? 'act' : 'three', s.t));
        // each hero above their own drums (Kendrick left, Kellyn right), the stick coming down as they strike
        const side = (w) => (!two || w === 'ken' ? -1 : 1);
        for (const w of two ? [mate(), who] : [who]) {
          const x = W / 2 + side(w) * 46, struck = s.t - (w === who ? s.myHit : s.mateHit) < 0.15;
          K.hero(w, x, 208 + (struck ? 1 : 0) + (s.party ? hop : 0), s.lost ? 'dizzy' : s.party ? 'cheer' : 'drum', struck ? 1 / 9 : 0, side(w) > 0);
          if (turn === w && !s.over) arrow(x, 152 + Math.round(Math.sin(s.t * 6) * 2), OWN[w]);   // whose turn it is
        }
        rect(0, BAND, W, H - BAND, 'rgba(43,31,26,.6)');
        // The dots: one per stroke, ringed in the colour of whoever plays it. They light up in the drum's colour as
        // Alan plays and again as it is played back; the next one blinks; a slip flashes on its dot.
        const n = live.pattern.length, x0 = Math.round(W / 2 - (n * 9 - 3) / 2);
        if (live.round === live.rounds - 1 && !s.over) {                                    // the last round: the dots in a golden frame
          const fx = x0 - 4, fw = n * 9 + 5;
          rect(fx, DOT - 4, fw, 1, '#FFD43A'); rect(fx, DOT + 9, fw, 1, '#FFD43A'); rect(fx, DOT - 4, 1, 14, '#FFD43A'); rect(fx + fw - 1, DOT - 4, 1, 14, '#FFD43A');
        }
        for (let k = 0; k < n; k++) {
          const x = x0 + k * 9, ring = OWN[owner(k)], next = k === up && turn, big = next && Math.sin(s.t * 8) > 0 ? 1 : 0;
          const lit = listening() ? s.shownAt === live.showAt && k <= s.sounded : done(k), wrong = k === s.badDot && s.t - s.bad < 0.9;
          const fresh = live.round && k === n - 1 ? s.t - s.joy : 9;                        // the new stroke's dot pops in after a moment, twinkling
          if (fresh < 0.3) continue;
          if (fresh < 1.1) for (let j = 0; j < 4; j++) { const an = j * Math.PI / 2 + fresh * 5; rect(Math.round(x + 2 + Math.cos(an) * 7), Math.round(DOT + 2 + Math.sin(an) * 7), 2, 2, j % 2 ? '#FFF1A8' : '#FFD43A'); }
          rect(x - 1 - big, DOT - 1 - big, 8 + 2 * big, 8 + 2 * big, INK);
          rect(x - big, DOT - big, 6 + 2 * big, 6 + 2 * big, ring);
          rect(x + 1, DOT + 1, 4, 4, wrong ? (Math.floor(s.t * 10) % 2 ? '#CC2233' : '#FFF8E7') : lit ? PADS[live.pattern[k]].c : next ? ring : '#3A2C26');
        }
        for (let p = 0; p < 4; p++) {
          const o = padOwner(p), a = s.t - s.hit[p], x0 = p * PW + 2, w = PW - 4;
          const shake = s.t - s.no[p] < 0.3 || (p === s.badPad && s.t - s.bad < 0.5) ? Math.round(Math.sin(s.t * 70) * 2) : 0;
          // struck: down for a moment, then up a little past where it was and back; "your turn": a ripple along the drums
          const press = a >= 0 && a < 0.07 ? 2 : 0, pop = a >= 0.07 && a < 0.37 ? Math.round(3 * Math.sin((a - 0.07) / 0.3 * Math.PI)) : 0;
          const wv = s.t - s.wave - p * 0.07, lift = wv >= 0 && wv < 0.28 ? Math.round(3 * Math.sin(wv / 0.28 * Math.PI)) : 0;
          const beckon = hint === p ? Math.max(0, Math.sin(s.t * 7)) : 0;                     // the hinted drum hops and glows, as if it called
          const x = x0 + shake, y = TOP + press - pop - lift - Math.round(beckon * 3), h = PH - press;
          rect(x0, TOP + 3, w, PH - 3, 'rgba(43,31,26,.7)');                                 // its shadow
          rect(x, y, w, h, INK);
          rect(x + 2, y + 2, w - 4, h - 4, PADS[p].dark);                                      // the front edge
          rect(x + 2, y + 2, w - 4, h - 9, PADS[p].c);                                         // the top
          rect(x + 3, y + 3, w - 6, 1, 'rgba(255,248,231,.45)');
          if (hint === p) rect(x + 2, y + 2, w - 4, h - 9, `rgba(255,248,231,${(0.12 + 0.3 * beckon).toFixed(2)})`);
          art(p, x + w / 2, y + h - 10, a);
          if (!mine(p)) rect(x + 2, y + 2, w - 4, h - 4, 'rgba(43,31,26,.5)');                 // the other one's drums are dimmed
          if (a >= 0 && a < 0.3) rect(x + 2, y + 2, w - 4, h - 4, `rgba(255,248,231,${(0.75 * (1 - a / 0.3)).toFixed(2)})`);
          if (p === s.badPad && s.t - s.bad < 0.6) rect(x + 2, y + 2, w - 4, h - 4, 'rgba(204,34,51,.55)');
          const ring = (k, c) => { rect(x - k, y - k, w + 2 * k, k, c); rect(x - k, y + h, w + 2 * k, k, c); rect(x - k, y, k, h, c); rect(x + w, y, k, h, c); };
          if (turn === o && hint !== p) ring(Math.sin(s.t * 6) > 0 ? 2 : 1, OWN[o]);            // whose turn: their drums ringed in their colour, pulsing
          if (hint === p) {                                                                    // taking long: the drum to strike, with a big arrow on it
            ring(3, OWN[o]);
            arrow(x + w / 2, y + 11 + Math.round(beckon * 2), OWN[o], BIG);
          }
          if (s.spark && s.spark.p === p && s.t - s.spark.t < 0.8) {                           // sparkles round the drum that is new this round
            const u = s.t - s.spark.t;
            for (let j = 0; j < 6; j++) { const an = j / 6 * Math.PI * 2 + u * 4, r = 16 + u * 12; rect(Math.round(x + w / 2 + Math.cos(an) * r) - 1, Math.round(y + h / 2 + Math.sin(an) * r * 0.8) - 1, 2, 2, j % 2 ? '#FFF1A8' : '#FFD43A'); }
          }
        }
        for (const q of s.parts) rect(q.x, q.y, 2, 2, q.c);
        if (K.has('strahov', 'note')) for (const q of s.notes) {
          const u = s.t - q.t; ctx.globalAlpha = Math.max(0, 1 - u / 0.7);
          K.figure('strahov', q.x, q.y - Math.round(u * 26), 'note', 0, false, 0.3); ctx.globalAlpha = 1;
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
  const POINTER = ['....XXXXXXXX..', '....XCCCCCCX..', '...XSSSSSSSX..', '...XSSSSSSSSX.', '..XSSSSSSSSSX.', '..XSSSSSSSSSSX', '.XSSSSSSSSSSSX',
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
      POINTER.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] !== '.') rect(x0 + i + 1, y0 + j + 2, 1, 1, 'rgba(43,31,26,.45)'); });   // its shadow on the card stays put
      POINTER.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] !== '.') rect(x0 + i, y0 + j - tap, 1, 1, row[i] === 'X' ? INK : row[i] === 'C' ? cuff : '#F6D2B0'); });
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

  // Moving in (Byt). The flat is seen like a dollhouse: the bedroom above, the living room below. What was found on the
  // kerb waits in a heap on a moving blanket along the bottom. Take a piece and it hops up above the finger and grows to
  // its real size; its place lights up (a faint dashed silhouette of it, with an arrow over it), and near it the piece
  // is drawn in: let go and it drops into place with a thud and a puff of dust. Let go anywhere else and it slides back
  // to the heap. A tap turns a piece round: the bed and the plant must face the way their silhouettes do (left at their
  // place the wrong way round, they wait there for a tap). The rug goes down first, for the sofa and the table to stand
  // on. All the while the sun goes down in the windows and the rooms grow dim; the lamp, once it stands, lights the
  // living room. Everything in before night: the lights come on, and Sami and Žofia come in.
  // With two, both drag at once, each on their own phone. A piece one of them holds has their colour on both phones and
  // the other cannot take it; where it is being dragged is sent over a few times a second. The room says what counts.
  // Nobody keeps a piece for long: held still for 8 s (a resting finger), or with two for 20 s, it trembles and goes home.
  const FLAT = {
    COL: { ken: '#3E7BD6', kel: '#F0448F' },                                                   // Kendrick blue, Kellyn pink
    look: (k, placed) => (k === 'rugroll' ? (placed ? ['kerb', 'rug'] : ['furniture', 'rugroll']) : k === 'bed' ? ['kerb', 'bed'] : ['furniture', k]),
    size(k, placed) { const [a, b] = FLAT.look(k, placed), sp = K.sprites[a]; return (sp && sp.sizes && sp.sizes[b]) || [60, 60]; },
    // a piece with its feet at (x, y): f < 0 turns it round, sx and sy squash it (a thud, a turn half done)
    draw(k, placed, x, y, size, f, sx = 1, sy = 1) {
      const [sheet, pose] = FLAT.look(k, placed); if (!K.has(sheet, pose)) return;
      ctx.save(); ctx.translate(Math.round(x), Math.round(y)); ctx.scale((f < 0 ? -1 : 1) * sx, sy); K.figure(sheet, 0, 0, pose, 0, false, size); ctx.restore();
    },
    order: (a, b) => (b.k === 'rugroll') - (a.k === 'rugroll') || a.y - b.y,
    // everything in its place, as the flat stands once they have moved in (the rug first, then from the back forward)
    furnish(sc) {
      Room.course.flat(1, sc).pieces.sort(FLAT.order).forEach((p) => FLAT.draw(p.k, true, p.x, p.y, p.size, p.face || 1));
    },
  };
  // Little pictures drawn pixel by pixel: '#' ink, 'o' the fill colour.
  function bits(rows, x, y, fill) {
    rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] !== '.') rect(Math.round(x) + i, Math.round(y) + j, 1, 1, row[i] === '#' ? INK : fill); });
  }
  const HAND = ['...##.......', '..#oo#......', '..#oo#......', '..#oo####...', '..#oo#oo####', '###oooooo#o#', '#o#oooooooo#', '#ooooooooo#.', '.#oooooooo#.', '..#ooooooo#.', '...#######..'];
  const TURN = ['#############', '#ooo#ooooooo#', '#oo##ooooooo#', '#o#########o#', '#oo##ooooooo#', '#ooo#ooooooo#', '#ooooooo#ooo#', '#ooooooo##oo#', '#o#########o#', '#ooooooo##oo#', '#ooooooo#ooo#', '#############'];
  const DOWN = ['#########', '#ooooooo#', '.#ooooo#.', '..#ooo#..', '...#o#...', '....#....'];

  function Flat(sc, place, sn) {
    const who = me(), L = Room.course.flat(sn.seed, sc), P = L.pieces, N = P.length, COL = FLAT.COL;
    const SNAP = 18, CARRY = 6, ROOMS = 142;                     // SNAP: how near its place a piece drops in; CARRY: the finger holds it this far above its feet
    const PANES = [[141, 16, 188, 100], [4, 148, 49, 226]];       // the window panes: the bedroom's on the right, the living room's on the left
    const LAMP = P.findIndex((p) => p.k === 'lamp');
    const NAME = { rugroll: 'koberec' };
    // The heap, on a moving blanket along the bottom: in the order the seed chose, each piece shrunk to fit a box of
    // 23 x 21 and packed from left to right, every other one a little further back.
    const small = P.map((p) => { const [w, h] = FLAT.size(p.k, false); return Math.min(23 / w, 21 / h); });
    const wide = (id) => FLAT.size(P[id].k, false)[0] * small[id];
    const gap = (184 - L.order.reduce((a, id) => a + wide(id), 0)) / (N - 1), heap = [];
    L.order.reduce((x, id, i) => { heap[id] = { x: x + wide(id) / 2, y: 283 - (i % 2 ? 0 : 3) }; return x + wide(id) + gap; }, 4);
    let live = sn;
    const s = { t: 0, over: false, lost: false, hold: null, quiet: 0, dust: [], rings: [], tipAt: 0, seenNo: sn.no ? sn.no.n : 0, keepAt: 0, sent: '', sentAt: 0, mate: null,
      finale: 0, lit: 0, lampAt: -9, pulse: { id: -1, at: -9 }, prefer: null, dusk: false, tick: 0 };
    // Each piece as this phone shows it: where its feet are, how big, which way round, and when its little animations began.
    // `placed` and `park` are what this phone expects before the room has answered (the room has the last word). Back
    // in the game after a reload, what is already in (or waiting at its place) starts there, not in the heap.
    const V = P.map((p, id) => {
      const r = sn.pieces[id], there = r.done || !!r.rest;
      return { x: there ? p.x : heap[id].x, y: there ? p.y : heap[id].y, k: there ? p.size : small[id], f: r.f, lift: 0, placed: r.done, park: !!r.rest, pend: 0, back: false,
        at: { grab: -9, thud: -9, flip: -9, shake: -9, wob: -9, unroll: -9 } };
    });
    const view = stage('<span class="dots"></span><span class="sky"><i></i></span>', 'Táhni věci na svá místa.');
    view.tip.classList.add('up'); s.tipAt = 0.01;
    const dots = view.hud.querySelector('.dots'), sun = view.hud.querySelector('.sky i');
    dots.innerHTML = P.map(() => '<i></i>').join('');
    const say = (text) => { view.tip.textContent = text; s.tipAt = s.t || 0.01; };
    const q = (id) => live.pieces[id];
    const placed = (id) => V[id].placed;
    const ready = (id) => P[id].after < 0 || placed(P[id].after);
    const fits = (id, f) => !P[id].face || P[id].face === f;
    const mine = (id) => !!s.hold && s.hold.id === id;
    const theirs = (id) => !mine(id) && !placed(id) && !!q(id).by && q(id).by !== who;
    const parked = (id) => !placed(id) && !mine(id) && !theirs(id) && V[id].park;
    const home = (id) => (placed(id) || parked(id) ? { x: P[id].x, y: P[id].y, k: P[id].size } : { x: heap[id].x, y: heap[id].y, k: small[id] });
    const pulse = (id) => { s.pulse = { id, at: s.t }; };
    const done = () => V.filter((v) => v.placed).length;
    // Where the piece in hand is headed: under the finger once it has hopped up, drawn in when close to its place. The
    // piece on screen eases after it, so letting go (and the green "drop it here") is judged by the finger, never by
    // a piece still catching up after a quick flick.
    function aim(h, hop = clamp((s.t - h.at) / 0.18, 0, 1)) {
      const p = P[h.id], x = h.fx + h.ox * (1 - hop), y = h.fy + h.oy * (1 - hop) + CARRY * hop;
      const pull = ready(h.id) ? clamp(1 - Math.hypot(x - p.x, y - p.y) / (SNAP * 1.6), 0, 1) * 0.6 : 0;
      return { x: x + (p.x - x) * pull, y: y + (p.y - y) * pull };
    }
    const close = (h) => { const a = aim(h, 1); return Math.hypot(a.x - P[h.id].x, a.y - P[h.id].y) <= SNAP; };
    // Held without moving for a while (a resting finger), or kept from the partner for long: soon it goes home.
    const STILL = 8, LONG = 20;
    const tired = () => !!s.hold && (s.t - s.hold.still > STILL - 3 || (mateHere() && s.t - s.hold.at > LONG - 3));
    let painted = '';
    function paint() {
      const n = done(), u = clamp(s.t / live.seconds, 0, 1), late = !s.over && live.seconds - s.t < 15, key = `${n} ${Math.round(u * 200)} ${late}`;
      if (key === painted) return; painted = key;                                                // the bar changes only now and then
      dots.querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i < n));
      sun.style.left = `${Math.round(u * 1000) / 10}%`; sun.classList.toggle('moon', u > 0.8); sun.parentNode.classList.toggle('late', late);
    }
    paint();

    // ---- the evening: the sky in the windows, the light in the rooms ----
    // Which pixels of the picture are sky (read from the picture once: light blue or white cloud inside the panes), and a
    // few spots on the buildings and the bridge where lights come on at night.
    let glass = null;
    function readGlass(img) {
      try {
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, W, H).data, sky = g.createImageData(W, H), r = K.rng(5), stars = [], lights = [];
        PANES.forEach(([x0, y0, x1, y1], pane) => {
          for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            const i = (y * W + x) * 4, R = d[i], G = d[i + 1], B = d[i + 2];
            if (B >= 248 && R >= 80 && G >= 190) { sky.data.set([255, 255, 255, 255], i); if (r() < 0.012) stars.push([x, y, r() * 6]); continue; }
            const frame = R < 80 && G < 85 && B < 100, leaf = G > R + 15 && G > B;
            const city = pane ? y > 168 && y < 214 : y > 49 && y < 63 && B > R + 30;             // the towers; the harbour bridge
            if (!frame && !leaf && city && r() < 0.05) lights.push([x, y, r() * 6, r()]);
          }
        });
        const mask = document.createElement('canvas'); mask.width = W; mask.height = H; mask.getContext('2d').putImageData(sky, 0, 0);
        return { mask, stars, lights };
      } catch (e) { return { mask: null, stars: [], lights: [] }; }               // a picture that cannot be read: the windows stay as they are
    }
    // Where the evening has got to, from 0 (the start) to 1 (night): the sky's colour at the top and at the horizon, how
    // much it covers the day in the picture, and the light in the rooms (the rooms are multiplied by it).
    const KEYS = [[0, '#8FD3F4', '#C5EAFB', 0, '#FFFFFF'], [0.4, '#7FC4EE', '#FFE2A8', 0.3, '#FFFFFF'], [0.62, '#E9875A', '#FFC46B', 0.85, '#FFE3CC'],
      [0.82, '#5A3F7E', '#E06A5A', 0.93, '#C2B6DA'], [1, '#141A3C', '#2B2F5E', 0.97, '#8C90C8']];
    const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const mix = (a, b, e) => (typeof a === 'string' ? rgb(a) : a).map((v, i) => Math.round(v + ((typeof b === 'string' ? rgb(b) : b)[i] - v) * e));
    const css = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
    function evening(u) {
      let i = 0; while (i < KEYS.length - 2 && u > KEYS[i + 1][0]) i++;
      const a = KEYS[i], b = KEYS[i + 1], e = clamp((u - a[0]) / (b[0] - a[0]), 0, 1);
      return { top: mix(a[1], b[1], e), low: mix(a[2], b[2], e), cover: a[3] + (b[3] - a[3]) * e, room: mix(a[4], b[4], e) };
    }
    const layer = document.createElement('canvas'); layer.width = W; layer.height = H;
    const lg = layer.getContext('2d');
    // paint something into the panes only where the picture shows sky (behind the bridge, the towers and the frames)
    function inSky(paint, alpha) {
      if (!glass || !glass.mask) return;
      lg.globalCompositeOperation = 'source-over'; lg.clearRect(0, 0, W, H); paint(lg);
      lg.globalCompositeOperation = 'destination-in'; lg.drawImage(glass.mask, 0, 0);
      ctx.save(); ctx.globalAlpha = alpha; ctx.drawImage(layer, 0, 0); ctx.restore();
    }
    const disc = (g, cx, cy, r, col) => { g.fillStyle = col; for (let dy = -r; dy <= r; dy++) { const w = Math.round(Math.sqrt(r * r - dy * dy)); g.fillRect(Math.round(cx) - w, Math.round(cy) + dy, 2 * w + 1, 1); } };
    function sky(ev) {
      // in bands four pixels high, darker at the top, as the sky is painted in the picture
      inSky((g) => PANES.forEach(([x0, y0, x1, y1]) => { for (let y = y0; y < y1; y += 4) { g.fillStyle = css(mix(ev.top, ev.low, Math.min(1, (y - y0) / (y1 - y0 - 20)))); g.fillRect(x0, y, x1 - x0, 4); } }), ev.cover);
    }
    function sunAndStars(u) {
      // the sun sinks in the bedroom window behind the bridge into the harbour; then the moon rises in the other one
      if (u > 0.22 && u < 0.8) { const e = (u - 0.22) / 0.58; inSky((g) => { disc(g, 172, 24 + e * 50, 6, css(mix('#FFE45C', '#FF7A3A', e))); disc(g, 172, 24 + e * 50, 3, css(mix('#FFF6C0', '#FFB060', e))); }, 1); }
      if (u > 0.72) { const e = clamp((u - 0.72) / 0.28, 0, 1); inSky((g) => { disc(g, 30, 206 - e * 40, 5, '#F4F0DC'); g.fillStyle = '#D8D2B8'; g.fillRect(28, 204 - e * 40, 2, 2); g.fillRect(32, 207 - e * 40, 2, 1); }, Math.min(1, e * 3)); }
      const night = clamp((u - 0.7) / 0.25, 0, 1); if (!night || !glass) return;
      for (const [x, y, ph] of glass.stars) if (Math.sin(s.t * 2 + ph) > -0.4) rect(x, y, 1, 1, `rgba(255,248,231,${night * 0.9})`);
      for (const [x, y, ph, k] of glass.lights) if (k < night) rect(x, y, 1, 1, Math.sin(s.t * 1.3 + ph) > -0.8 ? '#FFD27A' : '#E0A84A');   // the city's lights come on one by one
    }
    // The rooms grow dim; the lamp, once it stands, lights the living room warmly; at the end every light is on.
    const WARM = '#FFF0D8', LAMPLIT = '#FFE0B8';
    function dim(u, ev) {
      const lamp = placed(LAMP), night = clamp((u - 0.45) / 0.55, 0, 1);
      const up = mix(ev.room, WARM, s.lit), down = mix(lamp ? mix(ev.room, LAMPLIT, 0.75) : ev.room, WARM, s.lit);
      ctx.save(); ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = css(up); ctx.fillRect(0, 0, W, ROOMS); ctx.fillStyle = css(down); ctx.fillRect(0, ROOMS, W, H - ROOMS);
      ctx.restore();
      if (!lamp) return;
      const p = P[LAMP], flash = clamp(1 - (s.t - s.lampAt) / 0.5, 0, 1), a = Math.max(0.25 + night * 0.75, s.lit) + flash;   // switched on: a bright moment
      const cy = p.y - FLAT.size('lamp', true)[1] * p.size + 6;                                                  // the shade
      ctx.save(); ctx.beginPath(); ctx.rect(0, ROOMS + 4, W, 282 - ROOMS - 4); ctx.clip(); ctx.globalCompositeOperation = 'lighter';
      for (const [r, al] of [[52, 0.035], [36, 0.05], [22, 0.07], [11, 0.09]]) disc(ctx, p.x, cy, r, `rgba(255,178,92,${al * a})`);
      ctx.restore();
    }

    // ---- the silhouettes: a piece's shape, filled, and a dashed line round it, one game pixel each like the picture ----
    const sheets = {}, shapes = {};
    const sheetImg = (name) => { if (!sheets[name]) { sheets[name] = new Image(); sheets[name].src = K.asset(`assets/sprites/${K.sprites[name].file}`); } return sheets[name]; };
    function shape(k, size) {
      const key = k + size; if (shapes[key]) return shapes[key];
      const [sheet, pose] = FLAT.look(k, true), sp = K.sprites[sheet]; if (!sp) return null;
      const img = sheetImg(sheet); if (!img.complete || !img.naturalWidth) return null;      // still loading: next time
      const w = Math.ceil(sp.w * size), h = Math.ceil(sp.h * size), c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(img, sp.poses[pose][0] * sp.w, 0, sp.w, sp.h, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h).data, fill = g.createImageData(w, h), dash = g.createImageData(w, h);
      const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 110;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!on(x, y)) continue;
        fill.data.set([255, 255, 255, 255], (y * w + x) * 4);
        if ((!on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1)) && ((x + y) >> 1) % 2 === 0) dash.data.set([255, 255, 255, 255], (y * w + x) * 4);
      }
      const canvas = (data) => { const e = document.createElement('canvas'); e.width = w; e.height = h; e.getContext('2d').putImageData(data, 0, 0); return e; };
      return (shapes[key] = { fill: canvas(fill), dash: canvas(dash), ox: Math.floor(sp.w / 2) * size, oy: sp.h * size, top: FLAT.size(k, true)[1] * size });
    }
    const tmp = document.createElement('canvas'), tg = tmp.getContext('2d');
    function stencil(c, col, alpha, sh, x, y, f) {                    // a shape drawn all in one colour
      if (tmp.width < c.width || tmp.height < c.height) { tmp.width = Math.max(tmp.width, c.width); tmp.height = Math.max(tmp.height, c.height); }
      tg.globalCompositeOperation = 'source-over'; tg.clearRect(0, 0, tmp.width, tmp.height); tg.drawImage(c, 0, 0);
      tg.globalCompositeOperation = 'source-in'; tg.fillStyle = col; tg.fillRect(0, 0, c.width, c.height);
      ctx.save(); ctx.globalAlpha = alpha; ctx.translate(Math.round(x), Math.round(y)); if (f < 0) ctx.scale(-1, 1);
      ctx.drawImage(tmp, 0, 0, c.width, c.height, -sh.ox, -sh.oy, c.width, c.height); ctx.restore();
    }
    // A place: faint while waiting, lit and pulsing with an arrow when it is where the piece in hand goes (or what has to
    // go first), green when the piece is close enough to drop in. The partner's goal shows in their colour.
    // The pale dashes have a dark pixel under each, so a waiting place reads on the floor and the walls; on the busy
    // rug (the coffee table's place) it is the other way round: a pale shape with dark dashes.
    function ghost(id, how, quiet) {
      const p = P[id], sh = shape(p.k, p.size); if (!sh) return;
      const f = p.face || V[id].f, beat = 0.5 + 0.5 * Math.sin(s.t * 9), rug = p.after >= 0 && placed(p.after);
      if (how === 'wait' && rug) { stencil(sh.fill, '#FFF8E7', 0.4, sh, p.x, p.y, f); stencil(sh.dash, INK, 0.85, sh, p.x, p.y, f); }
      else if (how === 'wait') { stencil(sh.fill, INK, 0.13, sh, p.x, p.y, f); stencil(sh.dash, INK, 0.55, sh, p.x, p.y + 1, f); stencil(sh.dash, '#FFF8E7', 0.9, sh, p.x, p.y, f); }
      if (how === 'later') { stencil(sh.fill, INK, 0.06, sh, p.x, p.y, f); stencil(sh.dash, INK, 0.25, sh, p.x, p.y + 1, f); stencil(sh.dash, '#FFF8E7', 0.4, sh, p.x, p.y, f); }
      if (how === 'aim') { stencil(sh.fill, '#FFD43A', 0.3 + 0.3 * beat, sh, p.x, p.y, f); stencil(sh.dash, INK, 0.8, sh, p.x, p.y, f); if (!quiet) arrow(id, sh); }
      if (how === 'near') { stencil(sh.fill, '#7CE07C', 0.7, sh, p.x, p.y, f); stencil(sh.dash, '#1FA463', 1, sh, p.x, p.y, f); }
      if (how === 'mate') { stencil(sh.fill, COL[mate()], 0.18, sh, p.x, p.y, f); stencil(sh.dash, COL[mate()], 0.9, sh, p.x, p.y, f); }
    }
    // The arrow bounces over a place; where something already stands over it (the sofa behind the coffee table), it
    // points up at it from the floor in front instead, so it is never read as pointing at the wrong piece.
    function arrow(id, sh) {
      const p = P[id], x = p.x, y = p.y - sh.top - 4, bob = Math.round(Math.abs(Math.sin(s.t * 6)) * 3);
      const hid = [...P.keys()].some((j) => {
        if (j === id || !placed(j) || P[j].k === 'rugroll') return false;
        const [w, h] = FLAT.size(P[j].k, true), q = P[j];
        return Math.abs(x - q.x) < w * q.size / 2 + 4 && y - 3 > q.y - h * q.size - 2 && y - 3 < q.y;
      });
      if (!hid) return bits(DOWN, x - 4, y - 6 - bob, '#FFD43A');
      bits([...DOWN].reverse(), x - 4, p.y + 2 + bob, '#FFD43A');
    }
    const turnBadge = (x, y) => bits(TURN, x - 6, y - 12 - Math.round(Math.abs(Math.sin(s.t * 5)) * 2), '#FFD43A');

    // ---- a piece, with its little animations ----
    function piece(id) {
      const v = V[id], p = P[id], t = s.t, isIn = placed(id), ease = (at, len) => clamp((t - at) / len, 0, 1);
      let sx = 1, sy = 1, dx = 0, dy = -Math.round(v.lift * 3);
      const g = ease(v.at.grab, 0.3); if (g < 1) { const b = Math.sin(g * Math.PI); sx *= 1 + 0.14 * b; sy *= 1 + 0.14 * b; dy -= Math.round(b * 3); }    // taken: a hop
      const th = ease(v.at.thud, 0.32); if (th < 1) { const b = Math.sin(th * Math.PI) * (1 - th); sy *= 1 - 0.24 * b; sx *= 1 + 0.14 * b; }   // put down: squashed, and up again
      const fl = ease(v.at.flip, 0.2); if (fl < 1) sx *= 2 * fl - 1;                                                    // turned: it narrows and opens the other way round
      const sk = ease(v.at.shake, 0.4); if (sk < 1) dx += Math.round(Math.sin(sk * 40) * 2.5 * (1 - sk));               // no: a shake
      const wb = ease(v.at.wob, 0.5); if (wb < 1) dx += Math.round(Math.sin(wb * 22) * 2 * (1 - wb));                   // back in the heap: a wobble
      if (mine(id) && tired()) dx += Math.round(Math.sin(t * 30));                                                     // held too long: it trembles before it goes home
      const by = mine(id) ? who : theirs(id) ? q(id).by : null;
      if (by) {                                                                                                         // in someone's hand: their colour under it
        const [w] = FLAT.size(p.k, false), hw = Math.max(4, Math.round(w * v.k * 0.42));
        rect(v.x - hw, v.y - 1, 2 * hw, 3, COL[by]); rect(v.x - hw + 2, v.y - 2, 2 * hw - 4, 5, COL[by]);
      }
      const un = ease(v.at.unroll, 0.45);
      if (p.k === 'rugroll' && isIn && un < 1) {                                                                          // the rug unrolls from the left
        const [w, h] = FLAT.size('rugroll', true), rw = w * p.size, x0 = p.x - rw / 2, edge = Math.round(x0 + rw * un);
        ctx.save(); ctx.beginPath(); ctx.rect(x0 - 1, p.y - h * p.size - 2, edge - x0 + 1, h * p.size + 4); ctx.clip(); FLAT.draw(p.k, true, p.x, p.y, p.size, v.f); ctx.restore();
        rect(edge - 2, p.y - h * p.size - 1, 4, h * p.size + 1, '#A4302A'); rect(edge - 1, p.y - h * p.size, 1, h * p.size - 1, '#D9564A');
        return;
      }
      FLAT.draw(p.k, isIn, v.x + dx, v.y + dy, v.k, v.f, sx, sy);
    }
    // The thud of a piece going in, on this phone at once (or when the room says the partner put one in): a squash,
    // dust puffing out both ways along the floor, and +1 in the colour of whoever did it. The rug unrolls.
    function landed(id, w) {
      const v = V[id], p = P[id], [pw, ph] = FLAT.size(p.k, true), half = pw * p.size / 2;
      v.at.thud = s.t; if (p.k === 'rugroll') v.at.unroll = s.t;
      for (let i = 0; i < 12; i++) { const dir = i % 2 ? 1 : -1; s.dust.push({ x: p.x + dir * half * (0.5 + Math.random() * 0.5), y: p.y - 1, vx: dir * (12 + Math.random() * 26), vy: -(4 + Math.random() * 16), at: s.t }); }
      drum('kick'); beep(523, 784);
      plus('+1', p.x, p.y - ph * p.size - 4, COL[w] || '#FFD43A');
      if (id === LAMP) { s.lampAt = s.t; beep(1319); }
      const n = done(); if (n === 1) cheer('Super!'); else if (n === 5) cheer('Paráda!');
      paint();
    }

    // ---- taking, dragging and letting go ----
    // The piece under the finger: one in the heap, one left standing at its place, or one the partner holds (to say so);
    // pieces already in only bob. A finger near the heap takes the nearest piece there, so small fingers never miss.
    function pick(x, y) {
      const box = (id) => { const v = V[id], [w, h] = FLAT.size(P[id].k, placed(id)), pad = v.k < 0.3 ? 6 : 3; return [v.x - w * v.k / 2 - pad, v.x + w * v.k / 2 + pad, v.y - h * v.k - pad - 3, v.y + pad]; };
      for (const loose of [true, false]) {
        let best = null, bd = 1e9;
        for (let id = 0; id < N; id++) {
          if (placed(id) === loose) continue;
          const [x0, x1, y0, y1] = box(id); if (x < x0 || x > x1 || y < y0 || y > y1) continue;
          const d = Math.hypot(x - V[id].x, y - (y0 + y1) / 2); if (d < bd) { bd = d; best = id; }
        }
        if (best === null && loose && y > 256) for (let id = 0; id < N; id++) { const d = Math.abs(V[id].x - x); if (!placed(id) && !parked(id) && !theirs(id) && d < 16 && d < bd) { bd = d; best = id; } }
        if (best !== null) return best;
      }
      return null;
    }
    function putIn(id, at = P[id]) {                     // close enough, the right way round: in it goes at once here; the room confirms
      const v = V[id];
      v.placed = true; v.park = false; v.pend = s.t; landed(id, who);
      Net.send({ type: 'ev', e: 'place', id, x: Math.round(at.x), y: Math.round(at.y), f: v.f });   // where the finger put it
    }
    // Back to the heap, or (park) left standing at its place the wrong way round, for a tap. This phone decides which,
    // and says so: the room never parks a piece by itself, so both phones always agree with what was just seen here.
    function letGo(id, park) {
      const v = V[id], p = P[id];
      v.park = park; v.back = !park;
      Net.send({ type: 'ev', e: 'drop', id, x: Math.round(park ? p.x : v.x), y: Math.round(park ? p.y : v.y), f: v.f, park: park ? 1 : 0 });
    }
    // the room said no (or this phone saw it would): back it goes, and why
    function refused(id, why) {
      const v = V[id];
      if (why === 'taken') {                                                       // the other one had it first (a race over the network)
        if (mine(id)) s.hold = null;
        if (v.placed && !q(id).done) { v.placed = false; v.pend = 0; paint(); }
        v.at.shake = s.t; beep(180); return say(`To nese ${heroName(q(id).by || mate())}.`);
      }
      v.placed = false; v.pend = 0; v.back = true; beep(220, 175);
      if (why === 'order') { pulse(P[id].after); say(`Nejdřív ${NAME[P[P[id].after].k] || 'to druhé'}!`); }
      else if (why === 'face') { v.park = true; v.back = false; say('Klepnutím otočíš.'); }
      else pulse(id);
    }
    // What to do next, shown by a hand: on this phone's list, the first piece that is free and may go in now. With two,
    // Kendrick's list starts in the bedroom (the bed has to be turned) and Kellyn's with the rug, so they split the work.
    const LIST = (who === 'ken' && mateHere() ? ['bed', 'shelf', 'chair', 'rugroll', 'lamp', 'armchair', 'plant', 'sofa', 'table'] : ['rugroll', 'sofa', 'table', 'lamp', 'armchair', 'plant', 'bed', 'shelf', 'chair'])
      .map((k) => P.findIndex((p) => p.k === k));
    const free = (id) => id >= 0 && !placed(id) && ready(id) && !theirs(id) && !mine(id);
    // one waiting for a tap comes first; then one that has just gone home by itself (the hand shows where it goes)
    const next = () => [...P.keys()].find(parked) ?? (s.prefer && s.t - s.prefer.at < 6 && free(s.prefer.id) ? s.prefer.id : LIST.find(free));

    return {
      s, kind: 'flat',
      peek: () => ({ t: s.t, over: s.over, holding: s.hold ? s.hold.id : null, next: next(), pieces: P.map((p, id) => {
        const v = V[id], [, h] = FLAT.size(p.k, placed(id));
        return { id, k: p.k, done: placed(id), by: q(id).by, face: p.face, f: v.f, ready: ready(id), parked: parked(id), at: { x: Math.round(v.x), y: Math.round(v.y - h * v.k / 2) }, to: { x: p.x, y: p.y - CARRY } };
      }) }),
      sync(n) {
        live = n;
        if (n.paused && s.hold) { V[s.hold.id].back = true; s.hold = null; }           // a pause lets go of what is held (the room does too)
        if (n.no && n.no.n !== s.seenNo) { s.seenNo = n.no.n; if (n.no.who === who) refused(n.no.id, n.no.why); }   // the room said no to this phone: why
        n.pieces.forEach((r, id) => {
          const v = V[id];
          if (r.done) { if (!v.placed) { v.placed = true; landed(id, r.who || mate()); } v.pend = 0; v.park = false; return; }
          if (r.by && r.by !== who && (mine(id) || v.pend)) refused(id, 'taken');      // both went for it at once: the other was first
          if (r.by !== who && !mine(id) && !v.pend) {                                    // what nobody here holds, the room knows best
            v.park = !!r.rest;
            if (r.f !== v.f) { v.f = r.f; v.at.flip = s.t; }
          }
        });
        if (s.mate && n.pieces[s.mate.id].by !== mate()) s.mate = null;
        paint();
      },
      fx(m) {
        if (m.k !== 'move') return;
        const id = m.id | 0, f = m.f === -1 ? -1 : 1; if (!P[id]) return;
        s.mate = { id, x: +m.x || 0, y: +m.y || 0 };
        if (V[id].f !== f && !mine(id)) { V[id].f = f; V[id].at.flip = s.t; }
      },
      over(won) {
        s.over = true; s.lost = !won; s.hold = null; paint();
        if (!won) return view.end(false, 'Setmělo se.', 'Zkuste to znovu.');
        s.finale = Math.max(0.01, s.t); cheer('Nastěhováno!'); beep(1047, 1319, 1568);
        setTimeout(() => { if (view.hud.isConnected) view.end(true, 'Nastěhováno!', 'Všechno je na svém místě.'); }, 2900);   // first the lights and the visitors
      },
      down(x, y, finger) {
        if (s.over || y < 22) return;
        if (s.hold) { const o = pick(x, y); if (o !== null && o !== s.hold.id && !placed(o)) V[o].at.shake = s.t; return; }   // one piece at a time: a second finger (or a palm) only nudges another
        const id = pick(x, y);
        if (id === null) { s.rings.push({ x, y, at: s.t }); s.quiet = 99; return beep(330); }                       // nothing there: a ripple, and the hand shows what to do
        const v = V[id];
        if (placed(id)) { v.at.thud = s.t; return beep(784, 988); }                                                    // in already: it bobs
        if (s.t < 0) { v.at.shake = s.t; beep(180); return say('Ještě chvilku…'); }
        if (theirs(id)) { v.at.shake = s.t; beep(180); return say(`To nese ${heroName(q(id).by)}.`); }
        s.hold = { id, finger, fx: x, fy: y, sx: x, sy: y, ox: v.x - x, oy: v.y - y, at: s.t, moved: false, parked: parked(id), still: s.t, lx: x, ly: y };
        v.at.grab = s.t; v.back = false; s.quiet = 0; beep(523, 698);
        Net.send({ type: 'ev', e: 'grab', id }); s.keepAt = s.t;
        if (!ready(id)) { pulse(P[id].after); say(`Nejdřív ${NAME[P[P[id].after].k] || 'to druhé'}!`); }      // the rug first: its place lights up
      },
      move(x, y, dx, finger) {
        const h = s.hold; if (!h || finger !== h.finger) return; h.fx = x; h.fy = y;                                 // only the finger that holds it drags it
        if (Math.hypot(x - h.sx, y - h.sy) > 4) h.moved = true;
        if (Math.hypot(x - h.lx, y - h.ly) > 3) { h.still = s.t; h.lx = x; h.ly = y; }
      },
      up(x, y, tapped, finger) {
        const h = s.hold; if (!h || finger !== h.finger) return;
        s.hold = null; s.quiet = 0;
        const id = h.id, v = V[id], p = P[id];
        if (s.over) return;
        if (live.paused) { v.back = true; return; }                                                                    // let go during a pause: it just goes back
        if (tapped && !h.moved) {                                                                                      // a tap: turned round, where it was
          v.f = -v.f; v.at.flip = s.t; if (p.face && fits(id, v.f)) beep(698, 880, 1175); else beep(698, 523);     // turned the way its place wants: a happy note
          if (h.parked && fits(id, v.f) && ready(id)) return putIn(id);                                                // now it fits: in it goes
          return letGo(id, h.parked && !fits(id, v.f));
        }
        if (close(h)) {
          if (!ready(id)) { letGo(id, false); return refused(id, 'order'); }
          if (!fits(id, v.f)) { letGo(id, true); v.at.wob = s.t; beep(330, 440); return say('Klepnutím otočíš.'); }   // waits at its place for a tap
          return putIn(id, aim(h, 1));
        }
        letGo(id, false); beep(330, 262); pulse(id);                                                                    // not here: back to the heap, and its place blinks
      },
      update(dt) {
        s.t = clock(live);
        const u = clamp(s.t / live.seconds, 0, 1);
        if (!s.hold) s.quiet += dt;
        for (let id = 0; id < N; id++) {
          const v = V[id], p = P[id], held = mine(id), other = theirs(id);
          let tx, ty, tk, rate;
          if (held) { const a = aim(s.hold); tx = a.x; ty = a.y; tk = p.size; rate = 30; }                         // follows the finger, hopping up above it
          else if (other) { const m = s.mate && s.mate.id === id ? s.mate : null, hm = home(id); tx = m ? m.x : hm.x; ty = m ? m.y : hm.y - 4; tk = m ? p.size : hm.k; rate = 14; }
          else { const hm = home(id); tx = hm.x; ty = hm.y; tk = hm.k; rate = placed(id) ? 30 : 11; }
          v.x += (tx - v.x) * (1 - Math.exp(-dt * rate)); v.y += (ty - v.y) * (1 - Math.exp(-dt * rate)); v.k += (tk - v.k) * (1 - Math.exp(-dt * 12));
          if (v.back && Math.hypot(tx - v.x, ty - v.y) < 1) { v.back = false; v.at.wob = s.t; }                       // landed back in the heap: a wobble
          v.lift += ((held || other ? 1 : 0) - v.lift) * (1 - Math.exp(-dt * 16));
          if (v.placed && v.pend && s.t - v.pend > 4 && !q(id).done) refused(id, 'far');                               // no answer from the room: try again
        }
        // Held still for long (a finger resting), or with two kept from the other for long: after a tremble it goes home
        // with a soft sound (not a mistake), its place blinks and the hand shows the way, so nobody blocks the other.
        if (s.hold && !s.over && (s.t - s.hold.still > STILL || (mateHere() && s.t - s.hold.at > LONG))) {
          const id = s.hold.id; s.hold = null; letGo(id, false); pulse(id); s.prefer = { id, at: s.t }; s.quiet = 99; beep(392, 523);
        }
        if (s.hold && !s.over) {                                                                                       // still holding it: the room hears so now and then
          if (s.t - s.keepAt > 1.2) { s.keepAt = s.t; Net.send({ type: 'ev', e: 'grab', id: s.hold.id }); }
          const v = V[s.hold.id], at = `${Math.round(v.x)},${Math.round(v.y)},${v.f}`;
          if (mateHere() && at !== s.sent && Net.now() - s.sentAt > 70) { s.sent = at; s.sentAt = Net.now(); Net.send({ type: 'fx', k: 'move', id: s.hold.id, x: Math.round(v.x), y: Math.round(v.y), f: v.f }); }
        }
        if (!s.over && s.t > 0) {
          const left = live.seconds - s.t;
          if (u > 0.6 && !s.dusk) { s.dusk = true; say('Stmívá se!'); beep(440, 330); }
          if (left <= 10 && Math.ceil(left) !== s.tick) { s.tick = Math.ceil(left); beep(988); }                   // the last ten seconds tick away
        }
        if (s.finale) s.lit = clamp((s.t - s.finale) / 0.6, 0, 1);
        s.dust = s.dust.filter((d) => s.t - d.at < 0.6); for (const d of s.dust) { d.x += d.vx * dt; d.y += d.vy * dt; d.vy += 60 * dt; d.vx *= 1 - dt * 3; }
        s.rings = s.rings.filter((r) => s.t - r.at < 0.4);
        if (s.tipAt && s.t - s.tipAt > 3) { view.tip.textContent = ''; s.tipAt = 0; }
        paint();
      },
      draw() {
        const img = K.picture(sc.bg); if (!img) return K.background(sc.bg);
        if (!glass) glass = readGlass(img);
        const u = s.lost ? 1 : clamp(s.t / live.seconds, 0, 1), ev = evening(u), t = s.t;
        ctx.drawImage(img, 0, 0);
        sky(ev);
        // what stands in the rooms, from the back to the front, the rug under everything; the dark comes over them
        const inRoom = [...P.keys()].filter((id) => placed(id)).sort((a, b) => FLAT.order(P[a], P[b]));
        for (const id of inRoom) piece(id);
        dim(u, ev);
        sunAndStars(u);
        // where things go: the place for the piece in hand lit up (or the rug's, if that has to go first), and the hint's
        const hold = s.hold ? s.hold.id : -1, hv = hold >= 0 ? V[hold] : null;
        const near = hold >= 0 && ready(hold) && close(s.hold);                                      // judged by the finger, as letting go is
        const tip = !s.over && hold < 0 ? next() : undefined, showHint = tip !== undefined && s.t > 0.3 && (s.quiet > 5 || done() === 0);
        const pulsing = s.t - s.pulse.at < 1.6 ? s.pulse.id : -1;
        for (let id = 0; id < N; id++) {
          if (placed(id) || parked(id) || s.over) continue;
          const goal = id === hold ? (ready(id) ? (near && fits(id, hv.f) ? 'near' : 'aim') : 'later') : null;   // green: let go and it is in
          const blocker = hold >= 0 && !ready(hold) && P[hold].after === id;
          ghost(id, goal || (blocker || id === pulsing || (showHint && id === tip) ? 'aim' : theirs(id) ? 'mate' : ready(id) ? 'wait' : 'later'), id === hold && near);   // no arrow once it is there
        }
        // left standing at their place the wrong way round: they wait for a tap
        for (let id = 0; id < N; id++) if (parked(id)) { piece(id); if (!s.over) turnBadge(P[id].x + 8, P[id].y - P[id].size * FLAT.size(P[id].k, true)[1]); }
        // the heap: a moving blanket with two boxes, and what is still on it
        if (done() < N && !s.finale) {
          rect(3, 263, 186, 21, '#4C5772'); rect(3, 263, 186, 1, '#76829F'); rect(3, 283, 186, 1, '#3A4258');
          for (let x = 6; x < 188; x += 7) for (let y = 266; y < 282; y += 5) rect(x + ((y / 5) % 2 ? 3 : 0), y, 2, 1, '#5E6B8C');
          if (K.has('kerb', 'box')) { K.figure('kerb', 46, 273, 'box', 0, false, 0.3); K.figure('kerb', 148, 274, 'box', 0, true, 0.28); }
        }
        for (let id = 0; id < N; id++) if (!placed(id) && !parked(id) && !mine(id) && !theirs(id)) piece(id);
        for (let id = 0; id < N; id++) if (theirs(id)) piece(id);
        if (hold >= 0) {
          piece(hold);
          if (near && !fits(hold, hv.f)) turnBadge(hv.x + 10, hv.y - P[hold].size * FLAT.size(P[hold].k, false)[1] - 2);   // close, but the wrong way round
        }
        for (const d of s.dust) { const a = 1 - (t - d.at) / 0.6; rect(d.x, d.y, 2, 2, `rgba(233,220,194,${a})`); }
        for (const r of s.rings) { const e = (t - r.at) / 0.4, rad = 2 + e * 7; for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; rect(r.x + Math.cos(a) * rad, r.y + Math.sin(a) * rad, 1, 1, `rgba(255,248,231,${1 - e})`); } }
        if (showHint) hint(tip);
        if (s.finale) visitors();
      },
    };

    // The hand that shows what to do: it takes the piece from the heap and carries a pale copy of it to its place; a piece
    // the wrong way round it taps instead, for turning.
    function hint(id) {
      const v = V[id], p = P[id], c = (s.t % 2.6) / 2.6, hx = (x, y, a) => { ctx.save(); ctx.globalAlpha = a; bits(HAND, x - 3, y, '#FFF8E7'); ctx.restore(); };
      const [, h] = FLAT.size(p.k, parked(id)), from = { x: v.x, y: v.y - h * v.k / 2 };
      if (!fits(id, v.f)) { const press = c % 0.5 < 0.2 ? 2 : 0; turnBadge(v.x + 8, v.y - h * v.k); return hx(from.x, from.y + press, 1); }
      const e = clamp((c - 0.15) / 0.5, 0, 1), m = e < 0.5 ? 2 * e * e : 1 - 2 * (1 - e) * (1 - e), fade = c > 0.85 ? (1 - c) / 0.15 : 1;
      const x = from.x + (p.x - from.x) * m, y = from.y + (p.y - h * p.size / 2 - from.y) * m;
      if (c > 0.15) { ctx.save(); ctx.globalAlpha = 0.55 * fade; FLAT.draw(p.k, false, x, y + h * (v.k + (p.size - v.k) * m) / 2 + 2, v.k + (p.size - v.k) * m, v.f); ctx.restore(); }
      hx(x, y + (c < 0.15 ? 2 : 0), fade);
    }
    // At the end Sami and Žofia come in at the door and are thrilled; the two of them cheer at the front. The visitors
    // stop just inside the door, clear of the armchair, and jump for joy: up in the air with their arms high, a rest on
    // the floor between the jumps.
    function visitors() {
      const u = s.t - s.finale, walk = clamp((u - 0.3) / 1.1, 0, 1), there = walk >= 1, e = 1 - (1 - walk) * (1 - walk);   // they slow down as they arrive
      (sc.cast || []).forEach((id, i) => {
        if (!K.sprites[id]) return;
        const x = 176 + (162 + i * 17 - 176) * e, y = 250 + (262 + i * 4 - 250) * e;
        const hop = there ? Math.round(Math.max(0, Math.sin(u * 6 + i * 1.7)) * 6) : Math.round(Math.abs(Math.sin(u * 9 + i)));
        if (u > 0.3) K.figure(id, x, y - hop, there ? (hop > 2 ? 'joy' : 'cheer') : 'run', u * 0.8, there, 0.4);   // walking in faces left; then they turn to the room
      });
      const kids = mateHere() ? [who, mate()] : [who];
      kids.forEach((w, i) => { const hop = Math.round(Math.abs(Math.sin(u * 6 + i * 2)) * 6); K.hero(w, 40 + i * 30, 279 - hop, 'cheer', u, i === 1); });
    }
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
        if (sc.play === 'flat' && K.picture(sc.bg)) FLAT.furnish(sc);                     // the flat they have just moved into
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
