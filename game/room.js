// The rules of a game session, shared by the server and the page.
//
// The game is always played by the two of them together, each on their own device. One room holds what they share:
// who is here, how far they have got, where they are, and the scene being played. Each device shows its own hero
// and reports what happens to it; the room counts lives and hits and decides when a scene is won or lost.
// On the server this file runs for real (server.mjs). With ?solo in the address the page runs it by itself,
// for trying things out on one device.
//
// Messages a device sends:
//   zoom {to}           go to another map: 'planet', 'map' (Czechia) or a region ('praha', 'australia')
//   play {place, index} start a level from its pin on a region's map
//   next                the next line of the story               done             leave a scene that has no game yet
//   ev {e, ...}         something that counts: hurt, hit, miss, pick, finish, pad, find, flip, grab, sting, pull, crane, drop
//   fx {...}            something only to show on the other device (a jump, a shot, a drum tap)
//   cont / retry        after a scene is won / lost              home             back to the map after a rescue
//   back                up one level: from a level to its map, from a region's map to the map around it
// The room answers everyone with its whole state after every change.
(function (root) {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rng = (seed) => { let s = (seed >>> 0) || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

  // What a scene throws at the players, made from a seed so both devices get exactly the same.
  const course = {
    run(seed, sc) {
      const cfg = sc.run, r = rng(seed), obs = [], pickAt = sc.pickup ? cfg.seconds * 0.3 : null;
      for (let at = 2.6; at < cfg.seconds - 2; at += 1.15 + r() * 0.95) {
        const high = !!cfg.high && obs.length > 1 && r() < 0.28;
        if (pickAt !== null && Math.abs(at - pickAt) < 0.9) continue;                 // keep the way to the pick-up clear
        obs.push({ at, high });
      }
      return { obs, pickAt };
    },
    drums(seed, sc) {
      const cfg = sc.drums, beat = 60 / cfg.bpm, r = rng(seed), notes = [];
      for (let b = 0; b < cfg.beats; b++) {
        const at = 2.6 + b * beat;
        if (b % 2 === 0 || r() < 0.8) notes.push({ at, lane: b % 4 === 0 ? 0 : b % 2 ? 1 : r() < 0.5 ? 0 : 2 });
        if (b > 7 && r() < (cfg.busy || 0.22)) notes.push({ at: at + beat / 2, lane: cfg.busy ? Math.floor(r() * 3) : 2 });   // off-beat notes: more of them, anywhere, in a busier song
      }
      // the pick-up falls down the middle lane between two beats, about a third of the way into the song
      return { notes, beat, pick: sc.pickup ? { lane: 1, at: 2.6 + (Math.floor(cfg.beats * 0.3) + 0.5) * beat } : null };
    },
    // Koalas in the trees: which of the scene's hiding places are used, and when each one peeks out.
    find(seed, sc) {
      const cfg = sc.find, r = rng(seed), spots = cfg.spots.map((at, i) => ({ at, i, k: r() })).sort((a, b) => a.k - b.k).slice(0, cfg.need);
      return { koalas: spots.map((sp, id) => ({ id, x: sp.at[0], y: sp.at[1], pose: sp.at[2] || 'side', first: 1.5 + r() * cfg.every[1], period: cfg.every[0] + r() * (cfg.every[1] - cfg.every[0]) })) };
    },
    // Who comes into the salon and when: what each wants done, in order, and how they look.
    salon(seed, sc, two) {
      const cfg = sc.salon, r = rng(seed), list = [];
      const HAIR = ['#3B2A20', '#7A4A22', '#C99A5B', '#E2C27A', '#2B2F38', '#8A8F9C'], SHIRT = ['#3E7BD6', '#1FA463', '#E0862E', '#8E5BC8', '#CC2233', '#2FA7A0'], DYE = ['#F0448F', '#8E5BC8', '#2FA7A0', '#E0862E'];
      for (let id = 0, at = 1; id < 40; id++) {
        const order = cfg.orders[id < 2 ? id : Math.floor(r() * cfg.orders.length)];        // the first two are easy ones, to learn on
        list.push({ id, arrive: at, order, hair: HAIR[Math.floor(r() * HAIR.length)], shirt: SHIRT[Math.floor(r() * SHIRT.length)], dye: DYE[Math.floor(r() * DYE.length)], long: r() < 0.5 });
        at += (cfg.every[0] + r() * (cfg.every[1] - cfg.every[0])) / (two ? 1.45 : 1);
      }
      return list;
    },
    // Pexeso: the cards on the table, face down, in a shuffled order.
    memory(seed, sc) {
      const r = rng(seed), faces = sc.memory.faces.slice(0, sc.memory.pairs), deck = faces.flatMap((f, i) => [i, i]);
      for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
      return deck;
    },
    // The beach: what the waves wash up, when and where, and how long it stays before the sea takes it back.
    collect(seed, sc) {
      const cfg = sc.collect, r = rng(seed), list = [];
      for (let id = 0, at = 1.2; at < cfg.seconds - 1; id++) {
        list.push({ id, at, x: 22 + Math.floor(r() * 148), kind: id > 1 && r() < cfg.jelly ? 'jelly' : r() < 0.7 ? 'paper' : 'bottle' });
        at += cfg.every[0] + r() * (cfg.every[1] - cfg.every[0]);
      }
      return list;
    },
    // How far the storey on the crane's hook swings to one side at a given moment: more, and faster, the higher the house.
    sway(t, n) { return (4 + n * 1.7) * Math.sin(t * (1.5 + n * 0.09)); },
    shoot(seed, sc, every) {
      const r = rng(seed), targets = [];
      for (let at = 1.2, id = 0; id < 160; id++) { targets.push({ id, born: at, x: 74 + r() * 100, y: 56 + r() * 130, phase: r() * 6 }); at += every * (0.8 + r() * 0.4); }
      return { targets };
    },
  };

  // `open`: every level may be played in any order (the version for trying levels out).
  function create({ world, solo, now, emit, open }) {
    const places = world.places, GAMES = ['run', 'drums', 'shoot', 'echo', 'find', 'salon', 'memory', 'collect', 'rescue', 'tower'];
    const owner = (pad) => (pad < 2 ? 'ken' : 'kel');                                 // in the echo game each of them has two of the four drums
    const S = { online: { ken: false, kel: false }, save: { places: {}, album: [] }, where: { screen: 'map' }, scene: null };
    let serial = 0;
    const prog = (id) => (S.save.places[id] = S.save.places[id] || { scene: 0, done: false });
    const isOpen = (p) => { const i = places.indexOf(p); return !!open || i === 0 || (i > 0 && prog(places[i - 1].id).done); };
    const both = () => S.online.ken && S.online.kel;
    const ready = () => !!solo || both();
    const place = () => places.find((p) => p.id === S.where.place);
    const regionOf = (p) => ({ screen: 'region', region: p.region });                       // the map a place's levels are on
    const SCREENS = ['planet', 'map', ...Object.keys(world.regions || {})];
    const push = () => emit('all', { type: 'state', now: now(), ready: ready(), solo: !!solo, online: S.online, save: S.save, where: S.where, scene: S.scene });

    // Praha 5 used to be one place of four scenes (pexeso, street, padlocks, salon). It is now two on the map of
    // Czechia: Domov (padlocks, street) and Kadeřnictví (pexeso, salon). Carry what was played over.
    function upgrade(saved) {
      const old = saved && saved.praha5;
      if (!old || saved.domov) return saved;
      const n = old.done ? 4 : old.scene | 0;
      return { ...saved, domov: { scene: n >= 2 ? 2 : 0, done: n >= 2 }, kadernictvi: { scene: n >= 4 ? 2 : n >= 1 ? 1 : 0, done: n >= 4 } };
    }
    // Two devices may each remember a different amount: keep whichever got further.
    function merge(save) {
      if (!save || typeof save !== 'object') return;
      const saved = upgrade(save.places);
      for (const p of places) {
        const theirs = saved && saved[p.id];
        if (!theirs) continue;
        const mine = prog(p.id);
        mine.scene = Math.max(mine.scene, Math.min(p.scenes.length, theirs.scene | 0));
        mine.done = mine.done || !!theirs.done;
      }
      for (const p of places) if (prog(p.id).done) for (const s of p.saves) if (!S.save.album.includes(s.id)) S.save.album.push(s.id);
    }

    function start(index, skipTalk) {
      const p = place(), sc = p.scenes[index];
      S.scene = { key: `${p.id}:${index}:${++serial}`, index, seed: (Math.random() * 2147483647) | 0, phase: 'talk', line: 0 };
      S.where = { screen: 'scene', place: p.id, region: p.region };
      if (skipTalk || !(sc.talk || []).length) begin();
    }
    // The talking is over: set up the game, counted for one player or two.
    function begin() {
      const sn = S.scene, sc = place().scenes[sn.index], two = both();
      if (!GAMES.includes(sc.play)) { sn.phase = 'stub'; return; }
      Object.assign(sn, { phase: 'play', startAt: now() + 1600, fin: {}, picked: false, power: 0 });
      if (sc.play === 'run') sn.lives = two ? 4 : 3;
      if (sc.play === 'shoot') Object.assign(sn, { lives: two ? 4 : 3, hits: 0, need: Math.round(sc.shoot.need * (two ? 1.6 : 1)), every: sc.shoot.every / (two ? 1.4 : 1), hit: [], missed: [], item: null });
      if (sc.play === 'find') Object.assign(sn, { found: [], need: sc.find.need });
      if (sc.play === 'memory') { const first = two ? (Math.random() < 0.5 ? 'ken' : 'kel') : null; Object.assign(sn, { deck: course.memory(sn.seed, sc), open: [], done: [], misses: 0, maxMiss: sc.memory.miss + (two ? 2 : 0), first, turn: first, hideAt: 0 }); }
      if (sc.play === 'collect') Object.assign(sn, { got: [], stung: [], need: Math.round(sc.collect.need * (two ? 1.5 : 1)), lives: two ? 4 : 3 });
      if (sc.play === 'tower') Object.assign(sn, { floors: [96], crane: 96, need: Math.round(sc.tower.need * (two ? 1.3 : 1)), lives: two ? 4 : 3, n: 0, last: null, busyUntil: 0, endAt: 0, endPhase: null });
      if (sc.play === 'rescue') Object.assign(sn, { stage: 'throw', hits: 0, needHits: sc.rescue.hits * (two ? 2 : 1), lives: two ? 4 : 3, pull: 0, needPull: Math.round(sc.rescue.pull * (two ? 2 : 1)), pullAt: 0 });
      if (sc.play === 'salon') Object.assign(sn, { lives: two ? 4 : 3, need: Math.round(sc.salon.need * (two ? 1.6 : 1)), served: 0, coins: 0, cust: [], next: 0, tt: 0, workers: { ken: null, kel: null } });
      if (sc.play === 'echo') { Object.assign(sn, { lives: two ? 4 : 3, round: 0, rounds: sc.echo.rounds, n: 0, last: null }); teach(sc.echo.first, 1600); }
      if (sc.play === 'drums') Object.assign(sn, { hits: 0, need: Math.ceil(course.drums(sn.seed, sc).notes.length * (sc.drums.pass || 0.6) * (two ? 2.1 : 1)) });    // two need more than one could ever drum alone
    }
    // The echo game: a rhythm to repeat. `teach` makes one of the given length (or plays the same one again) and sets
    // when it is shown and from when the players may answer.
    function teach(len, wait) {
      const sn = S.scene, sc = place().scenes[sn.index], two = both();
      if (len) {
        const pat = [];
        while (pat.length < len) { const p = Math.floor(Math.random() * 4); if (pat.length > 1 && pat[pat.length - 1] === p && pat[pat.length - 2] === p) continue; pat.push(p); }
        if (two && len > 1) { if (!pat.some((p) => p < 2)) pat[0] = Math.floor(Math.random() * 2); if (!pat.some((p) => p > 1)) pat[len - 1] = 2 + Math.floor(Math.random() * 2); }   // something for each of them
        sn.pattern = pat;
      }
      sn.step = 0;
      sn.beat = Math.max(0.36, sc.echo.beat - sn.round * 0.035);                       // a little quicker every round
      sn.showAt = now() + wait;
      sn.listenAt = sn.showAt + sn.pattern.length * sn.beat * 1000 + 250;
    }
    // The salon runs on its own between messages: customers come in, work gets done where someone stands, patience runs out.
    const QUEUE = 4, AWAY = -1, WAITING = -2;
    function salonTick() {
      const sn = S.scene; if (!sn || sn.phase !== 'play') return false;
      const sc = place().scenes[sn.index]; if (sc.play !== 'salon') return false;
      const cfg = sc.salon, t = (now() - sn.startAt) / 1000; if (t < 0) return false;
      const dt = Math.min(0.5, t - sn.tt); sn.tt = t;
      const plan = course.salon(sn.seed, sc, both());
      while (plan[sn.next] && plan[sn.next].arrive <= t && sn.cust.filter((c) => c.at === WAITING).length < QUEUE) {
        const p = plan[sn.next++], max = cfg.patience + p.order.length * 8;
        sn.cust.push({ ...p, step: 0, work: 0, at: WAITING, by: null, pat: max, max, no: 0 });
      }
      for (const c of sn.cust) {
        if (c.at >= 0) {
          const st = cfg.stations[c.at], k = ['ken', 'kel'].filter((w) => sn.workers[w] === c.at).length;
          if (st.k === c.order[c.step] && k) {
            c.work += dt * k;
            if (c.work >= cfg.work[st.k]) {
              c.work = 0; c.step++; c.pat = Math.min(c.max, c.pat + 8);
              if (c.step >= c.order.length) { c.gone = 'happy'; sn.served++; sn.coins += 50 + c.order.length * 30; }
            }
          }
        }
        if (!c.gone && (c.pat -= dt) <= 0) { c.gone = 'angry'; sn.lives--; }
      }
      sn.cust = sn.cust.filter((c) => !c.gone);
      if (sn.served >= sn.need) sn.phase = 'won';
      else if (sn.lives <= 0 || t >= cfg.seconds) sn.phase = 'lost';
      return true;
    }
    // Games that move on by themselves between messages: pexeso cards turning back over, the shark closing in.
    function clockTick() {
      const sn = S.scene; if (!sn || sn.phase !== 'play') return false;
      const sc = place().scenes[sn.index];
      if (sc.play === 'memory' && sn.open.length === 2 && sn.hideAt && now() >= sn.hideAt) {
        sn.open = []; sn.hideAt = 0;
        if (sn.misses >= sn.maxMiss) sn.phase = 'lost';
        return true;
      }
      if (sc.play === 'rescue' && sn.stage === 'pull' && now() > sn.pullAt + sc.rescue.seconds * 1000) { sn.phase = 'lost'; return true; }
      if (sc.play === 'tower' && sn.endAt && now() >= sn.endAt) { sn.phase = sn.endPhase; return true; }   // once the last storey has landed (or fallen)
      return false;
    }
    function complete() {
      const p = place(), pr = prog(p.id), index = S.scene.index;
      S.scene = null;
      if (!pr.done && index >= pr.scene) pr.scene = index + 1;
      if (pr.scene >= p.scenes.length && !pr.done) {
        pr.done = true;
        for (const s of p.saves) if (!S.save.album.includes(s.id)) S.save.album.push(s.id);
        S.where = { screen: 'rescued', place: p.id, region: p.region };
      } else S.where = regionOf(p);
    }

    // Something that counts, reported by a device while a game is on.
    function event(who, m) {
      const sn = S.scene; if (!sn || sn.phase !== 'play') return;
      const sc = place().scenes[sn.index], kind = sc.play;
      if (m.e === 'pick' && sc.pickup && !sn.picked) {                                  // one grabs it, both get it
        sn.picked = true;
        if (kind === 'shoot') sn.item = sc.pickup; else sn.power = now() + 8000;
      }
      if (kind === 'run') {
        if (m.e === 'hurt' && --sn.lives <= 0) sn.phase = 'lost';
        if (m.e === 'finish' && sn.lives > 0) sn.phase = 'won';
      }
      if (kind === 'shoot') {
        const id = m.id | 0, fresh = !sn.hit.includes(id) && !sn.missed.includes(id);
        if (m.e === 'hit' && fresh) { sn.hit.push(id); if (++sn.hits >= sn.need) sn.phase = 'won'; }
        if (m.e === 'miss' && fresh) { sn.missed.push(id); if (--sn.lives <= 0) sn.phase = 'lost'; }
      }
      if (kind === 'find') {
        const id = m.id | 0;
        if (m.e === 'find' && id >= 0 && id < sn.need && !sn.found.includes(id)) { sn.found.push(id); if (sn.found.length >= sn.need) sn.phase = 'won'; }
        if (m.e === 'finish') sn.phase = 'lost';                                        // time ran out before they were all found
      }
      if (kind === 'salon') {
        const cfg = sc.salon, c = sn.cust.find((q) => q.id === (m.c | 0)), st = m.st | 0;
        if (m.e === 'at') sn.workers[who] = Number.isInteger(m.st) && st >= 0 && st < cfg.stations.length ? st : null;   // where this one stands and works
        if (m.e === 'take' && c && !c.by && !sn.cust.some((q) => q.by === who)) { c.by = who; c.at = AWAY; c.work = 0; }    // leading a customer by the hand
        if (m.e === 'lead' && c && c.by === who) {
          const there = cfg.stations[st];
          if (there && there.k === c.order[c.step] && !sn.cust.some((q) => q.at === st)) { c.at = st; c.by = null; c.work = 0; sn.workers[who] = st; }
          else c.no++;                                                                  // not what they want next, or taken: a shake of the head
        }
      }
      // Pexeso for two: one turns the first card, the other turns the second, and then they swap.
      if (kind === 'memory' && m.e === 'flip') {
        const i = m.i | 0, other = (w) => (w === 'ken' ? 'kel' : 'ken');
        if (sn.open.length === 2 || (sn.turn && sn.turn !== who) || i < 0 || i >= sn.deck.length || sn.done.includes(i) || sn.open.includes(i)) return;
        sn.open.push(i);
        if (sn.open.length === 1) { if (sn.first) sn.turn = other(sn.first); return; }        // now the other one looks for its pair
        const [a, b] = sn.open;
        if (sn.deck[a] === sn.deck[b]) { sn.done.push(a, b); sn.open = []; if (sn.done.length === sn.deck.length) sn.phase = 'won'; }   // a pair: they stay up
        else { sn.misses++; sn.hideAt = now() + 1100; }                                       // not a pair: they turn back over in a moment
        if (sn.first) { sn.first = other(sn.first); sn.turn = sn.first; }                     // and the roles swap
      }
      if (kind === 'collect') {
        const id = m.id | 0, it = course.collect(sn.seed, sc)[id];
        if (!it) return;
        if (m.e === 'grab' && it.kind !== 'jelly' && !sn.got.includes(id)) { sn.got.push(id); if (sn.got.length >= sn.need) sn.phase = 'won'; }
        if (m.e === 'sting' && it.kind === 'jelly' && !sn.stung.includes(id + ':' + who)) { sn.stung.push(id + ':' + who); if (--sn.lives <= 0) sn.phase = 'lost'; }
        if (m.e === 'finish') sn.phase = 'lost';
      }
      // The tower: Kendrick moves the crane, Kellyn lets each storey go. It lands if it is over the top of the house.
      if (kind === 'tower') {
        const two = !solo && both();
        if (m.e === 'crane' && (!two || who === 'ken')) sn.crane = clamp(+m.x || 96, 24, 168);
        if (m.e === 'drop' && (!two || who === 'kel') && now() >= sn.busyUntil && !sn.endAt) {
          const t = (now() - sn.startAt) / 1000, hook = sn.crane + course.sway(t, sn.floors.length - 1), off = hook - sn.floors[sn.floors.length - 1];
          const ok = Math.abs(off) <= sc.tower.slack;
          sn.last = { n: ++sn.n, x: hook, ok, perfect: Math.abs(off) <= 2.5 };
          if (ok) sn.floors.push(hook); else sn.lives--;
          sn.busyUntil = now() + 1100;
          if (sn.floors.length >= sn.need) { sn.endAt = now() + 1000; sn.endPhase = 'won'; }
          else if (sn.lives <= 0) { sn.endAt = now() + 1000; sn.endPhase = 'lost'; }
        }
      }
      if (kind === 'rescue') {
        if (sn.stage === 'throw' && m.e === 'hit') { if (++sn.hits >= sn.needHits) { sn.stage = 'pull'; sn.pullAt = now() + 1800; } }
        if (sn.stage === 'throw' && m.e === 'miss') { if (--sn.lives <= 0) sn.phase = 'lost'; }
        if (sn.stage === 'pull' && m.e === 'pull' && now() >= sn.pullAt) { sn.pull += clamp(m.n | 0, 0, 12); if (sn.pull >= sn.needPull) sn.phase = 'won'; }
      }
      if (kind === 'echo' && m.e === 'pad') {
        const p = m.p | 0;
        if (now() < sn.listenAt || p < 0 || p > 3 || (!solo && both() && owner(p) !== who)) return;     // still being shown, or not this one's drum
        const ok = p === sn.pattern[sn.step];
        sn.last = { p, ok, n: ++sn.n };                                                // so both devices can show and sound the stroke
        if (!ok) { if (--sn.lives <= 0) sn.phase = 'lost'; else teach(0, 1300); }       // wrong: it is played once more
        else if (++sn.step >= sn.pattern.length) { if (++sn.round >= sn.rounds) sn.phase = 'won'; else teach(sn.pattern.length + 1, 1500); }
      }
      if (kind === 'drums') {
        if (m.e === 'hit') sn.hits += m.n === 2 ? 2 : 1;
        if (m.e === 'finish') {                                                        // the song is over once everyone playing has said so
          sn.fin[who] = true; sn.finAt = sn.finAt || now();
          if (solo || (sn.fin.ken && sn.fin.kel) || now() - sn.finAt > 2500) sn.phase = sn.hits >= sn.need ? 'won' : 'lost';   // or one has, and the other's device has gone quiet
        }
      }
    }

    function act(who, m) {
      if (!m || (who !== 'ken' && who !== 'kel')) return;
      if (m.type === 'fx') return emit(who === 'ken' ? 'kel' : 'ken', { ...m, type: 'fx', from: who });
      const sn = S.scene, sc = sn && place().scenes[sn.index];
      if (m.type === 'back') {
        if (S.where.screen === 'scene' || S.where.screen === 'rescued') { S.scene = null; S.where = regionOf(place()); }
        else if (S.where.screen === 'region') S.where = { screen: world.regions[S.where.region].up };
      } else if (m.type === 'home') S.where = place() ? regionOf(place()) : { screen: 'map' };
      else if (m.type === 'zoom') {                                                   // looking round the maps needs no partner
        const to = String(m.to), region = world.regions && world.regions[to];
        if (S.where.screen !== 'scene' && S.where.screen !== 'rescued' && SCREENS.includes(to) && (!region || places.some((p) => p.region === to && isOpen(p))))
          S.where = region ? { screen: 'region', region: to } : { screen: to };
      }
      else if (!ready()) { /* nothing below may happen until both are here */ }
      else if (m.type === 'play' && S.where.screen === 'region') {
        const p = places.find((x) => x.id === m.place), i = m.index | 0;
        if (p && p.region === S.where.region && isOpen(p) && p.scenes[i] && (open || prog(p.id).done || i <= prog(p.id).scene)) { S.where = { screen: 'scene', place: p.id, region: p.region }; start(i); }
      }
      else if (m.type === 'next' && sn && sn.phase === 'talk' && (m.line === undefined || m.line === sn.line)) { if (++sn.line >= sc.talk.length) begin(); }
      else if (m.type === 'done' && sn && sn.phase === 'stub') complete();
      else if (m.type === 'ev') event(who, m);
      else if (m.type === 'cont' && sn && sn.phase === 'won') complete();
      else if (m.type === 'retry' && sn && sn.phase === 'lost') start(sn.index, true);
      push();
    }

    return {
      state: S,
      tick() { const a = salonTick(), b = clockTick(); if (a || b) push(); },
      join(who, save) { S.online[who] = true; merge(save); push(); },
      leave(who) {
        S.online[who] = false;
        if (!solo && S.scene) { S.scene = null; S.where = regionOf(place()); }      // a scene cannot go on with one of them gone
        push();
      },
      act,
    };
  }

  root.Room = { rng, course, create };
})(typeof window !== 'undefined' ? window : globalThis);
