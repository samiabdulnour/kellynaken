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
    let who = null, state = null, off = null, es = null, room = null, again = 0;
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
        room = r; return r.join(who, mine);
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
    const c = sp.faces, u = f / 8;
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
      }).join('')}</div>`);
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
        if (state === 'soon' || state === 'locked') { beep(180); say(state === 'soon' ? 'Tohle místo se teprve otevře.' : 'Nejdřív dokonči předchozí místo.'); return; }
        if (ps.length > 1) { beep(520, 780); choose(hit); } else travel(ps[0].id);
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
          if (behind(pin).length > 1) { rect(p.x - 2, p.y - 18 + bob, 12, 12, INK); rect(p.x - 1, p.y - 17 + bob, 10, 10, col); }   // a second head behind: several places here
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
    let sn = first, was = null, line = -1, box = null, act = null, t = 0;
    const speaker = (key) => (key === 'hero' ? heroName() : key ? (place.saves.find((s) => s.id === key) || { name: key }).name : '');
    function paint() {
      if (sn.phase === 'talk' && (was !== 'talk' || line !== sn.line)) {
        if (box) box.remove();
        const [key, text] = sc.talk[sn.line], at = sn.line;
        box = add(`<div class="say">${key === 'hero' ? face(who, 0) : ''}${key ? `<b>${esc(speaker(key))}</b>` : ''}<p>${esc(text)}</p><i>&gt;</i></div>`);
        box.addEventListener('click', () => { beep(440); Net.send({ type: 'next', line: at }); });        // either of them may tap; the line number stops a double tap skipping one
      }
      if (sn.phase !== 'talk' && box) { box.remove(); box = null; }
      if (sn.phase === 'stub' && was !== 'stub') {
        const card = add(`<div class="card"><h2>${esc(sc.name)}</h2><p>Tahle část se teprve staví.</p><button class="btn">Dál</button></div>`);
        card.querySelector('button').addEventListener('click', () => { beep(520, 660); Net.send({ type: 'done' }); });
      }
      if (sn.phase === 'play' && !act) act = { run: Runner, drums: Drums, shoot: Shoot }[sc.play](sc, place, sn);
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
      tap() { if (!act && box) box.click(); },
      update(dt) { t += dt; if (act) act.update(dt); },
      draw() {
        if (act) return act.draw();
        K.background(sc.bg, 0, place.look);
        const gy = (sc.ground || GROUND) - 10;                                // a little further back, clear of the speech box
        if (mateHere()) K.hero(mate(), 98, gy, 'stand', t + 0.3);
        K.hero(who, 56, gy, 'stand', t);
      },
    };
  };

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
    rect(x - 8, y - 8, 16, 16, INK); rect(x - 7, y - 7, 14, 14, '#FFF8E7');
    if (kind === 'drumstick') { for (let i = 0; i < 8; i++) rect(x - 5 + i, y + 3 - i, 2, 2, '#B98850'); rect(x + 2, y - 6, 4, 4, '#8A5A2B'); }
    else { rect(x - 5, y - 4, 10, 3, '#D2A064'); rect(x - 5, y - 4, 3, 9, '#D2A064'); rect(x + 2, y - 4, 3, 3, '#CC2233'); rect(x - 5, y + 2, 3, 3, '#CC2233'); }
  }

  // The dash: the scene scrolls past, obstacles arrive on a beat, tap to jump. Low things are jumped, high things
  // are ducked by staying on the ground. Both run the same course and share the lives; each jumps for themselves.
  function Runner(sc, place, sn) {
    const cfg = sc.run, SPEED = 86, G = 560, JUMP = 200, X = 50, GY = sc.ground || GROUND, who = me(), max = sn.lives;
    const { obs, pickAt } = Room.course.run(sn.seed, sc);
    const s = { t: 0, y: 0, vy: 0, inv: 0, over: false, lost: false, obs, pickAt, asked: false, told: false, sent: 0, mate: { y: 0, vy: 0 } };
    let live = sn;
    const view = stage('<span class="lives"></span><span class="meter"><i></i></span>', `Klepni a skoč${cfg.high ? '. Pod letící věcí zůstaň dole' : ''}.`);
    const powered = () => Net.now() < live.power;
    const paint = () => { hearts(view.hud.firstElementChild, live.lives, max); view.hud.lastElementChild.firstElementChild.style.width = clamp(s.t / cfg.seconds, 0, 1) * 100 + '%'; };
    const runner = (w, x, gy, b) => {
      if (cfg.board) { rect(x - 12, gy - b.y - 1, 24, 4, INK); rect(x - 11, gy - b.y, 22, 2, '#F2C94C'); }       // a stand-in surfboard
      K.hero(w, x, gy - b.y - (cfg.board ? 1 : 0), b.y > 0 ? 'jump' : cfg.board ? 'surf' : 'run', Math.max(0, s.t));
    };
    return {
      s, kind: 'run',
      sync(n) {
        live = n; paint();
        if (powered() && !s.told) { s.told = true; view.tip.textContent = WORLD.items[sc.pickup].dash; }
        if (s.told && !powered() && !s.over) view.tip.textContent = '';
      },
      fx(m) { if (m.k === 'jump' && s.mate.y <= 0) s.mate.vy = JUMP; },
      over(won) { s.over = true; s.lost = !won; paint(); view.end(won, won ? 'Zvládnuto!' : 'Au!', won ? 'Jste na místě.' : 'Zkuste to ještě jednou.'); },
      down() { if (!s.over && s.t > 0 && s.y <= 0) { s.vy = JUMP; beep(520); Net.send({ type: 'fx', k: 'jump' }); if (!s.told) view.tip.textContent = ''; } },
      update(dt) {
        if (s.over) return;
        s.t = clock(live);
        for (const b of [s, s.mate]) if (b.vy !== 0 || b.y > 0) { b.y += b.vy * dt; b.vy -= G * dt; if (b.y <= 0) { b.y = 0; b.vy = 0; } }
        if (s.inv > 0) s.inv -= dt;
        if (pickAt !== null && !live.picked && !s.asked && Math.abs((pickAt - s.t) * SPEED) < 11 && s.y > 10) { s.asked = true; beep(660, 880, 1100); Net.send({ type: 'ev', e: 'pick' }); }   // jumped into the pick-up
        for (const o of obs) {
          if (o.hit || s.inv > 0 || Math.abs((o.at - s.t) * SPEED) > 8) continue;
          if (!(o.high ? s.y > 12 : s.y < 9)) continue;
          o.hit = true;
          if (powered()) { o.smashed = s.t; beep(300, 600); continue; }                          // with an item in hand it just breaks
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
          if (o.smashed) { if (t - o.smashed < 0.3) { rect(x - 9, GY - 20, 18, 2, '#FFD43A'); rect(x - 1, GY - 28, 2, 18, '#FFD43A'); } continue; }
          if (o.high) { rect(x - 7, GY - 62, 14, 5, INK); rect(x - 6, GY - 61, 12, 3, '#D2A064'); }
          else { rect(x - 6, GY - 10, 12, 10, INK); rect(x - 5, GY - 9, 10, 9, '#E0862E'); rect(x - 3, GY - 14, 6, 5, INK); rect(x - 2, GY - 13, 4, 4, '#E0862E'); }
        }
        if (pickAt !== null && !live.picked) { const x = X + (pickAt - t) * SPEED; if (x > -12 && x < W + 12) item(sc.pickup, x, GY - 50 + Math.round(Math.sin(t * 5) * 2)); }
        if (mateHere()) runner(mate(), X - 22, GY - 5, s.mate);                                  // a step behind, on the far side
        if (s.lost) K.hero(who, X, GY, 'dizzy', t);
        else if (!(s.inv > 0 && Math.floor(t * 14) % 2)) runner(who, X, GY, s);
        const left = (live.power - Net.now()) / 1000;
        if (left > 0 && (left > 2 || Math.floor(t * 8) % 2)) item(sc.pickup, X, GY - s.y - 66);   // held overhead; blinks when nearly spent
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
      over(won) { s.over = true; paint(); view.end(won, won ? 'To je rytmus!' : 'Skoro!', won ? 'Dveře povolily.' : `Máte ${live.hits} z ${live.need} potřebných. Zkuste to ještě jednou.`); },
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
        if (two) K.hero(mate(), W / 2 + 22, 206, 'drum', s.mateTaps / 9, true);
        K.hero(who, two ? W / 2 - 22 : W / 2, 206, 'drum', s.taps / 9);
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
            s.got.add(tg.id); s.pops.push({ x: tx(tg), y: tg.y, at: s.t }); beep(780, 1040); Net.send({ type: 'ev', e: 'hit', id: tg.id });
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
          rect(x - 5, y - 13, 10, 8, '#7A5320'); rect(x - 3, y - 11, 6, 6, place.look.sky);  // a stand-in padlock
          rect(x - 8, y - 6, 16, 13, '#7A5320'); rect(x - 7, y - 5, 14, 11, '#E6B340'); rect(x - 1, y - 2, 2, 5, '#7A5320');
        }
        for (const q of s.pops) { const x = Math.round(q.x), y = Math.round(q.y); rect(x - 9, y - 1, 18, 2, '#FFD43A'); rect(x - 1, y - 9, 2, 18, '#FFD43A'); rect(x - 4, y - 4, 8, 8, '#FFF8E7'); }
        const p = pickAt(); if (p) item(sc.pickup, p.x, p.y);
        if (live.item) item(live.item, 12, 34);                                             // what they are holding, up in the corner
        // wound up and ready; swinging through for a moment after each shot. Kellyn's hand stays empty while her bunny is in the air.
        const pose = (w, swing, real) => (swing > 0 || (w === 'kel' && s.shots.some((sh) => sh.kind === 'bunny' && sh.real === real)) ? 'shoot' : 'aim');
        if (mateHere()) K.hero(mate(), W - BODY, GY, pose(mate(), s.mateSwing, false), s.t, true);
        K.hero(who, BODY, GY, s.lost ? 'dizzy' : pose(who, s.swing, true), s.t);
        for (const sh of s.shots) {
          const x = Math.round(sh.x), y = Math.round(sh.y);
          if (sh.kind === 'puck') { rect(x - 4, y - 2, 8, 4, INK); rect(x - 3, y - 2, 6, 1, '#7A6F6A'); }
          else if (sh.kind === 'star' && K.sprites.star) K.prop(K.sprites.star, x, y + 4, Math.floor(s.t * 10) % 2);
          else if (K.sprites.bunny) K.prop(K.sprites.bunny, x, y + 11, Math.floor(s.t * 6) % 2);    // the bunny flips over as it flies
          else { rect(x - 5, y - 4, 10, 8, '#D9CFC6'); rect(x - 4, y - 3, 8, 6, '#FFFDF8'); }
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
          if (K.sprites[sv.id]) K.figure(sv.id, 112 + i * 34, gy - Math.abs(Math.sin(t * 6 + 1 + i)) * 3, 'stand', t, true);
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
