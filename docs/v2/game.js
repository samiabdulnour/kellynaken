// The game itself: title, the planet, a place's four scenes, playing a scene, and the album of rescued people.
// Everything it shows comes from window.WORLD (world.js).
//
// It is always played by the two of them together, each on their own device. What they share (how far they have
// got, where they are, the scene being played, its lives and hits) lives in a room (room.js) on the server. This
// file shows that state and reports what its own hero does. Each device simulates only its own hero; the other one
// is drawn from the few things their device sends over (a jump, a shot, a drum tap).
(() => {
  const { W, H, GROUND, INK, ctx, save, write, go, add, esc, rect, beep, clamp } = K;
  const WORLD = window.WORLD, places = WORLD.places, pins = WORLD.planet.pins;

  // ---- the line to the room ----
  const Net = (() => {
    const solo = /[?&]solo\b/.test(location.search);                    // one device, for trying things out
    const base = location.protocol === 'file:' || /github\.io$/.test(location.hostname) ? WORLD.server : '';
    if (!save.id) { save.id = Math.random().toString(36).slice(2, 10); write(); }      // this device, so it can take its seat again
    let who = null, state = null, off = null, es = null, room = null, again = 0, ticker = 0;
    const hear = { state() {}, fx() {}, taken() {} };
    function take(m) {
      if (m.type === 'state') {
        off = off === null ? m.now - Date.now() : Math.max(off, m.now - Date.now());   // the room's clock, as near as the fastest message shows
        state = m; save.places = m.save.places; save.album = m.save.album; write();     // each device remembers too, in case the server forgets
        hear.state(m);
      } else if (m.type === 'fx') hear.fx(m);
      else if (m.type === 'taken') { leave(); hear.taken(); }
    }
    function leave() { clearTimeout(again); if (es) es.close(); es = null; room = null; who = null; state = null; off = null; }
    // The stream to the server. If it breaks (a tunnel, a sleeping server) it is opened afresh, bringing along what this
    // device remembers, so a server that has just woken up with an empty memory is told how far they had got.
    function listen() {
      const mine = { places: save.places, album: save.album };
      es = new EventSource(`${base}/v2/api/stream?who=${who}&id=${save.id}&save=${encodeURIComponent(JSON.stringify(mine))}`);
      es.onmessage = (e) => { let m = null; try { m = JSON.parse(e.data); } catch (err) {} if (m) take(m); };
      es.onerror = () => { if (!es) return; es.close(); es = null; if (who) again = setTimeout(listen, 1500); };
    }
    function join(w) {
      leave(); who = w;
      const mine = { places: save.places, album: save.album };
      if (solo) {
        const r = Room.create({ world: WORLD, solo: true, now: () => Date.now(), emit: (to, m) => { if (to === 'all' || to === who) { const copy = JSON.parse(JSON.stringify(m)); setTimeout(() => { if (room === r) take(copy); }, 0); } } });
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

  const progress = (p) => (st() && st().save.places[p.id]) || { scene: 0, done: false };
  const isOpen = (p) => { const i = places.indexOf(p); return i === 0 || (i > 0 && progress(places[i - 1]).done); };
  const todo = (p) => isOpen(p) && !progress(p).done;
  const stateOf = (p) => (progress(p).done ? 'hotovo' : isOpen(p) ? 'hraj' : 'zamčeno');
  const fullName = (p) => (p.area ? `${p.name} · ${p.area}` : p.name);
  const behind = (pin) => (pin.places || []).map((id) => places.find((p) => p.id === id));
  const later = (pin) => (pin.later || []).map((id) => (WORLD.later || []).find((p) => p.id === id)).filter(Boolean);   // places that open in the future
  const pinState = (pin) => {
    const ps = behind(pin);
    if (!ps.length) return 'soon';
    if (ps.some(todo)) return 'todo';
    return ps.some((p) => progress(p).done) ? 'done' : 'locked';
  };
  const draft = (id) => { if (!K.hasBg(id)) add('<span class="draft">náhradní obrázek</span>'); };
  // A character's face from the sheet, for the UI. mood: 0 calm, 1 laughing, 2 surprised, 3 smiling, 4 eyes closed.
  // f is how many screen pixels each drawn pixel takes.
  const face = (id, mood = 0, f = 2) => {
    const sp = K.sprites[id]; if (!sp) return '';
    const c = sp.faces, u = f * (c.scale || 1) / 8;                                // drawn finer faces come with a scale
    return `<span class="face" style="width:${c.w * u}em;height:${c.h * u}em;background-image:url(assets/sprites/${c.file});background-size:${c.w * c.n * u}em ${c.h * u}em;background-position:${-mood * c.w * u}em 0"></span>`;
  };

  // ---- which screen is up: the room says where everyone is, and both devices follow ----
  let shown = null, away = false;               // away: looking at the album, which is one's own business
  const waiting = document.getElementById('wait');
  function route() {
    const s = st(); if (!s) return;
    const key = s.where.screen === 'scene' ? 'scene:' + s.scene.key : s.where.screen + ':' + (s.where.place || '');
    if (key !== shown) {
      shown = key; away = false;
      const p = places.find((x) => x.id === s.where.place);
      go(s.where.screen === 'place' ? Place(p) : s.where.screen === 'scene' ? Play(p, s.scene) : s.where.screen === 'rescued' ? Rescued(p) : Planet);
    } else if (!away && K.scene && K.scene.sync) K.scene.sync(s);
    waiting.hidden = s.ready;
    waiting.textContent = `Čekám na ${heroName(mate())}. Hraje se ve dvou, každý na svém telefonu.`;
  }
  function toTitle(note) { Net.leave(); shown = null; away = false; waiting.hidden = true; save.who = null; write(); Title.note = note || ''; go(Title); }
  Net.hear.state = route;
  Net.hear.fx = (m) => { if (K.scene && K.scene.fx) K.scene.fx(m); };
  Net.hear.taken = () => toTitle('Tuhle postavu už hraje někdo jiný.');

  // ---- title: the logo, and who is playing ----
  const Title = {
    t: 0, note: '', timers: [],
    enter() {
      add(`<div class="logo">${esc(WORLD.title).replace(' a ', '<br>a ')}<small>${esc(WORLD.subtitle)}</small></div>`);
      const pick = add(`<div class="pick"><p>${esc(this.note || 'Kdo hraje?')}</p><div>
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
    // Stand-in continents as [west, east, south, north, colour], until the real picture exists.
    const LAND = '#7BBF6A', WOOD = '#5FA85A', SAND = '#E3CB7E', ICE = '#F4F1E8';
    const LANDS = [[-125, -70, 28, 60, LAND], [-162, -125, 55, 70, LAND], [-105, -84, 14, 28, LAND], [-100, -75, 45, 60, WOOD], [-55, -22, 62, 80, ICE],
      [-80, -45, -20, 9, WOOD], [-72, -55, -52, -20, LAND], [-9, 36, 38, 58, LAND], [6, 28, 58, 69, WOOD], [-16, 40, 5, 34, LAND], [-12, 32, 16, 30, SAND],
      [12, 40, -33, 5, LAND], [36, 138, 26, 70, LAND], [60, 130, 50, 68, WOOD], [38, 56, 14, 30, SAND], [70, 88, 8, 26, LAND], [98, 120, 0, 26, WOOD],
      [114, 153, -38, -13, LAND], [120, 142, -30, -20, SAND], [-180, 180, -90, -74, ICE], [-180, 180, 83, 90, ICE]];
    let skin = null, real = false, drawn = null;
    function makeSkin() {
      const c = document.createElement('canvas'); c.width = TW; c.height = TH;
      const g = c.getContext('2d'), img = K.picture(WORLD.planet.bg);
      if (img) { g.drawImage(img, 0, 0, TW, TH); real = true; }
      else {
        const box = (w, e, s, n, col) => { g.fillStyle = col; g.fillRect(Math.round((w + 180) / 360 * TW), Math.round((90 - n) / 180 * TH), Math.round((e - w) / 360 * TW), Math.round((n - s) / 180 * TH)); };
        box(-180, 180, -90, 90, '#2F8FC6');
        const r = K.rng(7); g.fillStyle = '#58AEDC';
        for (let i = 0; i < 90; i++) g.fillRect(Math.floor(r() * TW), 18 + Math.floor(r() * (TH - 36)), 5, 1);
        for (const l of LANDS) box(...l);
      }
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
    let rot = 0, aim = null, t = 0, list = null;
    const TIP = 'Otoč planetou. Klepni na místo.';
    const say = (text) => { const tip = K.ui.querySelector('.tip'); if (tip) tip.textContent = text; };
    const close = () => { if (list) { list.remove(); list = null; say(TIP); } };
    // Travelling takes both of them: the room moves everyone, or says who is still missing.
    const travel = (id) => { if (!st().ready) { beep(180); close(); return say(`Čekám na ${heroName(mate())}.`); } beep(520, 780); Net.send({ type: 'go', place: id }); };
    // Several places share this pin: a short list to pick from, right here on the planet.
    function choose(pin) {
      close(); say('');
      list = add(`<div class="card choose"><h2>${esc(pin.name)}</h2>${behind(pin).map((p) => {
        const state = stateOf(p);
        return `<button class="row${state === 'hraj' ? ' now' : ''}" data-p="${p.id}"${state === 'zamčeno' ? ' disabled' : ''}><span>${places.indexOf(p) + 1}</span><span>${esc(fullName(p))}</span><em>${state}</em></button>`;
      }).join('')}${later(pin).map((p) => `<button class="row later" disabled><span>?</span><span>${esc(fullName(p))}</span><em>brzy</em></button>`).join('')}</div>`);
      list.addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (b && !b.disabled) travel(b.dataset.p); });
    }
    return {
      get rot() { return rot; }, set rot(v) { rot = v; aim = null; },
      where(i) { return spot(pins[i], rot); },
      enter() {
        const bar = add(`<div class="bar"><span>Planeta</span><span><button data-go="album">Album</button><button data-go="title">${esc(heroName())}</button></span></div>`);
        bar.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (!b) return; if (b.dataset.go === 'album') { away = true; go(Album); } else toTitle(); });
        add(`<p class="tip">${TIP}</p>`);
        const lead = pins.find((pin) => pinState(pin) === 'todo') || pins[0];
        aim = lonOf(lead); rot = aim - 1; list = null;            // spin round to the next place to save
        if (!skin || (!real && K.picture(WORLD.planet.bg))) makeSkin();
        draft(WORLD.planet.bg);
      },
      move(x, y, dx) { if (list) return; rot -= dx / R; aim = null; },
      tap(x, y) {
        if (list) return close();
        let hit = null, best = 14;
        for (const pin of pins) { const p = spot(pin, rot), d = Math.hypot(p.x - x, p.y - 6 - y); if (p.seen && d < best) { best = d; hit = pin; } }
        if (!hit) return;
        const state = pinState(hit), ps = behind(hit);
        if (ps.length + later(hit).length > 1) { beep(state === 'soon' ? 440 : 520, 780); return choose(hit); }   // a list, with what opens later shown locked
        if (state === 'soon' || state === 'locked') { const l = later(hit)[0]; beep(180); say(state === 'locked' ? 'Nejdřív dokonči předchozí místo.' : l ? `${fullName(l)} se teprve otevře.` : 'Tohle místo se teprve otevře.'); return; }
        travel(ps[0].id);
      },
      update(dt) {
        t += dt;
        if (aim !== null) { rot += (aim - rot) * Math.min(1, dt * 4); if (Math.abs(aim - rot) < 0.003) { rot = aim; aim = null; } }
        if (!real && K.picture(WORLD.planet.bg)) makeSkin();
      },
      draw() {
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

  // ---- one place: its four scenes as a list. Who is waiting there stays a secret until they are free. ----
  const Place = (place) => ({
    enter() { this.paint(); },
    sync() { this.paint(); },
    paint() {
      K.ui.innerHTML = '';
      const pr = progress(place);
      const bar = add(`<div class="bar"><button data-back>&lt; Planeta</button><span>${esc(fullName(place))}</span></div>`);
      bar.querySelector('[data-back]').addEventListener('click', () => Net.send({ type: 'back' }));
      const head = pr.done ? `Zachráněno: ${place.saves.map((s) => s.name).join(' a ')}` : 'Kdo volá o pomoc?';
      const list = add(`<div class="list"><h2>${esc(head)}</h2>${place.scenes.map((sc, i) => {
        const state = pr.done || i < pr.scene ? 'hotovo' : i === pr.scene ? 'hraj' : 'zamčeno';
        return `<button class="row${state === 'hraj' ? ' now' : ''}" data-i="${i}"${state === 'zamčeno' ? ' disabled' : ''}><span>${i + 1}</span><span>${state === 'zamčeno' ? '???' : esc(sc.name)}</span><em>${state}</em></button>`;
      }).join('')}</div>`);
      list.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b && !b.disabled) { beep(st().ready ? 520 : 180); Net.send({ type: 'open', index: +b.dataset.i }); } });
      draft(place.scenes[0].bg);
    },
    draw() { K.background(place.scenes[0].bg, 0, place.look); rect(0, 0, W, H, 'rgba(43,31,26,.55)'); },
  });

  // ---- playing one scene: the story lines, then the game, then on to the next. The room says which part is on. ----
  const Play = (place, first) => {
    const sc = place.scenes[first.index], who = me();
    let sn = first, was = null, line = -1, box = null, act = null, t = 0, lineAt = 0;
    const speaker = (key) => (key === 'hero' ? heroName() : key ? (place.saves.find((s) => s.id === key) || { name: key }).name : '');
    function paint() {
      if (sn.phase === 'talk' && (was !== 'talk' || line !== sn.line)) {
        if (box) box.remove();
        const [key, text, about] = sc.talk[sn.line], at = sn.line;                 // `about`: someone the line tells of, shown with it
        lineAt = t;
        box = add(`<div class="say">${about ? face(about, 0) : key === 'hero' ? face(who, 0) : key ? face(key, 3) : ''}${key ? `<b>${esc(speaker(key))}</b>` : ''}<p>${esc(text)}</p><i>&gt;</i></div>`);
        box.addEventListener('click', () => { beep(440); Net.send({ type: 'next', line: at }); });        // either of them may tap; the line number stops a double tap skipping one
      }
      if (sn.phase !== 'talk' && box) { box.remove(); box = null; }
      if (sn.phase === 'stub' && was !== 'stub') {
        const card = add(`<div class="card"><h2>${esc(sc.name)}</h2><p>Tahle část se teprve staví.</p><button class="btn">Dál</button></div>`);
        card.querySelector('button').addEventListener('click', () => { beep(520, 660); Net.send({ type: 'done' }); });
      }
      if (sn.phase === 'play' && !act) act = { run: Runner, drums: Drums, shoot: Shoot, echo: Echo, find: Find, salon: Salon, memory: Memory, collect: Collect, rescue: Rescue, tower: Tower }[sc.play](sc, place, sn);
      if (act) act.sync(sn);
      if (act && (sn.phase === 'won' || sn.phase === 'lost') && was !== sn.phase) act.over(sn.phase === 'won');
      was = sn.phase; line = sn.line;
    }
    return {
      enter() {
        const bar = add(`<div class="bar"><button data-back>&lt; ${esc(place.name)}</button><span>${esc(sc.name)}</span></div>`);
        bar.querySelector('[data-back]').addEventListener('click', () => Net.send({ type: 'back' }));
        draft(sc.bg);
        paint();
      },
      sync(s) { sn = s.scene; paint(); },
      fx(m) { if (act && act.fx) act.fx(m); },
      get act() { return act; },
      down(x, y) { if (act && sn.phase === 'play') act.down(x, y); },      // games answer the moment a finger lands, not when it lifts
      move(x, y, dx) { if (act && act.move) act.move(x, y, dx); },
      tap() { if (!act && box) box.click(); },
      update(dt) { t += dt; if (act) act.update(dt); },
      draw() {
        if (act) return act.draw();
        const show = sn.phase === 'talk' && sc.talk[sn.line] && sc.talk[sn.line][3];
        if (show) return memory(show, t - lineAt, t);                         // a picture instead of the scene, for this line of the story
        K.background(sc.bg, 0, place.look);
        const gy = (sc.ground || GROUND) - 10;                                // a little further back, clear of the speech box
        (sc.cast || []).forEach((id, i) => K.figure(id, 146 + i * 26, gy, 'stand', t, true));
        if (mateHere()) K.hero(mate(), 98, gy, 'stand', t + 0.3);
        K.hero(who, 56, gy, 'stand', t);
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
    if (kind === 'ship') {                                              // the refugee ship crossing the ocean after the war
      K.background('australia-sea', u * 18, WORLD.places.find((p) => p.id === 'australia').look, true);
      const x = 18 + u * 9, y = 203 + Math.round(Math.sin(u * 2.2));
      for (let k = 0; k < 4; k++) { const f = (u * 0.7 + k / 4) % 1; if (K.has('voyage', 'smoke')) K.figure('voyage', x - 4 - f * 26, y - 28 - f * 26, 'smoke', 0, false, 0.28 + f * 0.25); }
      if (K.has('voyage', 'ship')) K.figure('voyage', x, y, 'ship', 0, false, 0.5);
      for (let i = 0; i < 2; i++) { const gx = ((u * 26 + i * 110) % 250) - 30; if (K.has('voyage', 'gull1')) K.figure('voyage', gx, 92 + i * 26 + Math.round(Math.sin(u * 3 + i) * 4), Math.floor(u * 4 + i) % 2 ? 'gull1' : 'gull2', 0, false, 0.32); }
      oldPhoto(0, 0, W, H);
    } else if (kind === 'photo') {                                      // his photograph, with his little dog
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
    const hud = add(`<div class="bar">${barHtml}</div>`);
    K.ui.firstElementChild.remove();
    const tip = add(`<p class="tip">${esc(advice)}</p>`);
    return {
      hud, tip,
      end(won, title, text) {
        tip.remove();
        const card = add(`<div class="card"><h2>${esc(title)}</h2><p>${esc(text)}</p><button class="btn">${won ? 'Dál' : 'Znovu'}</button></div>`);
        card.querySelector('button').addEventListener('click', () => { beep(520, 660); Net.send({ type: won ? 'cont' : 'retry' }); });
        beep(...(won ? [520, 660, 780, 1040] : [220, 160]));
      },
    };
  }
  const hearts = (el, n, max) => { el.innerHTML = Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join(''); };
  // Stand-in pictures of the things you can pick up, about 12 pixels across, centred on (x, y).
  function item(kind, x, y) {
    x = Math.round(x); y = Math.round(y);
    rect(x - 9, y - 9, 18, 18, INK); rect(x - 8, y - 8, 16, 16, '#FFF8E7');
    const art = WORLD.items[kind] && WORLD.items[kind].art;
    if (art && K.has(art[0], art[1])) { const sp = K.sprites[art[0]]; return K.figure(art[0], x, y + 7, art[1], 0, false, 14 / Math.max(sp.w, sp.h) * 1.15); }
    if (kind === 'drumstick') { for (let i = 0; i < 8; i++) rect(x - 5 + i, y + 3 - i, 2, 2, '#B98850'); rect(x + 2, y - 6, 4, 4, '#8A5A2B'); }
    else { rect(x - 5, y - 4, 10, 3, '#D2A064'); rect(x - 5, y - 4, 3, 9, '#D2A064'); rect(x + 2, y - 4, 3, 3, '#CC2233'); rect(x - 5, y + 2, 3, 3, '#CC2233'); }
  }

  // The dash: the scene scrolls past, obstacles arrive on a beat, tap to jump. Low things are jumped, high things
  // are ducked by staying on the ground. Both run the same course and share the lives; each jumps for themselves.
  function Runner(sc, place, sn) {
    const cfg = sc.run, SPEED = 86, G = 560, JUMP = 200, X = 50, GY = sc.ground || GROUND, who = me(), max = sn.lives;
    const { obs, pickAt } = Room.course.run(sn.seed, sc);
    const how = sc.pickup && WORLD.items[sc.pickup].use;                    // 'hit' (the drumstick) or 'throw' (the boomerang)
    const s = { t: 0, y: 0, vy: 0, inv: 0, over: false, lost: false, obs, pickAt, asked: false, told: false, sent: 0, mate: { y: 0, vy: 0 },
      throws: 0, fly: null, whack: -9, mateFly: null, how };
    let live = sn, button = null;
    const view = stage('<span class="lives"></span><span class="meter"><i></i></span>', `Klepni a skoč${cfg.high ? '. Pod letící věcí zůstaň dole' : ''}.`);
    const powered = () => how === 'hit' && Net.now() < live.power;
    const paint = () => { hearts(view.hud.firstElementChild, live.lives, max); view.hud.lastElementChild.firstElementChild.style.width = clamp(s.t / cfg.seconds, 0, 1) * 100 + '%'; };
    const runner = (w, x, gy, b, pose) => {
      if (cfg.board) { if (K.has('aussie', 'surfboard')) K.figure('aussie', x, gy - b.y + 4, 'surfboard', 0, false, 0.42); else { rect(x - 12, gy - b.y - 1, 24, 4, INK); rect(x - 11, gy - b.y, 22, 2, '#F2C94C'); } }
      K.hero(w, x, gy - b.y - (cfg.board ? 1 : 0), pose || (b.y > 0 ? 'jump' : cfg.board ? 'surf' : 'run'), Math.max(0, s.t));
    };
    // The boomerang is thrown: it flies ahead at chest height, knocks out the first thing in its way, and comes back.
    function paintButton() { if (button) { button.querySelector('b').textContent = s.throws; button.disabled = !!s.fly || !s.throws; } }
    function giveBoomerang() {
      s.throws = 3;
      button = add('<button class="btn throw"><span>Hoď</span> <b></b></button>');
      button.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); throwIt(); });
      paintButton();
    }
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
      fx(m) { if (m.k === 'jump' && s.mate.y <= 0) s.mate.vy = JUMP; if (m.k === 'throw' && !s.mateFly) s.mateFly = { x: X - 14, y: GY - 31, vx: 190, back: false }; },
      over(won) { s.over = true; s.lost = !won; if (button) button.remove(); paint(); view.end(won, won ? 'Zvládnuto!' : 'Au!', won ? 'Jste na místě.' : 'Zkuste to ještě jednou.'); },
      down() { if (!s.over && s.t > 0 && s.y <= 0) { s.vy = JUMP; beep(520); Net.send({ type: 'fx', k: 'jump' }); if (!s.told) view.tip.textContent = ''; } },
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
          o.hit = true;
          s.inv = 1.1; beep(200, 150); Net.send({ type: 'ev', e: 'hurt' });
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
          const look = cfg.art && cfg.art[o.high ? 'high' : 'low'];
          if (look && K.has(look[0], look[1])) {                                             // drawn obstacles; a second drawing, if there is one, takes turns with the first
            const pose = look.length > 2 && Math.floor(t * 6) % 2 ? look[2] : look[1];
            K.figure(look[0], x, o.high ? GY - 54 : GY + 1, pose, t, false, 0.36);
          }
          else if (o.high) { rect(x - 7, GY - 62, 14, 5, INK); rect(x - 6, GY - 61, 12, 3, '#D2A064'); }
          else { rect(x - 6, GY - 10, 12, 10, INK); rect(x - 5, GY - 9, 10, 9, '#E0862E'); rect(x - 3, GY - 14, 6, 5, INK); rect(x - 2, GY - 13, 4, 4, '#E0862E'); }
        }
        if (pickAt !== null && !live.picked) { const x = X + (pickAt - t) * SPEED; if (x > -12 && x < W + 12) item(sc.pickup, x, GY - 50 + Math.round(Math.sin(t * 5) * 2)); }
        if (mateHere()) runner(mate(), X - 22, GY - 5, s.mate);                                  // a step behind, on the far side
        const swing = powered() && t - s.whack < 0.25;
        if (s.lost) K.hero(who, X, GY, 'dizzy', t);
        else if (!(s.inv > 0 && Math.floor(t * 14) % 2)) runner(who, X, GY, s, swing ? 'drum' : null);
        const left = (live.power - Net.now()) / 1000;
        if (powered() && !swing && (left > 2 || Math.floor(t * 8) % 2)) item(sc.pickup, X, GY - s.y - 66);   // held overhead; blinks when nearly spent
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
    const cfg = sc.drums, FALL = 92, LINE = 220, TOP = 22, WINDOW = 0.2, LANE = W / 3, who = me();
    const PADS = [['#CC2233', 110], ['#FFD43A', 196], ['#3E7BD6', 392]];      // colour and pitch: kick, snare, cymbal
    const { notes, pick } = Room.course.drums(sn.seed, sc), last = notes[notes.length - 1].at;
    const s = { t: 0, over: false, notes, flash: [0, 0, 0], taps: 0, mateTaps: 0, pick, asked: false, told: false, sent: 0 };
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
      fx(m) { if (m.k === 'tap') { s.flash[clamp(m.lane | 0, 0, 2)] = 0.12; s.mateTaps++; } },
      over(won) { s.over = true; paint(); const [a, b] = (sc.say && sc.say.won) || ['To je rytmus!', 'Dveře povolily.']; view.end(won, won ? a : 'Skoro!', won ? b : `Máte ${live.hits} z ${live.need} potřebných. Zkuste to ještě jednou.`); },
      down(x) {
        if (s.over) return;
        const lane = clamp(Math.floor(x / LANE), 0, 2);
        s.flash[lane] = 0.12; s.taps++;
        Net.send({ type: 'fx', k: 'tap', lane });
        if (pick && !live.picked && !s.asked && lane === pick.lane && Math.abs(pick.at - s.t) <= WINDOW + 0.05) {      // caught the pick-up on the line
          s.asked = true; beep(660, 880, 1100); return Net.send({ type: 'ev', e: 'pick' });
        }
        let best = null;
        for (const n of notes) if (n.lane === lane && !n.hit && !n.gone && Math.abs(n.at - s.t) <= WINDOW && (!best || Math.abs(n.at - s.t) < Math.abs(best.at - s.t))) best = n;
        if (best) { best.hit = true; beep(PADS[lane][1], PADS[lane][1] * 2); Net.send({ type: 'ev', e: 'hit', n: powered() ? 2 : 1 }); if (!s.told) view.tip.textContent = ''; }
        else beep(PADS[lane][1]);
      },
      update(dt) {
        if (s.over) return;
        s.t = clock(live);
        for (let i = 0; i < 3; i++) if (s.flash[i] > 0) s.flash[i] -= dt;
        for (const n of notes) if (!n.hit && !n.gone && s.t - n.at > WINDOW) n.gone = true;
        if (s.t > last + 0.9 && Net.now() - s.sent > 1000) { s.sent = Net.now(); Net.send({ type: 'ev', e: 'finish' }); }   // said again each second until the room has heard both
      },
      draw() {
        K.background(sc.bg, 0, place.look);
        const two = mateHere();                                                                // they drum along in the room, a stroke for every tap
        const cast = sc.cast || [], wide = cast.length ? 40 : 22;
        cast.forEach((id, i) => K.figure(id, W / 2 + i * 26, 204, 'act', s.t));                    // Alan drums along
        if (two) K.hero(mate(), W / 2 + wide, 206, 'drum', s.mateTaps / 9, true);
        K.hero(who, two || cast.length ? W / 2 - wide : W / 2, 206, 'drum', s.taps / 9);
        rect(0, TOP, W, H - TOP, 'rgba(43,31,26,.5)');
        for (let i = 1; i < 3; i++) rect(i * LANE - 1, TOP, 2, LINE - TOP, 'rgba(255,248,231,.18)');
        rect(0, LINE - 1, W, 2, '#FFF8E7');
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
    const view = stage('<span class="lives"></span><span class="meter"><i></i></span>', who === 'ken' ? 'Klepni, kam má letět puk.' : 'Klepni, kam má letět králíček nebo hvězda.');
    const paint = () => { hearts(view.hud.firstElementChild, live.lives, max); view.hud.lastElementChild.firstElementChild.style.width = clamp(live.hits / live.need, 0, 1) * 100 + '%'; };
    const tx = (tg) => tg.x + Math.sin(s.t * 2 + tg.phase) * (cfg.sway || 0);
    const up = (tg) => tg.born <= s.t && s.t - tg.born <= cfg.stay && !s.got.has(tg.id) && !live.hit.includes(tg.id) && !live.missed.includes(tg.id);
    const pickAt = () => (sc.pickup && !live.picked && s.t > 2 ? { x: W + 12 - (((s.t - 2) * 24) % (W + 24)), y: 64 + Math.sin(s.t * 3) * 6 } : null);   // drifts across until it is hit
    // One shot from `from` towards (x, y). Only one's own shots can hit anything; the other hero's are for show.
    function fire(w, from, x, y, real, star) {
      const dx = x - from.x, dy = y - from.y, back = live.item === 'boomerang', d = Math.hypot(dx, dy) || 1;
      const kind = w === 'ken' ? 'puck' : star ? 'star' : 'bunny';
      if (kind !== 'bunny' || back) {                                                     // straight and fast; with the boomerang it turns round and comes home
        const v = kind === 'puck' ? 280 : 250;
        s.shots.push({ kind, real, from, x: from.x, y: from.y, vx: dx / d * v, vy: dy / d * v, g: 0, r: kind === 'puck' ? 9 : kind === 'star' ? 10 : 13, turn: back ? s.t + Math.max(0.35, d / v + 0.12) : 0 });
      } else { const T = Math.max(0.4, Math.abs(dx) / 170); s.shots.push({ kind, real, from, x: from.x, y: from.y, vx: dx / T, vy: (dy - 0.5 * G * T * T) / T, g: G, r: 13 }); }
    }
    function shoot(x, y) {
      const star = who === 'kel' && s.thrown++ % 2 === 1;                                 // Kellyn takes turns: bunny, star, bunny, star
      fire(who, mine, x, y, true, star);
      Net.send({ type: 'fx', k: 'shot', x, y, star });                                    // the other device shows it flying to the same spot, from where this hero stands there
    }
    return {
      s, kind: 'shoot', spot: (tg) => ({ x: tx(tg), y: tg.y }), live: () => targets.filter(up), pickAt,
      sync(n) {
        for (const id of n.hit.slice(s.seen)) { const tg = targets[id]; if (tg && !s.got.has(id)) s.pops.push({ x: tx(tg), y: tg.y, at: s.t }); }   // the other one's hits flash too
        s.seen = n.hit.length;
        live = n; paint();
        if (live.item && !s.said) { s.said = true; view.tip.textContent = WORLD.items[live.item].shot; }
      },
      fx(m) { if (m.k === 'shot') { fire(mate(), theirs, m.x, m.y, false, !!m.star); s.mateSwing = 0.25; } },
      over(won) { s.over = true; s.lost = !won; paint(); view.end(won, won ? 'Trefa!' : 'Uteklo vám jich moc.', won ? 'Cesta je volná.' : 'Zkuste to ještě jednou.'); },
      down(x, y) {
        if (s.over || s.cool > 0 || y < 22 || s.t < 0) return;
        shoot(x, y);
        if (live.item === 'drumstick') s.again = { at: s.t + 0.13, x: x + 7, y: y - 7 };       // the drumstick's second beat, a little to one side
        s.cool = 0.3; s.swing = 0.25; beep(who === 'ken' ? 330 : 660); if (!s.said) view.tip.textContent = '';
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
            if (!up(tg) || Math.hypot(tx(tg) - sh.x, tg.y - sh.y) >= sh.r) continue;
            s.got.add(tg.id); s.pops.push({ x: tx(tg), y: tg.y, at: s.t, kind: sh.kind }); beep(780, 1040); Net.send({ type: 'ev', e: 'hit', id: tg.id });
            if (!sh.turn && !sh.home) sh.dead = true;                                     // a boomerang shot carries on through
            break;
          }
          if (sh.x < -10 || sh.x > W + 10 || sh.y < 10 || sh.y > H + 10) { if (sh.turn) sh.turn = s.t; else sh.dead = true; }
        }
        s.shots = s.shots.filter((sh) => !sh.dead);
        for (const tg of targets) {                                                       // the ones that got away: both devices say so, the room counts each once
          if (tg.born > s.t) break;
          if (s.t - tg.born > cfg.stay && !s.told.has(tg.id) && !s.got.has(tg.id) && !live.hit.includes(tg.id) && !live.missed.includes(tg.id)) { s.told.add(tg.id); beep(200, 150); Net.send({ type: 'ev', e: 'miss', id: tg.id }); }
        }
        s.pops = s.pops.filter((q) => s.t - q.at < 0.25);
        paint();
      },
      draw() {
        K.background(sc.bg, 0, place.look);
        for (const tg of targets) {
          if (tg.born > s.t) break;
          if (!up(tg)) continue;
          const x = Math.round(tx(tg)), y = Math.round(tg.y), left = cfg.stay - (s.t - tg.born);
          if (left < 0.9 && Math.floor(s.t * 10) % 2) continue;                              // blinks before it slips away
          if (K.has('prague', 'padlock')) { K.figure('prague', x + Math.round(Math.sin(s.t * 3 + tg.phase)), y + 10, 'padlock', 0, false, 0.36); continue; }
          rect(x - 5, y - 13, 10, 8, '#7A5320'); rect(x - 3, y - 11, 6, 6, place.look.sky);  // a stand-in padlock
          rect(x - 8, y - 6, 16, 13, '#7A5320'); rect(x - 7, y - 5, 14, 11, '#E6B340'); rect(x - 1, y - 2, 2, 5, '#7A5320');
        }
        for (const q of s.pops) {
          const x = Math.round(q.x), y = Math.round(q.y), pose = q.kind === 'bunny' ? 'fluff' : 'flash';
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
    const PADS = [['#CC2233', 147], ['#E0862E', 196], ['#F0448F', 262], ['#3E7BD6', 330]];
    const s = { t: 0, over: false, lost: false, lit: [0, 0, 0, 0], bad: 0, shownAt: 0, sounded: -1, seen: 0, taps: 0, mateTaps: 0, castTaps: 0 };
    let live = sn;
    const view = stage('<span class="lives"></span><span class="meter"><i></i></span>', '');
    view.tip.classList.add('up');
    const mine = (p) => !mateHere() || (p < 2 ? 'ken' : 'kel') === who;
    const listening = () => Net.now() < live.listenAt;
    const paint = () => {
      hearts(view.hud.firstElementChild, live.lives, max);
      view.hud.lastElementChild.firstElementChild.style.width = clamp((live.round + live.step / live.pattern.length) / live.rounds, 0, 1) * 100 + '%';
      if (!s.over) view.tip.textContent = listening() ? 'Poslouchej a dívej se…' : mateHere() ? `Teď vy! Tvoje bubny jsou ${who === 'ken' ? 'vlevo' : 'vpravo'}.` : 'Teď ty!';
    };
    paint();
    return {
      s, kind: 'echo', peek: () => ({ pattern: live.pattern, step: live.step, round: live.round, listening: listening(), mine: [0, 1, 2, 3].filter(mine) }),
      sync(n) {
        if (n.last && n.last.n !== s.seen) {                                           // a stroke, by either of them: show it and sound it
          s.seen = n.last.n; s.lit[n.last.p] = 0.18;
          if (n.last.ok) beep(PADS[n.last.p][1]); else { s.bad = 0.5; beep(160, 120); }
          if ((n.last.p < 2 ? 'ken' : 'kel') === who || !mateHere()) s.taps++; else s.mateTaps++;
        }
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
        s.t += dt; if (s.bad > 0) s.bad -= dt;
        for (let i = 0; i < 4; i++) if (s.lit[i] > 0) s.lit[i] -= dt;
        if (s.over) return;
        // the rhythm being shown: each stroke lights its drum and sounds, on the room's clock so both see it together
        if (live.showAt !== s.shownAt) { s.shownAt = live.showAt; s.sounded = -1; }
        const i = Math.floor((Net.now() - live.showAt) / (live.beat * 1000));
        if (i > s.sounded && i >= 0 && i < live.pattern.length) { s.sounded = i; s.lit[live.pattern[i]] = live.beat * 0.6; beep(PADS[live.pattern[i]][1]); s.castTaps++; }
        paint();
      },
      draw() {
        K.background(sc.bg, 0, place.look);
        const two = mateHere(), cast = sc.cast || [];
        cast.forEach((id, k) => K.figure(id, W / 2 + k * 26, 206 - (s.castTaps % 2) * 2, listening() ? 'act' : 'three', s.t));   // drumming while he shows it, watching while they play
        if (two) K.hero(mate(), W / 2 + 46, 208, 'drum', s.mateTaps / 9, true);
        K.hero(who, W / 2 - 46, 208, s.lost ? 'dizzy' : 'drum', s.taps / 9);
        rect(0, TOP - 14, W, H - TOP + 14, 'rgba(43,31,26,.6)');
        for (let k = 0; k < live.pattern.length; k++) rect(W / 2 - live.pattern.length * 5 + k * 10 + 2, TOP - 10, 6, 6, k < live.step ? '#1FA463' : 'rgba(255,248,231,.35)');   // how much of it is played back
        for (let p = 0; p < 4; p++) {
          const x = p * PW + 3, on = s.lit[p] > 0, own = mine(p), shake = s.bad > 0 ? Math.round(Math.sin(s.t * 60) * 2) : 0;
          rect(x + shake, TOP, PW - 6, 46, INK); rect(x + 2 + shake, TOP + 2 + (on ? 2 : 0), PW - 10, 40, PADS[p][0]);
          rect(x + 7 + shake, TOP + 8 + (on ? 2 : 0), PW - 20, 8, on ? '#FFF8E7' : 'rgba(255,248,231,.4)');
          const kit = ['bassdrum', 'snare', 'snare', 'cymbal'][p];
          if (K.has('strahov', kit)) K.figure('strahov', x + PW / 2 - 3 + shake, TOP + 42 + (on ? 2 : 0), kit, 0, p === 2, 0.5);
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
    const s = { t: 0, over: false, lost: false, off: 0, got: new Set(), sent: 0, miss: null, when: {} };
    let live = sn;
    const view = stage('<span class="count"></span><span class="meter"><i></i></span>', cfg.hidden ? 'Koaly se schovávají ve stromech. Táhni obrázkem a hledej.' : 'Koaly vykukují ze stromů. Klepni na ně, než se schovají.');
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
      over(won) { s.over = true; s.lost = !won; paint(); view.end(won, won ? 'Všechny koaly!' : 'Čas vypršel.', won ? 'Žádná se neschovala.' : `Našli jste ${live.found.length} z ${live.need}. Zkuste to ještě jednou.`); },
      move(x, y, dx) { s.off = clamp(s.off - dx, 0, most()); },
      down(x, y) {
        if (s.over || s.t < 0 || y < 22) return;
        const k = cfg.hidden
          ? koalas.find((q) => !found(q) && Math.abs(q.x - s.off - x) < 9 && y > q.y - 17 && y < q.y + 3)          // hidden ones can be tapped any time: they are just hard to see
          : koalas.find((q) => !found(q) && out(q) && Math.hypot(q.x - s.off - x, q.y - y) < 14);
        if (k) { s.got.add(k.id); s.when[k.id] = s.t; beep(660, 880, 1100); view.tip.textContent = ''; Net.send({ type: 'ev', e: 'find', id: k.id }); }
        else { s.miss = { x, y, at: s.t }; beep(180); }
      },
      update() {
        if (s.over) return;
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
        if (mateHere()) K.hero(mate(), W - 28, GY, 'stand', s.t + 0.3, true);
        K.hero(who, 28, GY, s.lost ? 'dizzy' : 'stand', s.t);
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
    const QX = 14, QY = [214, 236, 258, 280];
    const home = (w) => (w === who ? { x: 96, y: 236 } : { x: 120, y: 250 });
    const s = { t: 0, over: false, lost: false, me: { ...home(who), to: null, go: null, walked: [] }, mate: { ...home(mate()), to: null }, shout: 0, seenNo: {}, no: null };
    let live = sn;
    const view = stage('<span class="lives"></span><span class="clock"></span><span class="meter"><i></i></span>', 'Klepni na zákazníka a pak na místo, kam ho vedeš. Kde stojíš, tam pracuješ.');
    const shout = add('<p class="shout" hidden>NELÍTEJTE!</p>');
    const spot = (i) => ({ x: ST[i].x + 13, y: ST[i].y + 22 });                                 // where a hairdresser stands to work there
    const leading = (w) => live.cust.find((c) => c.by === w);
    const queued = () => live.cust.filter((c) => c.at === -2).sort((a, b) => a.id - b.id);
    const body = (w) => (w === who ? s.me : s.mate);
    function where(c) {                                                                         // where a customer stands right now
      if (c.at >= 0) return { x: ST[c.at].x - 6, y: ST[c.at].y + 4 };
      if (c.by) { const b = body(c.by); return { x: b.x - 12, y: b.y - 2 }; }
      const k = queued().indexOf(c); return { x: QX, y: QY[Math.max(0, k)] };
    }
    const paint = () => {
      hearts(view.hud.firstElementChild, live.lives, max);
      const left = Math.max(0, Math.ceil(cfg.seconds - s.t)); view.hud.children[1].textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      view.hud.lastElementChild.firstElementChild.style.width = clamp(live.served / live.need, 0, 1) * 100 + '%';
    };
    paint();
    function walk(x, y, go) {
      const m = s.me;
      if (live.workers[who] !== null && live.workers[who] !== undefined) Net.send({ type: 'ev', e: 'at', st: -1 });   // leaving one's place
      m.to = { x: clamp(x, 10, W - 10), y: clamp(y, 200, H - 4) }; m.go = go;
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
    function customer(c, x, y) {
      const did = (k) => c.order.indexOf(k) > -1 && c.order.indexOf(k) < c.step;
      const shook = c.no && s.no && s.no.id === c.id && s.t - s.no.at < 0.6 ? Math.round(Math.sin(s.t * 50) * 2) : 0;
      if (K.has('customers', 'c0')) {                                                              // drawn customers: a new hairdo once only paying is left
        const k = c.id % 6, done = c.step >= c.order.length - 1;
        K.figure('customers', x + shook, y, (done ? 'd' : 'c') + k, 0, false, 0.56);
        if (did('wash') && !did('dry')) { rect(x - 8, y - 26, 1, 2, '#7CC6F2'); rect(x + 7, y - 30, 1, 2, '#7CC6F2'); }
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
    function bubble(c, x, y) {                                                                    // what they want next, and how patient they still are
      const k = c.order[c.step], ready = c.at >= 0 && ST[c.at].k !== k, b = ready ? Math.round(Math.abs(Math.sin(s.t * 6)) * 2) : 0;
      x = Math.round(x); y = Math.round(y) - 46 - b;
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
        for (const c of n.cust) if (c.no && c.no !== s.seenNo[c.id]) { s.seenNo[c.id] = c.no; if (c.by === who) { s.no = { id: c.id, at: s.t }; beep(180); view.tip.textContent = `Teď chce ${NAME[c.order[c.step]]}.`; } }
        live = n; paint();
      },
      fx(m) { if (m.k === 'walk') s.mate.to = { x: m.x, y: m.y }; },
      over(won) { s.over = true; s.lost = !won; shout.hidden = true; paint(); view.end(won, won ? 'Salon je prázdný!' : 'Zákazníci utekli.', won ? `Všichni odešli spokojení. V kase je ${live.coins} korun.` : `Obsloužili jste ${live.served} z ${live.need}. Zkuste to ještě jednou.`); },
      down(x, y) {
        if (s.over || s.t < 0 || y < 22) return;
        const mineNow = leading(who);
        if (!mineNow) {                                                                           // a customer to take: one waiting, or one done at a place
          const c = live.cust.filter((q) => !q.by).map((q) => ({ q, p: where(q) })).find(({ p }) => Math.abs(p.x - x) < 9 && y > p.y - 34 && y < p.y + 2);
          if (c) { beep(520); view.tip.textContent = ''; return walk(c.p.x + 12, c.p.y + 2, { take: c.q.id }); }
        }
        const i = ST.findIndex((st) => Math.abs(st.x - x) < 16 && y > st.y - 34 && y < st.y + 28);
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
        if (sc.cast && s.me.walked.reduce((a, [, d]) => a + d, 0) > 170 && s.t - s.shout > 8) { s.shout = s.t; beep(300, 300); }
        shout.hidden = !(s.shout && s.t - s.shout < 2);
        paint();
      },
      draw() {
        K.background(sc.bg, 0, place.look);
        ST.forEach((st, i) => {                                                                   // the places to work, as mats on the floor
          if (K.has('stations', st.k)) K.figure('stations', st.x + 8, st.y + 2, st.k, 0, false, 0.56);
          else { rect(st.x - 13, st.y - 3, 26, 9, INK); rect(st.x - 12, st.y - 2, 24, 7, '#FFF8E7'); icon(st.k, st.x, st.y + 1); }
          const c = live.cust.find((q) => q.at === i);
          if (c && st.k === c.order[c.step]) { const f = clamp(c.work / cfg.work[st.k], 0, 1); rect(st.x - 13, st.y + 8, 26, 4, INK); rect(st.x - 12, st.y + 9, Math.round(24 * f), 2, '#1FA463'); }
        });
        const things = [];                                                                        // everyone on the floor, drawn from the back to the front
        for (const c of live.cust) { const p = where(c); things.push([p.y, () => { customer(c, p.x, p.y); bubble(c, p.x, p.y); }]); }
        if (sc.cast) things.push([250, () => K.figure(sc.cast[0], 176, 250, 'three', s.t, true)]);           // Mamka keeps an eye on things from the side
        if (mateHere()) things.push([s.mate.y, () => K.hero(mate(), s.mate.x, s.mate.y, s.mate.to ? 'run' : live.workers[mate()] !== null ? 'cheer' : 'stand', s.t, s.mate.to ? s.mate.to.x < s.mate.x : false)]);
        things.push([s.me.y, () => K.hero(who, s.me.x, s.me.y, s.lost ? 'dizzy' : s.me.to ? 'run' : live.workers[who] !== null && live.workers[who] !== undefined ? 'cheer' : 'stand', s.t, s.me.to ? s.me.to.x < s.me.x : false)]);
        things.sort((a, b) => a[0] - b[0]).forEach(([, f]) => f());
      },
    };
  }

  // Pexeso: pairs of cards face down on the table. With two playing, one turns the first card over and the other
  // turns the second, looking for its pair; then they swap. A pair stays up; otherwise both turn back over.
  // Too many wrong guesses and the game is lost.
  function Memory(sc, place, sn) {
    const cfg = sc.memory, who = me(), COLS = 4, CW = 40, CH = 50, GAP = 6, X0 = Math.round((W - (COLS * CW + (COLS - 1) * GAP)) / 2), Y0 = 36;
    const s = { t: 0, over: false, lost: false, seenMiss: 0, shake: 0 };
    let live = sn;
    const view = stage('<span class="count"></span><span class="turn"></span>', '');
    const spot = (i) => ({ x: X0 + (i % COLS) * (CW + GAP), y: Y0 + Math.floor(i / COLS) * (CH + GAP) });
    const mine = () => !live.turn || live.turn === who;
    const paint = () => {
      view.hud.firstElementChild.textContent = `Pokusy ${Math.max(0, live.maxMiss - live.misses)}`;
      view.hud.lastElementChild.innerHTML = live.turn ? `${face(live.turn, 3, 1)}<span>${mine() ? 'Otáčíš ty' : 'Otáčí ' + esc(heroName(live.turn))}</span>` : '';
      if (s.over) return;
      const second = live.open.length === 1;
      view.tip.textContent = !live.turn ? 'Otoč dvě kartičky. Najdi dvojici.'
        : mine() ? (second ? 'Teď ty! Otoč druhou kartičku a najdi k ní dvojici.' : 'Otoč první kartičku.')
        : (second ? `${heroName(live.turn)} hledá dvojici. Dívej se a pamatuj si.` : `${heroName(live.turn)} otočí první kartičku, ty pak druhou.`);
    };
    paint();
    return {
      s, kind: 'memory', peek: () => ({ deck: live.deck, open: live.open, done: live.done, mine: mine(), spot }),
      sync(n) { if (n.misses > s.seenMiss) { s.seenMiss = n.misses; s.shake = 0.4; beep(200, 160); } else if (n.done.length > live.done.length) beep(660, 880); live = n; paint(); },
      over(won) { s.over = true; s.lost = !won; paint(); view.end(won, won ? 'Všechny dvojice!' : 'Došly pokusy.', won ? (cfg.won || 'Výborná paměť!') : 'Zkuste to ještě jednou.'); },
      down(x, y) {
        if (s.over || !mine() || live.open.length === 2) return;
        for (let i = 0; i < live.deck.length; i++) {
          const p = spot(i);
          if (x >= p.x && x < p.x + CW && y >= p.y && y < p.y + CH) {
            if (live.done.includes(i) || live.open.includes(i)) return;
            beep(520); return Net.send({ type: 'ev', e: 'flip', i });
          }
        }
      },
      update(dt) { s.t += dt; if (s.shake > 0) s.shake -= dt; },
      draw() {
        K.background(sc.bg, 0, place.look);
        rect(0, 22, W, H - 22, 'rgba(43,31,26,.55)');
        live.deck.forEach((f, i) => {
          const p = spot(i), up = live.done.includes(i) || live.open.includes(i), wrong = live.open.length === 2 && live.open.includes(i) && s.shake > 0;
          const x = p.x + (wrong ? Math.round(Math.sin(s.t * 60) * 2) : 0), y = p.y;
          rect(x, y + 2, CW, CH, 'rgba(43,31,26,.5)');                                         // a little shadow
          if (!up) {                                                                          // the back: a pattern of diamonds
            rect(x, y, CW, CH, '#7A4A22'); rect(x + 1, y + 1, CW - 2, CH - 2, '#CC2233'); rect(x + 3, y + 3, CW - 6, CH - 6, '#E8505E');
            for (let j = 0; j < 4; j++) for (let k = 0; k < 3; k++) rect(x + 7 + k * 10, y + 7 + j * 10 + (k % 2) * 5, 4, 4, '#FFD9A8');
            return;
          }
          const done = live.done.includes(i);
          rect(x, y, CW, CH, done ? '#1FA463' : '#B98850'); rect(x + 1, y + 1, CW - 2, CH - 2, '#FFF8E7');
          const [sheet, pose] = cfg.faces[f], sp = K.sprites[sheet];
          if (sp) K.figure(sheet, x + CW / 2, y + CH - 7, pose, 0, false, Math.min(34 / sp.w, 38 / sp.h));
        });
      },
    };
  }

  // The beach: the waves wash up torn pieces of the message and the odd bottle; run along the sand to pick them up
  // before the sea takes them back. Jellyfish wash up too: running into one stings. Each runs for themselves; what
  // they pick up counts for both.
  function Collect(sc, place, sn) {
    const cfg = sc.collect, who = me(), GY = sc.ground || GROUND, SPEED = 92, IY = GY - 4;
    const items = Room.course.collect(sn.seed, sc);
    const s = { t: 0, over: false, lost: false, me: { x: 60, to: null }, mate: { x: 130, to: null }, sent: 0, asked: new Set(), stungBy: new Set() };
    let live = sn;
    const view = stage('<span class="lives"></span><span class="count"></span><span class="meter"><i></i></span>', 'Klepni, kam běžet. Sbírej kousky vzkazu. Pozor na medúzy!');
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
      fx(m) { if (m.k === 'walk') s.mate.to = m.x; },
      over(won) { s.over = true; s.lost = !won; paint(); view.end(won, won ? 'Celý vzkaz!' : live.lives <= 0 ? 'Au, medúzy!' : 'Moře bylo rychlejší.', won ? (cfg.won || 'Kousky do sebe zapadly.') : `Máte ${live.got.length} z ${live.need}. Zkuste to ještě jednou.`); },
      down(x, y) { if (s.over || s.t < 0 || y < 22) return; s.me.to = clamp(x, 10, W - 10); Net.send({ type: 'fx', k: 'walk', x: s.me.to }); view.tip.textContent = ''; },
      update(dt) {
        if (s.over) return;
        s.t = clock(live);
        for (const b of [s.me, s.mate]) {
          if (b.to === null) continue;
          const d = b.to - b.x, step = SPEED * dt;
          if (Math.abs(d) <= step) { b.x = b.to; b.to = null; } else b.x += Math.sign(d) * step;
        }
        for (const it of items) {
          if (!out(it) || Math.abs(it.x - s.me.x) > 8) continue;
          if (it.kind === 'jelly') { if (!s.stungBy.has(it.id)) { s.stungBy.add(it.id); beep(200, 150); Net.send({ type: 'ev', e: 'sting', id: it.id }); } }
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
        if (mateHere()) K.hero(mate(), s.mate.x, GY + 4, pose(s.mate), s.t + 0.3, flip(s.mate));
        K.hero(who, s.me.x, GY + 6, s.lost ? 'dizzy' : pose(s.me), s.t, flip(s.me));
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
    const view = stage('<span class="lives"></span><span class="count"></span><span class="meter"><i></i></span>', 'Klepni, když je ručička v zeleném. Hoď jim kruh!');
    const meter = (t) => (Math.sin(t * 2.6) + 1) / 2;                                    // swings 0..1
    const pulling = () => live.stage === 'pull';
    const pullT = () => (Net.now() - live.pullAt) / 1000;
    const paint = () => {
      hearts(view.hud.children[0], live.lives, sn.lives);
      view.hud.children[1].textContent = pulling() ? `${Math.min(live.pull, live.needPull)} / ${live.needPull}` : `${live.hits} / ${live.needHits}`;
      view.hud.children[2].firstElementChild.style.width = (pulling() ? clamp(live.pull / live.needPull, 0, 1) : clamp(live.hits / live.needHits, 0, 1)) * 100 + '%';
    };
    paint();
    function launch(list, p, x0) { list.push({ x: x0, y: HY, vx: 20 + 190 * p, vy: -300, done: false }); }
    return {
      s, kind: 'rescue', peek: () => ({ stage: live.stage, meter: meter(s.t), cool: s.cool, pullT: pullT() }),
      sync(n) {
        live = n; paint();
        if (n.stage !== stage0) { stage0 = n.stage; view.tip.textContent = 'Drží se! Klepejte co nejrychleji a táhněte je k molu!'; beep(520, 660, 780); }
      },
      fx(m) { if (m.k === 'buoy') launch(s.mateBuoys, m.p, HX); },                      // the same arc as on their own screen
      over(won) { s.over = true; s.lost = !won; paint(); view.end(won, won ? 'Jsou na molu!' : pulling() ? 'Žralok byl rychlejší!' : 'Došly záchranné kruhy.', won ? 'Žralok odplouvá s prázdnou.' : 'Zkuste to ještě jednou.'); },
      down() {
        if (s.over || s.t < 0) return;
        if (pulling()) { if (pullT() >= 0) { s.taps++; beep(300 + (s.taps % 4) * 40); } return; }
        if (s.cool > 0) return;
        const p = meter(s.t); launch(s.buoys, p, HX); s.cool = 0.9; beep(440, 660);
        Net.send({ type: 'fx', k: 'buoy', p });
      },
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
        if (pulling() && s.taps > s.sentTaps && Net.now() - s.lastSend > 150) { Net.send({ type: 'ev', e: 'pull', n: s.taps - s.sentTaps }); s.sentTaps = s.taps; s.lastSend = Net.now(); }
        paint();
      },
      draw() {
        K.background(sc.bg, 0, place.look);
        const f = pulling() ? clamp(live.pull / live.needPull, 0, 1) : 0;
        // the stranded two: on the rock, then on the raft coming across
        const rx = LAND.x + (60 - LAND.x) * f, ry = LAND.y - 4 + (cfg.jetty - LAND.y + 4) * f;
        if (pulling()) {
          if (K.has('beach', 'raft')) K.figure('beach', rx, ry + 6, 'raft', 0, false, 0.62);
          rect(Math.min(HX + 8, rx), HY + 4, 1, 1, '#000');
          for (let k = 0; k <= 10; k++) { const u = k / 10; rect(Math.round(HX + 8 + (rx - HX - 8) * u), Math.round(HY + (ry - 6 - HY) * u + Math.sin(u * Math.PI) * 6), 2, 1, '#D9C08A'); }   // the rope
        }
        (sc.cast || []).forEach((id, i) => K.figure(id, rx - 10 + i * 20, ry - (pulling() ? 2 : Math.round(Math.abs(Math.sin(s.t * 4 + i * 1.7)) * 4)), pulling() ? 'three' : 'cheer', s.t, true));   // hopping and calling for help, then holding on
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
    const cfg = sc.tower, who = me(), GY = 262, SH = 25, JIB = 30, CABLE = 30, SW = 40;
    const two = () => mateHere(), steers = () => !two() || who === 'ken', drops = () => !two() || who === 'kel';
    const POSES = ['floor', 'plants', 'lights'];
    const s = { t: 0, over: false, lost: false, crane: sn.crane, mateCrane: sn.crane, sent: 0, told: 0, cam: 0, fall: null, seen: 0, spark: null, target: null };
    let live = sn, button = null;
    const view = stage('<span class="lives"></span><span class="count"></span><span class="meter"><i></i></span>', '');
    const crane = () => (steers() ? s.crane : s.mateCrane);
    const hook = () => crane() + Room.course.sway(s.t, live.floors.length - 1);
    const top = () => live.floors[live.floors.length - 1];
    const pose = (i, n) => (i === 0 ? 'lobby' : i === n - 1 ? 'roof' : POSES[i % 3]);
    const paint = () => {
      hearts(view.hud.children[0], live.lives, sn.lives);
      view.hud.children[1].textContent = `${live.floors.length} / ${live.need}`;
      view.hud.children[2].firstElementChild.style.width = clamp(live.floors.length / live.need, 0, 1) * 100 + '%';
    };
    const tip = () => { if (!s.over && !s.seen) view.tip.textContent = !two() ? 'Táhni jeřáb a pusť patro.' : steers() ? `Ty řídíš jeřáb. ${heroName(mate())} pouští patra.` : `Ty pouštíš patra. Jeřáb řídí ${heroName(mate())}.`; };
    view.tip.classList.add('up'); paint(); tip();
    if (drops()) {                                                      // the drop button, for whoever lets the storeys go
      button = add('<button class="btn throw drop">Pusť!</button>');
      button.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); dropIt(); });
    }
    function dropIt() { if (s.over || s.t < 0 || Net.now() < live.busyUntil) return; beep(330); Net.send({ type: 'ev', e: 'drop' }); }
    function steer(x) {
      s.crane = clamp(x, 24, 168);
      const now = Net.now();
      if (now - s.sent > 60) { s.sent = now; Net.send({ type: 'fx', k: 'crane', x: s.crane }); }
      if (now - s.told > 140) { s.told = now; Net.send({ type: 'ev', e: 'crane', x: s.crane }); }
    }
    return {
      s, kind: 'tower',
      peek: () => ({ steers: steers(), drops: drops(), crane: crane(), hook: hook(), top: top(), busy: Net.now() < live.busyUntil, floors: live.floors.length, need: live.need }),
      steerTo: (x) => { s.target = x; },
      sync(n) {
        if (n.last && n.last.n !== s.seen) {                           // a storey has been let go: show it falling
          s.seen = n.last.n; if (!s.over) view.tip.textContent = '';
          s.fall = { x: n.last.x, ok: n.last.ok, perfect: n.last.perfect, at: s.t, i: n.last.ok ? n.floors.length - 1 : -1, from: JIB + CABLE - s.cam };
          beep(...(n.last.ok ? (n.last.perfect ? [660, 880, 1100] : [520, 660]) : [200, 150]));
        }
        if (!steers()) s.mateCrane = n.crane;
        live = n; paint();
      },
      fx(m) { if (m.k === 'crane' && !steers()) s.mateCrane = m.x; },
      over(won) { s.over = true; s.lost = !won; if (button) button.remove(); paint(); view.end(won, won ? 'Dům stojí!' : 'Spadlo to.', won ? 'Sydney má nový mrakodrap.' : 'Zkuste to ještě jednou.'); },
      down(x, y) {
        if (s.over || y < 22) return;
        if (drops() && !steers()) return dropIt();                     // Kellyn: a tap anywhere lets the storey go
        if (steers()) steer(x);                                        // Kendrick: the crane goes where the finger is
      },
      move(x, y) { if (!s.over && steers()) steer(x); },
      update(dt) {
        if (s.over) return;
        s.t = clock(live);
        if (s.target !== null && steers()) { const d = s.target - s.crane; steer(s.crane + clamp(d, -90 * dt, 90 * dt)); if (Math.abs(d) < 0.5) s.target = null; }
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
          if (K.has('storeys', pose(i, n))) K.figure('storeys', x, sy(GY - i * SH), pose(i, n), 0, false, 1);
          else { rect(x - SW / 2, sy(GY - (i + 1) * SH), SW, SH, INK); rect(x - SW / 2 + 1, sy(GY - (i + 1) * SH) + 1, SW - 2, SH - 2, '#E6CFA0'); }
        });
        // the people down on the site, who scroll away as the house rises
        (sc.cast || []).forEach((id, i) => K.figure(id, 160 + i * 18, sy(GY + 4), 'three', s.t, true));
        if (mateHere()) K.hero(mate(), 42, sy(GY + 6), 'stand', s.t + 0.3);
        K.hero(who, 20, sy(GY + 6), s.lost ? 'dizzy' : 'stand', s.t);
        // the crane: its mast on the right, the arm across the top, the trolley, the cable and the hook
        rect(178, JIB, 8, H - JIB, '#B8860B'); for (let y = JIB + 2; y < H; y += 8) { rect(179, y, 6, 1, '#F2C94C'); rect(180 + (y / 8 % 2 ? 0 : 3), y + 2, 1, 4, '#F2C94C'); }
        rect(4, JIB, 188, 5, '#B8860B'); rect(4, JIB + 1, 188, 1, '#F2C94C'); for (let x = 6; x < 190; x += 6) rect(x, JIB + 2, 1, 2, '#F2C94C');
        rect(172, JIB - 9, 18, 9, '#B8860B'); rect(174, JIB - 7, 7, 5, '#BFE3F2');                    // the cabin
        const c = Math.round(crane()), hx = hook(), hy = JIB + CABLE;
        rect(c - 5, JIB + 5, 10, 3, INK);
        for (let k = 0; k <= 10; k++) rect(Math.round(c + (hx - c) * k / 10), Math.round(JIB + 8 + (hy - JIB - 8) * k / 10), 1, 2, '#46536A');
        if (!s.over && Net.now() >= live.busyUntil && live.floors.length < n) {
          const i = live.floors.length;
          rect(Math.round(hx) - 3, hy - 1, 6, 2, INK);
          if (K.has('storeys', pose(i, n))) K.figure('storeys', hx, hy + SH + 1, pose(i, n), 0, false, 1);
          // a faint line straight down, to help aim
          for (let y = hy + SH + 4; y < sy(GY - live.floors.length * SH); y += 6) rect(Math.round(hx), y, 1, 2, 'rgba(255,248,231,.35)');
        }
        // a storey on its way down: onto the house, or past it and off the screen
        if (s.fall) {
          const u = s.t - s.fall.at, i = s.fall.ok ? s.fall.i : live.floors.length;
          const land = s.fall.ok ? sy(GY - i * SH) : H + 60, y0 = s.fall.from + SH + 1 + cam - Math.round(s.cam);
          const y = Math.min(land, y0 + 420 * u * u), x = s.fall.ok ? s.fall.x : s.fall.x + u * 30;
          if (y < land || s.fall.ok) K.figure('storeys', x, y, pose(i, n), 0, false, 1);
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
        const lines = (place.done || []).map(([key, text]) => `<p class="line">${face(key, 1)}<span><strong>${esc((place.saves.find((s) => s.id === key) || { name: key }).name)}:</strong> ${esc(text)}</span></p>`).join('');
        const card = add(`<div class="card top"><h2>Zachráněno!</h2>${lines}<button class="btn">Dál</button></div>`);
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
  const Album = {
    enter() {
      const bar = add('<div class="bar"><button data-back>&lt; Planeta</button><span>Album</span></div>');
      bar.querySelector('[data-back]').addEventListener('click', () => { away = false; shown = null; route(); });
      const people = places.flatMap((p) => p.saves);
      add(`<div class="album">${people.map((s) => {
        const got = st().save.album.includes(s.id), sp = K.sprites[s.id], x = got && sp && sp.extra;
        const pic = x ? `<img alt="" src="assets/sprites/${x.file}" style="width:${x.w / 8}em;height:${x.h / 8}em">` : '';
        const head = got ? face(s.id, 3) || `<span>${esc(s.name.charAt(0))}</span>` : '<span>?</span>';
        return `<div data-got="${got ? 1 : 0}">${head}${got ? esc(s.name) : '???'}${pic}</div>`;
      }).join('')}</div>`);
    },
    draw() { rect(0, 0, W, H, '#3A2F33'); },
  };

  K.net = Net;                                 // for looking in from outside when testing
  go(Title);
  if (save.who) Title.join(save.who);          // back again: straight to one's seat
})();
