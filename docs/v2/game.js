// The game itself: title, the planet, a place's four scenes, playing a scene, and the album of rescued people.
// Everything it shows comes from window.WORLD (world.js).
(() => {
  const { W, H, GROUND, INK, ctx, save, write, go, add, esc, rect, beep, clamp } = K;
  const WORLD = window.WORLD, places = WORLD.places, pins = WORLD.planet.pins;
  const progress = (p) => (save.places[p.id] = save.places[p.id] || { scene: 0, done: false });
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
  const heroName = () => WORLD.heroes[save.who].name;
  const draft = (id) => { if (!K.hasBg(id)) add('<span class="draft">náhradní obrázek</span>'); };

  // ---- title: the logo, and who is playing ----
  const Title = {
    t: 0,
    enter() {
      add(`<div class="logo">${esc(WORLD.title).replace(' a ', '<br>a ')}<small>${esc(WORLD.subtitle)}</small></div>`);
      const pick = add(`<div class="pick"><p>Kdo hraje?</p><div>
        <button class="btn red" data-who="ken">${esc(WORLD.heroes.ken.name)}</button>
        <button class="btn pink" data-who="kel">${esc(WORLD.heroes.kel.name)}</button></div></div>`);
      pick.addEventListener('click', (e) => { const b = e.target.closest('[data-who]'); if (!b) return; save.who = b.dataset.who; write(); beep(520, 660); go(Planet); });
      draft('title');
    },
    update(dt) { this.t += dt; },
    draw() {
      K.background('title', 0, { sky: '#1B2A5C', far: '#3A2F5B', far2: '#4A3B6B', ground: '#3A2F33', line: '#5B4A4E' });
      K.hero('ken', 78, GROUND, 'stand', this.t); K.hero('kel', 114, GROUND, 'stand', this.t, true);
    },
  };

  // ---- the planet: drag to spin it, tap a pin to travel ----
  // The world picture (384 x 192, the whole Earth laid flat) is wrapped around a ball. Pins sit at [longitude, latitude].
  const Planet = (() => {
    const R = 84, CX = 96, CY = 150, TW = 384, TH = 192, D = 2 * R + 3, MID = R + 1, TAU = Math.PI * 2, RAD = Math.PI / 180;
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
    // Where a pin is on the screen right now, and whether it is on the side facing us.
    const spot = (pin, rot) => {
      const lat = pin.at[1] * RAD, dl = pin.at[0] * RAD - rot, z = Math.cos(lat) * Math.cos(dl);
      return { x: Math.round(CX + Math.cos(lat) * Math.sin(dl) * R), y: Math.round(CY - Math.sin(lat) * R), seen: z > 0.18 };
    };
    const stars = (() => { const r = K.rng(11); return Array.from({ length: 46 }, () => [Math.floor(r() * W), 22 + Math.floor(r() * (H - 22)), r() * 6]); })();
    let rot = 0, aim = null, t = 0, list = null;
    const TIP = 'Otoč planetou. Klepni na místo.';
    const say = (text) => { const tip = K.ui.querySelector('.tip'); if (tip) tip.textContent = text; };
    const close = () => { if (list) { list.remove(); list = null; say(TIP); } };
    // Several places share this pin: a short list to pick from, right here on the planet.
    function choose(pin) {
      close(); say('');
      list = add(`<div class="card choose"><h2>${esc(pin.name)}</h2>${behind(pin).map((p) => {
        const state = stateOf(p);
        return `<button class="row${state === 'hraj' ? ' now' : ''}" data-p="${p.id}"${state === 'zamčeno' ? ' disabled' : ''}><span>${places.indexOf(p) + 1}</span><span>${esc(fullName(p))}</span><em>${state}</em></button>`;
      }).join('')}</div>`);
      list.addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (b && !b.disabled) { beep(520, 780); go(Place(places.find((p) => p.id === b.dataset.p))); } });
    }
    return {
      get rot() { return rot; }, set rot(v) { rot = v; aim = null; },
      where(i) { return spot(pins[i], rot); },
      enter() {
        const bar = add(`<div class="bar"><span>Planeta</span><span><button data-go="album">Album</button><button data-go="title">${esc(heroName())}</button></span></div>`);
        bar.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go === 'album' ? Album : Title); });
        add(`<p class="tip">${TIP}</p>`);
        const lead = pins.find((pin) => pinState(pin) === 'todo') || pins[0];
        aim = lead.at[0] * RAD; rot = aim - 1; list = null;       // spin round to the next place to save
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
        beep(520, 780);
        if (ps.length > 1) choose(hit); else go(Place(ps[0]));
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
    enter() {
      const pr = progress(place);
      const bar = add(`<div class="bar"><button data-back>&lt; Planeta</button><span>${esc(fullName(place))}</span></div>`);
      bar.querySelector('[data-back]').addEventListener('click', () => go(Planet));
      const head = pr.done ? `Zachráněno: ${place.saves.map((s) => s.name).join(' a ')}` : 'Kdo volá o pomoc?';
      const list = add(`<div class="list"><h2>${esc(head)}</h2>${place.scenes.map((sc, i) => {
        const state = pr.done || i < pr.scene ? 'hotovo' : i === pr.scene ? 'hraj' : 'zamčeno';
        return `<button class="row${state === 'hraj' ? ' now' : ''}" data-i="${i}"${state === 'zamčeno' ? ' disabled' : ''}><span>${i + 1}</span><span>${state === 'zamčeno' ? '???' : esc(sc.name)}</span><em>${state}</em></button>`;
      }).join('')}</div>`);
      list.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b && !b.disabled) { beep(520); go(Play(place, +b.dataset.i)); } });
      draft(place.scenes[0].bg);
    },
    draw() { K.background(place.scenes[0].bg, 0, place.look); rect(0, 0, W, H, 'rgba(43,31,26,.55)'); },
  });

  // ---- playing one scene: the story lines, then the activity, then on to the next ----
  const Play = (place, index) => {
    const sc = place.scenes[index], who = save.who;
    let lines = (sc.talk || []).slice(), box = null, act = null, t = 0;
    const speaker = (key) => (key === 'hero' ? heroName() : key ? (place.saves.find((s) => s.id === key) || { name: key }).name : '');
    const finish = () => {
      const pr = progress(place);
      if (!pr.done && index >= pr.scene) pr.scene = index + 1;
      if (pr.scene >= place.scenes.length && !pr.done) {
        pr.done = true;
        for (const s of place.saves) if (!save.album.includes(s.id)) save.album.push(s.id);
        write(); return go(Rescued(place));
      }
      write(); go(Place(place));
    };
    const again = () => go(Play(place, index));
    function nextLine() {
      if (box) { box.remove(); box = null; }
      if (!lines.length) return startActivity();
      const [key, text] = lines.shift();
      box = add(`<div class="say">${key ? `<b>${esc(speaker(key))}</b>` : ''}<p>${esc(text)}</p><i>&gt;</i></div>`);
      box.addEventListener('click', () => { beep(440); nextLine(); });
    }
    function startActivity() {
      const game = { run: Runner, drums: Drums, shoot: Shoot }[sc.play];
      if (game) { act = game(sc, place, who, finish, again); return; }
      const card = add(`<div class="card"><h2>${esc(sc.name)}</h2><p>Tahle část se teprve staví.</p><button class="btn">Dál</button></div>`);
      card.querySelector('button').addEventListener('click', () => { beep(520, 660); finish(); });
    }
    return {
      enter() {
        const bar = add(`<div class="bar"><button data-back>&lt; ${esc(place.name)}</button><span>${esc(sc.name)}</span></div>`);
        bar.querySelector('[data-back]').addEventListener('click', () => go(Place(place)));
        draft(sc.bg);
        nextLine();
      },
      get act() { return act; },
      down(x, y) { if (act) act.down(x, y); },             // games answer the moment a finger lands, not when it lifts
      tap() { if (!act && box) box.click(); },
      update(dt) { t += dt; if (act) act.update(dt); },
      draw() {
        if (act) return act.draw();
        K.background(sc.bg, 0, place.look);
        K.hero(who, 60, GROUND, 'stand', t);
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
      end(won, title, text, onDone, again) {
        tip.remove();
        const card = add(`<div class="card"><h2>${esc(title)}</h2><p>${esc(text)}</p><button class="btn">${won ? 'Dál' : 'Znovu'}</button></div>`);
        card.querySelector('button').addEventListener('click', () => { beep(520, 660); (won ? onDone : again)(); });
        beep(...(won ? [520, 660, 780, 1040] : [220, 160]));
      },
    };
  }
  const hearts = (el, n) => { el.innerHTML = [0, 1, 2].map((i) => `<i class="${i < n ? 'on' : ''}"></i>`).join(''); };

  // The dash: the scene scrolls past, obstacles arrive on a beat, tap to jump. Low things are jumped,
  // high things are ducked by staying on the ground. Three lives.
  function Runner(sc, place, who, onDone, again) {
    const cfg = sc.run, SPEED = 86, G = 560, JUMP = 200, X = 46;
    const s = { t: 0, y: 0, vy: 0, lives: 3, inv: 0, over: false, obs: [] };
    const r = K.rng(K.hash(sc.id) + Date.now());
    for (let at = 2.6; at < cfg.seconds - 2; at += 1.15 + r() * 0.95) s.obs.push({ at, high: !!cfg.high && s.obs.length > 1 && r() < 0.28, hit: false });
    const st = stage('<span class="lives"></span><span class="meter"><i></i></span>', `Klepni a skoč${cfg.high ? '. Pod letící věcí zůstaň dole' : ''}.`);
    const paint = () => { hearts(st.hud.firstElementChild, s.lives); st.hud.lastElementChild.firstElementChild.style.width = clamp(s.t / cfg.seconds, 0, 1) * 100 + '%'; };
    paint();
    const end = (won) => { s.over = true; paint(); st.end(won, won ? 'Zvládnuto!' : 'Au!', won ? 'Jsi na místě.' : 'Zkus to ještě jednou.', onDone, again); };
    return {
      s, kind: 'run',
      down() { if (!s.over && s.y <= 0) { s.vy = JUMP; beep(520); st.tip.textContent = ''; } },
      update(dt) {
        if (s.over) return;
        s.t += dt;
        if (s.vy !== 0 || s.y > 0) { s.y += s.vy * dt; s.vy -= G * dt; if (s.y <= 0) { s.y = 0; s.vy = 0; } }
        if (s.inv > 0) s.inv -= dt;
        for (const o of s.obs) {
          if (o.hit || s.inv > 0 || Math.abs((o.at - s.t) * SPEED) > 8) continue;
          if (o.high ? s.y > 12 : s.y < 9) { o.hit = true; s.inv = 1.1; s.lives--; beep(200, 150); if (s.lives <= 0) return end(false); }
        }
        if (s.t >= cfg.seconds) return end(true);
        paint();
      },
      draw() {
        K.background(sc.bg, s.t * SPEED, place.look);
        for (const o of s.obs) {
          const x = Math.round(X + (o.at - s.t) * SPEED);
          if (x < -12 || x > W + 12) continue;
          if (o.high) { rect(x - 7, GROUND - 38, 14, 5, INK); rect(x - 6, GROUND - 37, 12, 3, '#D2A064'); }
          else { rect(x - 6, GROUND - 10, 12, 10, INK); rect(x - 5, GROUND - 9, 10, 9, '#8A7F7A'); rect(x - 2, GROUND - 13, 4, 4, '#8A7F7A'); }
        }
        if (!(s.inv > 0 && Math.floor(s.t * 14) % 2)) K.hero(who, X, GROUND - s.y, s.y > 0 ? 'jump' : 'run', s.t);
      },
    };
  }

  // The drums: notes fall down three lanes in time with the beat. Tap a lane's drum as its note reaches the line.
  // Nothing is lost for a miss; the song just has to end with enough notes caught.
  function Drums(sc, place, who, onDone, again) {
    const cfg = sc.drums, BEAT = 60 / cfg.bpm, FALL = 92, LINE = 220, TOP = 22, WINDOW = 0.2, LANE = W / 3;
    const PADS = [['#CC2233', 110], ['#FFD43A', 196], ['#3E7BD6', 392]];      // colour and pitch: kick, snare, cymbal
    const r = K.rng(K.hash(sc.id) + Date.now()), notes = [];
    for (let b = 0; b < cfg.beats; b++) {
      const at = 2.6 + b * BEAT;
      if (b % 2 === 0 || r() < 0.8) notes.push({ at, lane: b % 4 === 0 ? 0 : b % 2 ? 1 : r() < 0.5 ? 0 : 2, hit: false, gone: false });
      if (b > 7 && r() < 0.22) notes.push({ at: at + BEAT / 2, lane: 2, hit: false, gone: false });
    }
    const need = Math.ceil(notes.length * (cfg.pass || 0.6)), last = notes[notes.length - 1].at;
    const s = { t: 0, hits: 0, need, over: false, notes, flash: [0, 0, 0] };
    const st = stage('<span class="count"></span><span class="meter"><i></i></span>', 'Klepni na buben, až je nota na čáře.');
    st.tip.classList.add('up');
    const paint = () => { st.hud.firstElementChild.textContent = `${s.hits} / ${need}`; st.hud.lastElementChild.firstElementChild.style.width = clamp(s.hits / need, 0, 1) * 100 + '%'; };
    paint();
    return {
      s, kind: 'drums',
      down(x) {
        if (s.over) return;
        const lane = clamp(Math.floor(x / LANE), 0, 2);
        s.flash[lane] = 0.12;
        let best = null;
        for (const n of notes) if (n.lane === lane && !n.hit && !n.gone && Math.abs(n.at - s.t) <= WINDOW && (!best || Math.abs(n.at - s.t) < Math.abs(best.at - s.t))) best = n;
        if (best) { best.hit = true; s.hits++; beep(PADS[lane][1], PADS[lane][1] * 2); st.tip.textContent = ''; paint(); }
        else beep(PADS[lane][1]);
      },
      update(dt) {
        if (s.over) return;
        s.t += dt;
        for (let i = 0; i < 3; i++) if (s.flash[i] > 0) s.flash[i] -= dt;
        for (const n of notes) if (!n.hit && !n.gone && s.t - n.at > WINDOW) n.gone = true;
        if (s.t > last + 0.9) {
          s.over = true; const won = s.hits >= need;
          st.end(won, won ? 'To je rytmus!' : 'Skoro!', won ? 'Dveře povolily.' : `Máš ${s.hits} z ${need} potřebných. Zkus to ještě jednou.`, onDone, again);
        }
      },
      draw() {
        K.background(sc.bg, 0, place.look);
        rect(0, TOP, W, H - TOP, 'rgba(43,31,26,.55)');
        for (let i = 1; i < 3; i++) rect(i * LANE - 1, TOP, 2, LINE - TOP, 'rgba(255,248,231,.18)');
        rect(0, LINE - 1, W, 2, '#FFF8E7');
        for (const n of notes) {
          if (n.hit) continue;
          const y = Math.round(LINE - (n.at - s.t) * FALL), x = n.lane * LANE + LANE / 2;
          if (y < TOP + 6 || y > H) continue;
          rect(x - 15, y - 5, 30, 10, INK); rect(x - 14, y - 4, 28, 8, n.gone ? '#7A6F6A' : PADS[n.lane][0]); rect(x - 12, y - 3, 24, 2, n.gone ? '#8A7F7A' : '#FFF8E7');
        }
        for (let i = 0; i < 3; i++) {                      // the three drums along the bottom
          const x = i * LANE + 4, on = s.flash[i] > 0;
          rect(x, 236, LANE - 8, 44, INK); rect(x + 2, 238 + (on ? 2 : 0), LANE - 12, 38, PADS[i][0]);
          rect(x + 8, 244 + (on ? 2 : 0), LANE - 24, 8, on ? '#FFF8E7' : 'rgba(255,248,231,.45)');
        }
      },
    };
  }

  // The shot: targets pop up around the scene and slip away again after a moment. Tap where the shot should go.
  // Kendrick fires a puck with his hockey stick, flat and fast. Kellyn lobs her white bunny in an arc: slower,
  // but fluffier, so it catches things a puck would just miss. Three targets may get away.
  function Shoot(sc, place, who, onDone, again) {
    const cfg = sc.shoot, puck = who === 'ken', HX = 30, HY = GROUND - 14, G = 420;
    const s = { t: 0, hits: 0, lives: 3, over: false, targets: [], shots: [], next: 1.2, cool: 0, swing: 0 };
    const r = K.rng(K.hash(sc.id) + Date.now());
    const st = stage('<span class="lives"></span><span class="meter"><i></i></span>', puck ? 'Klepni, kam má letět puk.' : 'Klepni, kam má letět králíček.');
    const paint = () => { hearts(st.hud.firstElementChild, s.lives); st.hud.lastElementChild.firstElementChild.style.width = clamp(s.hits / cfg.need, 0, 1) * 100 + '%'; };
    paint();
    const tx = (tg) => tg.x + Math.sin(s.t * 2 + tg.phase) * (cfg.sway || 0);
    const end = (won) => { s.over = true; paint(); st.end(won, won ? 'Trefa!' : 'Uteklo ti jich moc.', won ? 'Cesta je volná.' : 'Zkus to ještě jednou.', onDone, again); };
    return {
      s, kind: 'shoot', spot: (tg) => ({ x: tx(tg), y: tg.y }),
      down(x, y) {
        if (s.over || s.cool > 0 || y < 22) return;
        const dx = x - HX, dy = y - HY;
        if (puck) { const d = Math.hypot(dx, dy) || 1; s.shots.push({ x: HX, y: HY, vx: dx / d * 280, vy: dy / d * 280, g: 0, r: 9 }); }
        else { const T = Math.max(0.4, Math.abs(dx) / 170); s.shots.push({ x: HX, y: HY, vx: dx / T, vy: (dy - 0.5 * G * T * T) / T, g: G, r: 13 }); }
        s.cool = 0.3; s.swing = 0.2; beep(puck ? 330 : 660); st.tip.textContent = '';
      },
      update(dt) {
        if (s.over) return;
        s.t += dt; s.cool -= dt; s.swing -= dt;
        if (s.t >= s.next) { s.targets.push({ x: 74 + r() * 100, y: 56 + r() * 130, born: s.t, phase: r() * 6, hit: 0, gone: false }); s.next = s.t + cfg.every * (0.8 + r() * 0.4); }
        for (const sh of s.shots) {
          sh.x += sh.vx * dt; sh.vy += sh.g * dt; sh.y += sh.vy * dt;
          for (const tg of s.targets) if (!tg.hit && Math.hypot(tx(tg) - sh.x, tg.y - sh.y) < sh.r) { tg.hit = s.t; sh.dead = true; s.hits++; beep(780, 1040); break; }
          if (sh.x < -10 || sh.x > W + 10 || sh.y < 10 || sh.y > H + 10) sh.dead = true;
        }
        s.shots = s.shots.filter((sh) => !sh.dead);
        for (const tg of s.targets) if (!tg.hit && s.t - tg.born > cfg.stay) { tg.gone = true; s.lives--; beep(200, 150); }
        s.targets = s.targets.filter((tg) => !tg.gone && !(tg.hit && s.t - tg.hit > 0.25));
        if (s.hits >= cfg.need) return end(true);
        if (s.lives <= 0) return end(false);
        paint();
      },
      draw() {
        K.background(sc.bg, 0, place.look);
        for (const tg of s.targets) {
          const x = Math.round(tx(tg)), y = Math.round(tg.y), left = cfg.stay - (s.t - tg.born);
          if (tg.hit) { rect(x - 9, y - 1, 18, 2, '#FFD43A'); rect(x - 1, y - 9, 2, 18, '#FFD43A'); rect(x - 4, y - 4, 8, 8, '#FFF8E7'); continue; }
          if (left < 0.9 && Math.floor(s.t * 10) % 2) continue;                              // blinks before it slips away
          rect(x - 5, y - 13, 10, 8, '#7A5320'); rect(x - 3, y - 11, 6, 6, place.look.sky);  // a stand-in padlock
          rect(x - 8, y - 6, 16, 13, '#7A5320'); rect(x - 7, y - 5, 14, 11, '#E6B340'); rect(x - 1, y - 2, 2, 5, '#7A5320');
        }
        K.hero(who, HX - 8, GROUND, s.swing > 0 ? 'cheer' : 'stand', s.t);
        if (puck) { const up = s.swing > 0; rect(HX + 1, GROUND - (up ? 22 : 14), 2, 12, '#B98850'); rect(HX + 1, GROUND - (up ? 12 : 3), 7, 2, '#B98850'); }   // hockey stick
        for (const sh of s.shots) {
          const x = Math.round(sh.x), y = Math.round(sh.y);
          if (puck) { rect(x - 4, y - 2, 8, 4, INK); rect(x - 3, y - 2, 6, 1, '#7A6F6A'); }
          else {                                                                             // the bunny tumbles as it flies
            const flip = Math.floor(s.t * 10) % 2 ? 1 : -1;
            rect(x - 5, y - 4, 10, 8, '#D9CFC6'); rect(x - 4, y - 3, 8, 6, '#FFFDF8');
            rect(x - 3, y - 4 * flip - (flip > 0 ? 5 : -4), 2, 5, '#FFFDF8'); rect(x + 1, y - 4 * flip - (flip > 0 ? 5 : -4), 2, 5, '#FFFDF8');
            rect(x + 1, y - 1, 1, 1, INK);
          }
        }
      },
    };
  }

  // ---- a place is finished: the people are free, and now they can be named ----
  const Rescued = (place) => {
    let t = 0;
    return {
      enter() {
        const lines = (place.done || []).map(([key, text]) => `<p><strong>${esc((place.saves.find((s) => s.id === key) || { name: key }).name)}:</strong> ${esc(text)}</p>`).join('');
        const card = add(`<div class="card"><h2>Zachráněno!</h2>${lines}<button class="btn">Dál</button></div>`);
        card.querySelector('button').addEventListener('click', () => { beep(520, 660); go(Planet); });
        beep(520, 660, 780, 1040);
      },
      update(dt) { t += dt; },
      draw() {
        const sc = place.scenes[place.scenes.length - 1];
        K.background(sc.bg, 0, place.look);
        K.hero(save.who, 60, GROUND - Math.abs(Math.sin(t * 6)) * 6, 'cheer', t);
        place.saves.forEach((sv, i) => { rect(104 + i * 26, GROUND - 30, 12, 30, INK); rect(105 + i * 26, GROUND - 29, 10, 28, '#FFD43A'); });
      },
    };
  };

  // ---- the album: everyone rescued so far ----
  const Album = {
    enter() {
      const bar = add('<div class="bar"><button data-back>&lt; Planeta</button><span>Album</span></div>');
      bar.querySelector('[data-back]').addEventListener('click', () => go(Planet));
      const people = places.flatMap((p) => p.saves);
      add(`<div class="album">${people.map((s) => { const got = save.album.includes(s.id); return `<div data-got="${got ? 1 : 0}"><span>${got ? esc(s.name.charAt(0)) : '?'}</span>${got ? esc(s.name) : '???'}</div>`; }).join('')}</div>`);
    },
    draw() { rect(0, 0, W, H, '#3A2F33'); },
  };

  go(save.who ? Planet : Title);
})();
