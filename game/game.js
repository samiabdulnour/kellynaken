// The game itself: title, world map, a place's four scenes, playing a scene, and the album of rescued people.
// Everything it shows comes from window.WORLD (world.js).
(() => {
  const { W, H, GROUND, ctx, save, write, go, add, esc, rect, beep, clamp } = K;
  const WORLD = window.WORLD;
  const places = WORLD.places.filter((p) => !p.soon);
  const progress = (p) => (save.places[p.id] = save.places[p.id] || { scene: 0, done: false });
  const isOpen = (p) => { const i = places.indexOf(p); return i === 0 || (i > 0 && progress(places[i - 1]).done); };
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
      pick.addEventListener('click', (e) => { const b = e.target.closest('[data-who]'); if (!b) return; save.who = b.dataset.who; write(); beep(520, 660); go(Map); });
      draft('title');
    },
    update(dt) { this.t += dt; },
    draw() {
      K.background('title', 0, { sky: '#1B2A5C', far: '#3A2F5B', far2: '#4A3B6B', ground: '#2B2F38', line: '#46536A' });
      K.hero('ken', 78, GROUND, 'stand', this.t); K.hero('kel', 114, GROUND, 'stand', this.t, true);
    },
  };

  // ---- the world map: drag to look around, tap a pin to travel ----
  const Map = {
    off: 0, t: 0,
    enter() {
      const bar = add(`<div class="bar"><span>Mapa světa</span><span><button data-go="album">Album</button><button data-go="title">${esc(heroName())}</button></span></div>`);
      bar.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go === 'album' ? Album : Title); });
      add('<p class="tip">Táhni mapou. Klepni na místo.</p>');
      const next = places.find((p) => isOpen(p) && !progress(p).done) || places[places.length - 1];
      this.off = clamp(next.pin[0] - W / 2, 0, WORLD.map.width - W);
      draft(WORLD.map.bg);
    },
    move(x, y, dx) { this.off = clamp(this.off - dx, 0, WORLD.map.width - W); },
    tap(x, y) {
      const hit = WORLD.places.find((p) => Math.hypot(p.pin[0] - this.off - x, p.pin[1] - y) < 14);
      if (!hit) return;
      if (hit.soon || !isOpen(hit)) { beep(180); this.say(hit.soon ? 'Tohle místo se teprve otevře.' : 'Nejdřív dokonči předchozí místo.'); return; }
      beep(520, 780); go(Place(hit));
    },
    say(text) { const old = K.ui.querySelector('.tip'); if (old) old.textContent = text; },
    update(dt) { this.t += dt; },
    draw() {
      const off = Math.round(this.off);
      if (K.hasBg(WORLD.map.bg)) { ctx.save(); ctx.translate(-off, 0); K.background(WORLD.map.bg, 0); ctx.restore(); }
      else {                                              // stand-in map: sea with a few blocky lands
        rect(0, 0, W, H, '#1D82B8');
        for (const [x, y, w, h] of [[60, 60, 70, 60], [150, 50, 130, 90], [190, 130, 50, 70], [330, 180, 70, 50], [70, 150, 60, 80], [300, 70, 90, 60]]) rect(x - off, y, w, h, '#7BBF6A');
      }
      for (const p of WORLD.places) {
        const x = p.pin[0] - off, y = p.pin[1], open = !p.soon && isOpen(p), done = open && progress(p).done;
        const bob = open && !done ? Math.round(Math.sin(this.t * 5) * 2) : 0;
        rect(x - 1, y - 2, 2, 8, '#15171C');
        rect(x - 6, y - 14 + bob, 12, 12, '#15171C');
        rect(x - 5, y - 13 + bob, 10, 10, done ? '#1FA463' : open ? '#CC2233' : '#46536A');
        rect(x - 2, y - 10 + bob, 4, 4, open ? '#FFD43A' : '#8A8F9C');
      }
    },
  };

  // ---- one place: its four scenes as a list ----
  const Place = (place) => ({
    enter() {
      const pr = progress(place);
      const bar = add(`<div class="bar"><button data-back>&lt; Mapa</button><span>${esc(place.name)}</span></div>`);
      bar.querySelector('[data-back]').addEventListener('click', () => go(Map));
      const who = place.saves.map((s) => s.name).join(' a ');
      const list = add(`<div class="list"><h2>Zachraň: ${esc(who)}</h2>${place.scenes.map((sc, i) => {
        const state = pr.done || i < pr.scene ? 'hotovo' : i === pr.scene ? 'hraj' : 'zamčeno';
        return `<button class="row${state === 'hraj' ? ' now' : ''}" data-i="${i}"${state === 'zamčeno' ? ' disabled' : ''}><span>${i + 1}</span><span>${esc(sc.name)}</span><em>${state}</em></button>`;
      }).join('')}</div>`);
      list.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b && !b.disabled) { beep(520); go(Play(place, +b.dataset.i)); } });
      draft(place.scenes[0].bg);
    },
    draw() { K.background(place.scenes[0].bg, 0, place.look); rect(0, 0, W, H, 'rgba(21,23,28,.55)'); },
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
    function nextLine() {
      if (box) { box.remove(); box = null; }
      if (!lines.length) return startActivity();
      const [key, text] = lines.shift();
      box = add(`<div class="say">${key ? `<b>${esc(speaker(key))}</b>` : ''}<p>${esc(text)}</p><i>&gt;</i></div>`);
      box.addEventListener('click', () => { beep(440); nextLine(); });
    }
    function startActivity() {
      if (sc.play === 'run') { act = Runner(sc, place, who, finish); return; }
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
      tap() { if (act) act.tap(); else if (box) box.click(); },
      update(dt) { t += dt; if (act) act.update(dt); },
      draw() {
        if (act) return act.draw();
        K.background(sc.bg, 0, place.look);
        K.hero(who, 60, GROUND, 'stand', t);
      },
    };
  };

  // The dash: the scene scrolls past, obstacles arrive on a beat, tap to jump. Low things are jumped,
  // high things are ducked by staying on the ground. Three lives.
  function Runner(sc, place, who, onDone) {
    const cfg = sc.run, SPEED = 86, G = 560, JUMP = 200, X = 46;
    const s = { t: 0, y: 0, vy: 0, lives: 3, inv: 0, over: false, obs: [] };
    const r = K.rng(K.hash(sc.id) + Date.now());
    for (let at = 2.6; at < cfg.seconds - 2; at += 1.15 + r() * 0.95) s.obs.push({ at, high: !!cfg.high && s.obs.length > 1 && r() < 0.28, hit: false });
    const hud = add('<div class="bar"><span class="lives"></span><span class="meter"><i></i></span></div>');
    K.ui.firstElementChild.remove();                      // the scene's own bar makes way for the lives and distance
    const tip = add(`<p class="tip">Klepni a skoč${cfg.high ? '. Pod letící věcí zůstaň dole' : ''}.</p>`);
    const paint = () => { hud.firstElementChild.innerHTML = [0, 1, 2].map((i) => `<i class="${i < s.lives ? 'on' : ''}"></i>`).join(''); hud.lastElementChild.firstElementChild.style.width = clamp(s.t / cfg.seconds, 0, 1) * 100 + '%'; };
    paint();
    const end = (won) => {
      s.over = true; tip.remove();
      const card = add(`<div class="card"><h2>${won ? 'Zvládnuto!' : 'Au!'}</h2><p>${won ? 'Jsi na místě.' : 'Zkus to ještě jednou.'}</p><button class="btn">${won ? 'Dál' : 'Znovu'}</button></div>`);
      card.querySelector('button').addEventListener('click', () => { beep(520, 660); if (won) onDone(); else go(Play(place, place.scenes.indexOf(sc))); });
      beep(...(won ? [520, 660, 780, 1040] : [220, 160]));
    };
    return {
      s,
      tap() { if (!s.over && s.y <= 0) { s.vy = JUMP; beep(520); tip.textContent = ''; } },
      update(dt) {
        if (s.over) return;
        s.t += dt;
        if (s.vy !== 0 || s.y > 0) { s.y += s.vy * dt; s.vy -= G * dt; if (s.y <= 0) { s.y = 0; s.vy = 0; } }
        if (s.inv > 0) s.inv -= dt;
        for (const o of s.obs) {
          if (o.hit || s.inv > 0 || Math.abs((o.at - s.t) * SPEED) > 8) continue;
          if (o.high ? s.y > 12 : s.y < 9) { o.hit = true; s.inv = 1.1; s.lives--; beep(200, 150); if (s.lives <= 0) { paint(); return end(false); } }
        }
        if (s.t >= cfg.seconds) { paint(); return end(true); }
        paint();
      },
      draw() {
        K.background(sc.bg, s.t * SPEED, place.look);
        for (const o of s.obs) {
          const x = Math.round(X + (o.at - s.t) * SPEED);
          if (x < -12 || x > W + 12) continue;
          if (o.high) { rect(x - 7, GROUND - 34, 14, 5, '#15171C'); rect(x - 6, GROUND - 33, 12, 3, '#D2A064'); }
          else { rect(x - 6, GROUND - 10, 12, 10, '#15171C'); rect(x - 5, GROUND - 9, 10, 9, '#46536A'); rect(x - 2, GROUND - 13, 4, 4, '#46536A'); }
        }
        if (!(s.inv > 0 && Math.floor(s.t * 14) % 2)) K.hero(who, X, GROUND - s.y, s.y > 0 ? 'jump' : 'run', s.t);
      },
    };
  }

  // ---- a place is finished: the people are free ----
  const Rescued = (place) => {
    let t = 0;
    return {
      enter() {
        const lines = (place.done || []).map(([key, text]) => `<p><strong>${esc((place.saves.find((s) => s.id === key) || { name: key }).name)}:</strong> ${esc(text)}</p>`).join('');
        const card = add(`<div class="card"><h2>Zachráněno!</h2>${lines}<button class="btn">Na mapu</button></div>`);
        card.querySelector('button').addEventListener('click', () => { beep(520, 660); go(Map); });
        beep(520, 660, 780, 1040);
      },
      update(dt) { t += dt; },
      draw() {
        const sc = place.scenes[place.scenes.length - 1];
        K.background(sc.bg, 0, place.look);
        K.hero(save.who, 60, GROUND - Math.abs(Math.sin(t * 6)) * 6, 'cheer', t);
        place.saves.forEach((sv, i) => { rect(104 + i * 26, GROUND - 26, 12, 26, '#15171C'); rect(105 + i * 26, GROUND - 25, 10, 24, '#FFD43A'); });
      },
    };
  };

  // ---- the album: everyone rescued so far ----
  const Album = {
    enter() {
      const bar = add('<div class="bar"><button data-back>&lt; Mapa</button><span>Album</span></div>');
      bar.querySelector('[data-back]').addEventListener('click', () => go(Map));
      const people = places.flatMap((p) => p.saves);
      add(`<div class="album">${people.map((s) => { const got = save.album.includes(s.id); return `<div data-got="${got ? 1 : 0}"><span>${got ? esc(s.name.charAt(0)) : '?'}</span>${got ? esc(s.name) : '???'}</div>`; }).join('')}</div>`);
    },
    draw() { rect(0, 0, W, H, '#2B2F38'); },
  };

  go(save.who ? Map : Title);
})();
