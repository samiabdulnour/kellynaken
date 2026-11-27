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
//   ev {e, ...}         something that counts: hurt, hit, miss, pick, finish, pad, find, flip, grab, sting, pull, crane, drop (a storey, or a salon customer let go),
//                       beat (an enemy), got (a coin, a clue or a piece on the list), revive (a partner out of their bubble), place (a piece of furniture put in)
//   fx {...}            something only to show on the other device (a jump, a shot, a drum tap)
//   cont / retry        after a scene is won / lost              home             back to the map after a rescue
//   back                up one level: from a level to its map, from a region's map to the map around it
//   pause / resume      stop a game for both of them, and carry on from exactly where it stopped
// The room answers everyone with its whole state after every change.
(function (root) {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rng = (seed) => { let s = (seed >>> 0) || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

  // What a scene throws at the players, made from a seed so both devices get exactly the same.
  const course = {
    // `at` is when a thing reaches the surfer. A gentle start to learn on: three far apart (a fin, a fin, a parrot).
    // Then they come ever closer together, and the last few come in a quick row, the finale. A jump lasts about
    // 0.7 s, so even the closest leave time to land before the next. Up in the air: the pick-up, and a heart.
    run(seed, sc) {
      const cfg = sc.run, r = rng(seed), obs = [], pickAt = sc.pickup ? cfg.seconds * 0.3 : null, end = cfg.seconds - 2;
      const heartAt = cfg.heart ? cfg.seconds * cfg.heart : null, clear = [pickAt, heartAt].filter((p) => p !== null);
      const FIRST = [3, 5.6, 8.2], FINALE = 5, from = FIRST[2] + 2.2, last = end - FINALE + 1;
      FIRST.forEach((at, i) => obs.push({ at, high: !!cfg.high && i === 2 }));
      for (let at = from; at < last - 1;) {
        const near = clear.find((p) => Math.abs(at - p) < 0.9); if (near !== undefined) { at = near + 1; continue; }   // keep the way to a pick-up clear
        const kinds = obs.slice(-3).map((o) => o.high), roll = r() < 0.4;                // a good mix: never four fins or three parrots in a row
        obs.push({ at, high: !!cfg.high && (kinds.every((h) => !h) || (roll && !(kinds[1] && kinds[2]))) });
        at += 1.95 - 0.85 * ((at - from) / (last - from)) + r() * 0.35;
      }
      for (let k = 0; k < FINALE; k++) obs.push({ at: last + k, high: !!cfg.high && k % 2 === 1, finale: true });   // jump, stay, jump, stay, jump
      return { obs, pickAt, heartAt, finale: last };
    },
    // A walk along a street (or up a hill): what stands in the way, who walks and flies about, and what lies there
    // to collect. Laid out by hand in world.js, so the level gets harder towards its end; nothing here is random.
    // Enemies move by the clock, so both phones see them in the same place without telling each other.
    platform(sc) {
      const cfg = sc.platform;
      const blocks = cfg.blocks.map(([x, w, h, kind]) => ({ x, w, h, kind }));
      const top = (x, half) => blocks.reduce((m, b) => (x + (half || 0) > b.x && x - (half || 0) < b.x + b.w ? Math.max(m, b.h) : m), 0);   // what you stand on, there
      const foes = cfg.foes.map(([kind, x0, x1, h, speed, every], id) => ({ id, kind, x0, x1: x1 === undefined ? x0 : x1, h: h || 0, speed: speed || 0, every: every || 0 }));
      const items = cfg.items.map(([kind, x, h], id) => ({ id, kind, x, h }));
      // Where an enemy is at time t: walkers and flyers go to and fro; a rolling cone comes down again and again, each
      // one an enemy of its own (id "foe.round"); a puddle stays put.
      function at(f, t) {
        if (f.kind === 'puddle') return { id: String(f.id), x: f.x0, y: 0, dir: 0 };
        if (f.kind === 'cone') {                                                       // drops out of a pine tree, then rolls downhill
          const DROP = 0.6, n = Math.floor(t / f.every), u = t - n * f.every;
          if (t < 0 || f.x1 <= f.x0) return null;
          if (u < DROP) return { id: f.id + '.' + n, x: f.x1, y: top(f.x1, 3) + 40 * (1 - u / DROP), dir: -1, spin: 0, falling: true };
          const x = f.x1 - (u - DROP) * f.speed;
          return x < f.x0 ? null : { id: f.id + '.' + n, x, y: top(x, 3), dir: -1, spin: (u - DROP) * f.speed / 5 };
        }
        const len = Math.max(1, f.x1 - f.x0), d = ((Math.max(0, t) * f.speed + (f.id * 37) % len) % (2 * len)), out = d < len;
        const x = f.x0 + (out ? d : 2 * len - d);
        const bob = f.kind === 'flyer' || f.kind === 'crow' ? Math.sin(t * 1.6 + f.id) * 12 : f.kind === 'magpie' ? Math.sin(t * 2.2 + f.id) * 5 : 0;   // flyers swoop low and up again; a magpie keeps high (its dives are the phone's, game.js)
        return { id: String(f.id), x, y: f.h + bob, dir: out ? 1 : -1 };
      }
      return { blocks, foes, items, top, at, length: cfg.length, goal: cfg.goal };
    },
    // A walk with a list (Nábytek): what on it nobody has found yet. `got` holds the found items by their number.
    missing(sc, got) {
      const { list, items } = sc.platform || {};
      return list ? list.filter((k) => !got.some((id) => items[id] && items[id][0] === k)) : [];
    },
    // The song at the concert. As "Start!" goes, four clicks count it in; then four gentle bars (beats one and three
    // only), the rest of the first half on the beat, a busier second half (notes between the beats too), two bars of
    // fill and one big beat to end on. With two, Kendrick has the kick and the snare (left and middle lanes) and
    // Kellyn the cymbal (right), on the beat only: once a bar, then twice, then every beat. A note's `who` says whose
    // it is (null: one playing alone has all of them).
    drums(seed, sc, two) {
      const cfg = sc.drums, beat = 60 / cfg.bpm, r = rng(seed), notes = [], n = cfg.beats, half = n / 2, fill = n - 8;
      const start = 0.6 + 4 * beat, end = start + n * beat;
      const add = (at, lane, big) => notes.push({ at, lane, who: two ? (lane === 2 ? 'kel' : 'ken') : null, big: !!big });
      const run = (k) => (two ? k % 2 : [0, 1, 2, 1][k % 4]);                              // the fill runs round the drums
      for (let b = 0; b < n; b++) {
        const at = start + b * beat, q = b % 4;
        if (b >= fill) { add(at, run(2 * b)); add(at + beat / 2, run(2 * b + 1)); }
        else {
          // kick on one, snare on two; on three and four, with two, now and then the other way round; alone, often the cymbal
          if (b >= 16 || q % 2 === 0) add(at, q === 0 ? 0 : q === 1 ? 1 : two ? (r() < 0.3 ? 3 - q : q - 2) : r() < 0.4 ? q - 2 : 2);
          if (b >= half && r() < (cfg.busy || 0.3)) add(at + beat / 2, Math.floor(r() * (two ? 2 : 3)));
        }
        if (two && (b < 16 ? q === 0 : b < half ? q % 2 === 0 : true)) add(at, 2);    // Kellyn's cymbal
      }
      if (two) { add(end, 0, true); add(end, 2, true); } else add(end, 1, true);      // the last beat: with two, both strike together
      notes.sort((a, b) => a.at - b.at);
      // the pick-up falls between two beats, about a third of the way in: down the middle, or with two down Kellyn's lane
      return { notes, beat, start, end, half: start + half * beat, fill: start + fill * beat,
        pick: sc.pickup ? { lane: two ? 2 : 1, at: start + (Math.floor(n * 0.3) + 0.5) * beat } : null };
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
    // A calm start with no jellyfish, then more of them. A second stream (`extra`) only washes up once the tide
    // (příliv) is in, so the tide can come whenever the room says (see sn.tideAt). Halfway through a big bottle washes
    // up that takes both of them to lift; nothing lands right next to it. Two share one beach: more washes up for
    // them, but no more jellyfish a second.
    collect(seed, sc, two) {
      const cfg = sc.collect, r = rng(seed), items = [], B = cfg.big, more = two ? 1.2 : 1;
      const big = B ? { at: B.at, stay: B.stay, x: 64 + Math.floor(r() * 64) } : null;
      const nearBig = (at, x) => big && at > big.at - cfg.stay && at < big.at + big.stay && Math.abs(x - big.x) < 30;
      const wash = (rand, at, extra) => {                                              // one thing washed up; returns the wait for the next
        const id = items.length, calm = clamp((at - (cfg.calm || 0)) / 18, 0, 1);       // jellyfish come in slowly after the calm start
        let x = 22 + Math.floor(rand() * 148);
        if (nearBig(at, x)) x = big.x + (x < big.x ? -36 : 36);
        items.push({ id, at, x, extra, stay: cfg.stay, kind: id > 1 && rand() < (cfg.jelly / more) * calm ? 'jelly' : rand() < 0.7 ? 'paper' : 'bottle' });
        return (cfg.every[0] + rand() * (cfg.every[1] - cfg.every[0])) / more;
      };
      for (let at = 1.2; at < cfg.seconds - 1; ) at += wash(r, at, false);
      for (let at = 1.5, r2 = rng(seed ^ 0x51f15e); at < cfg.seconds - 1; ) at += wash(r2, at, true) / 0.8;   // with the tide: 1.8 times as much
      return { items, big };
    },
    // Sami's tower gets harder as it grows; n is how many storeys already stand on the lobby. The storey on the hook
    // swings further and faster, from the eighth storey the wind pushes it slowly to one side and back (the crane has
    // to lean against it), and it has to land ever closer to the middle of the one below.
    sway(t, n) { return (4 + n * 1.5) * Math.sin(t * (1.4 + n * 0.08)) + course.wind(t, n); },
    wind(t, n) { return n >= 7 ? (n - 6) * 2.4 * Math.sin(t * 0.35 + 1) : 0; },
    slack(base, n) { return Math.max(8, base - n * 0.5); },
    // Padlocks: on the picture's spots, never two on one spot at the same time (or anywhere, for a picture without spots).
    // The first one (with two, one each) waits until it is shot, so nobody loses before they have found out what to do;
    // the rest come `after` seconds after the first one opens. The first of them come slowly; then they come quicker
    // (from `every` to `fast` seconds apart, over the padlocks it takes to win) and sway a little more. With two, every
    // other one is Kellyn's, and hers stay a little longer: she is the younger, and the team must not lose only because
    // she is slower. A spot stays taken a little after its padlock is gone, while it slips away.
    shoot(seed, sc, every, need, two) {
      const cfg = sc.shoot, r = rng(seed), targets = [], spots = cfg.spots, fast = (cfg.fast || cfg.every) / cfg.every, wait = two ? 2 : 1;
      for (let at = 1, id = 0; id < 160; id++) {
        const k = Math.min(1, id / Math.max(1, need || 16)), owner = two ? (id % 2 ? 'kel' : 'ken') : null, first = id < wait;
        const t = { id, wait: first, born: first ? 1.2 : Infinity, after: first ? 0 : at, owner, stay: cfg.stay * (owner === 'kel' ? 1.2 : 1), sway: (cfg.sway || 0) * (1 + 0.5 * k) };
        if (spots) {
          const busy = new Set(targets.filter((o) => o.after + o.stay + 0.8 > t.after).map((o) => o.spot));
          const free = spots.map((p, i) => i).filter((i) => !busy.has(i)), i = free.length ? free[Math.floor(r() * free.length)] : Math.floor(r() * spots.length);
          targets.push({ ...t, x: spots[i][0], y: spots[i][1], spot: i, phase: r() * 6 });
        } else targets.push({ ...t, x: 74 + r() * 100, y: 56 + r() * 130, phase: r() * 6 });
        if (!first) at += every * (1 - (1 - fast) * k) * (0.8 + r() * 0.4) + (id === wait ? every * 0.5 : 0);
      }
      return { targets };
    },
    // Moving into the flat: each piece with its place (world.js) and the piece that must be down before it (`after`,
    // an index, or -1); which way round it waits in the heap (the bed always the wrong way, so turning is learnt on
    // it; the others as it falls); and the order the heap lies in, left to right.
    flat(seed, sc) {
      const r = rng(seed), list = sc.flat.places;
      const pieces = list.map(([k, x, y, size, face, after], id) => ({ id, k, x, y, size, face: face || 0, after: after ? list.findIndex((q) => q[0] === after) : -1 }));
      for (const p of pieces) p.f = p.face ? (p.k === 'bed' || r() < 0.5 ? -p.face : p.face) : r() < 0.5 ? 1 : -1;
      const order = pieces.map((p) => [p.id, r()]).sort((a, b) => a[1] - b[1]).map((o) => o[0]);
      return { pieces, order };
    },
  };

  // `open`: every level may be played in any order (the version for trying levels out).
  function create({ world, solo, now, emit, open }) {
    const places = world.places, GAMES = ['run', 'platform', 'drums', 'shoot', 'echo', 'find', 'salon', 'memory', 'collect', 'rescue', 'tower', 'flat'];
    const owner = (pad) => (pad < 2 ? 'ken' : 'kel');                                 // in the echo game each of them has two of the four drums
    const S = { online: { ken: false, kel: false }, save: { places: {}, album: [], round: 0, stars: {} }, where: { screen: 'map' }, scene: null };
    let serial = 0;
    const prog = (id) => (S.save.places[id] = S.save.places[id] || { scene: 0, done: false });
    const isOpen = (p) => { const i = places.indexOf(p); return !!open || i === 0 || (i > 0 && prog(places[i - 1].id).done); };
    const both = () => S.online.ken && S.online.kel;
    const ready = () => !!solo || both();
    const place = () => places.find((p) => p.id === S.where.place);
    const regionOf = (p) => ({ screen: 'region', region: p.region });                       // the map a place's levels are on
    const SCREENS = ['planet', 'map', ...Object.keys(world.regions || {})];
    const push = () => record() || emit('all', { type: 'state', now: now(), ready: ready(), solo: !!solo, online: S.online, save: S.save, where: S.where, scene: S.scene });

    // Praha 5 used to be one place of four scenes (pexeso, street, padlocks, salon). It is now two on the map of
    // Czechia: Domov (padlocks, street) and Kadeřnictví (pexeso, salon). Carry what was played over.
    function upgrade(saved) {
      const old = saved && saved.praha5;
      if (!old || saved.domov) return saved;
      const n = old.done ? 4 : old.scene | 0;
      return { ...saved, domov: { scene: n >= 2 ? 2 : 0, done: n >= 2 }, kadernictvi: { scene: n >= 4 ? 2 : n >= 1 ? 1 : 0, done: n >= 4 } };
    }
    // Two devices may each remember a different amount: keep whichever got further. `round` counts new games: a
    // device that was away when they started a new game still remembers the old one, and that is forgotten;
    // a device that started one while this room was asleep brings the new game with it.
    function merge(save) {
      if (!save || typeof save !== 'object') return;
      const round = Math.max(0, save.round | 0), ours = S.save.round | 0;
      if (round < ours) return;
      if (round > ours) S.save = { places: {}, album: [], round, stars: {} };
      const saved = upgrade(save.places);
      for (const p of places) {
        const theirs = saved && saved[p.id];
        if (!theirs) continue;
        const mine = prog(p.id);
        mine.scene = Math.max(mine.scene, Math.min(p.scenes.length, theirs.scene | 0));
        mine.done = mine.done || !!theirs.done;
      }
      for (const p of places) if (prog(p.id).done) for (const s of p.saves) if (!S.save.album.includes(s.id)) S.save.album.push(s.id);
      S.save.stars = S.save.stars || {};                                                 // the best stars each level has been won with
      for (const [key, n] of Object.entries((save.stars && typeof save.stars === 'object') ? save.stars : {}))
        if (/^[a-z0-9]+:\d+$/.test(key) && (n | 0) >= 1 && (n | 0) <= 3) S.save.stars[key] = Math.max(S.save.stars[key] || 0, n | 0);
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
      // hearts of one's own; out of them, a ride on the partner's board (`ride`: obstacles they have passed since)
      if (sc.play === 'run') Object.assign(sn, { two, hp: { ken: 3, kel: 3 }, max: 3, out: {}, outAt: {}, ride: {}, passed: {}, ko: [], healed: {}, hurts: 0, outs: 0 });
      if (sc.play === 'platform') Object.assign(sn, { two, hp: { ken: 3, kel: 3 }, max: 3, out: {}, beaten: [], got: [] });   // hearts of one's own; out of them, a bubble
      if (sc.play === 'shoot') Object.assign(sn, { lives: two ? 4 : 3, hits: 0, need: Math.round(sc.shoot.need * (two ? 1.6 : 1)), every: sc.shoot.every / (two ? 1.4 : 1), two, hit: [], missed: [], item: null, gold: null, go: null });
      if (sc.play === 'find') Object.assign(sn, { found: [], need: sc.find.need });
      if (sc.play === 'memory') { const first = two ? (Math.random() < 0.5 ? 'ken' : 'kel') : null; Object.assign(sn, { deck: course.memory(sn.seed, sc), open: [], done: [], misses: 0, maxMiss: sc.memory.miss + (two ? 2 : 0), first, turn: first, hideAt: 0 }); }
      if (sc.play === 'collect') {                                                       // `have`: pieces of the message so far; the big bottle holds `bigPart` of them
        const need = Math.round(sc.collect.need * (two ? 1.5 : 1));
        Object.assign(sn, { two, got: [], stung: [], paid: [], cost: { ken: 0, kel: 0 }, have: 0, at: {}, lifted: false, need, bigPart: Math.round(need * ((sc.collect.big && sc.collect.big.part) || 0)), lives: two ? 4 : 3, tideAt: null });
      }
      if (sc.play === 'tower') Object.assign(sn, { floors: [96], crane: 96, need: Math.round(sc.tower.need * (two ? 1.3 : 1)), lives: two ? 5 : 4, n: 0, last: null, busyUntil: 0, endAt: 0, endPhase: null, holding: false, lifts: 0 });
      if (sc.play === 'rescue') Object.assign(sn, { stage: 'throw', hits: 0, needHits: sc.rescue.hits * (two ? 2 : 1), lives: two ? 4 : 3, pull: 0, needPull: Math.round(sc.rescue.pull * (two ? 2 : 1)), pullAt: 0 });
      if (sc.play === 'salon') Object.assign(sn, { lives: two ? 4 : 3, need: Math.round(sc.salon.need * (two ? 1.6 : 1)), served: 0, coins: 0, cust: [], next: 0, tt: 0, workers: { ken: null, kel: null } });
      // the flat: every piece in the heap, nobody holding anything; two get a fifth more time before night
      if (sc.play === 'flat') Object.assign(sn, { seconds: Math.round(sc.flat.seconds * (two ? 1.2 : 1)), no: null, wonAt: 0,
        pieces: course.flat(sn.seed, sc).pieces.map((p) => ({ f: p.f, by: null, till: 0, rest: null, done: false, who: null })) });
      if (sc.play === 'echo') { Object.assign(sn, { two, lives: two ? 4 : 3, round: 0, rounds: sc.echo.rounds, n: 0, last: null, tune: tune(sc.echo.first + sc.echo.rounds - 1, two), attempt: 0, slips: 0, misses: 0, hints: 0 }); teach(sc.echo.first, 2200); }
      if (sc.play === 'platform') Object.assign(sn, { hurts: 0, outs: 0 });
      // With two, only a third of Kellyn's notes go into what is needed: Kendrick drumming well wins it even on a day
      // she misses them all, and every note she does hit still helps. `by`: what each has drummed; `notes`: how many.
      // `marks`: how many hits win (one star), and earn two and three stars: most of the whole song, the two of them.
      if (sc.play === 'drums') {
        const song = course.drums(sn.seed, sc, two), all = song.notes.length, hers = song.notes.filter((q) => q.who === 'kel').length, need = Math.ceil((all - hers * 2 / 3) * (sc.drums.pass || 0.6));
        Object.assign(sn, { two, hits: 0, by: { ken: 0, kel: 0 }, notes: all, need, marks: [need, Math.max(need + 1, Math.ceil(all * 0.68)), Math.max(need + 2, Math.ceil(all * 0.8))] });
      }
      if (sn.lives !== undefined) sn.maxLives = sn.lives;                                   // for the stars: how many they started with
    }
    // The echo game: a rhythm to repeat, Simon-style. `tune` makes the whole rhythm once; each round plays one stroke
    // more of it, so a round only ever asks for one new stroke. Never three of a kind in a row and the first two
    // strokes differ; with two, both play from the first round, turns change often (never three running for one),
    // and in no round (2 strokes and longer) does Kellyn, the younger, have more strokes than Kendrick.
    function tune(len, two) {
      for (;;) {
        const pat = [];
        while (pat.length < len) {
          const p = Math.floor(Math.random() * 4), n = pat.length;
          if ((n === 1 && pat[0] === p) || (n > 1 && pat[n - 1] === p && pat[n - 2] === p)) continue;
          if (two && n > 1 && owner(pat[n - 1]) === owner(p) && owner(pat[n - 2]) === owner(p)) continue;
          pat.push(p);
        }
        if (!two) return pat;
        const fair = pat.every((_, i) => i < 1 || pat.slice(0, i + 1).filter((p) => owner(p) === 'kel').length <= Math.floor((i + 1) / 2));
        if (owner(pat[0]) !== owner(pat[1]) && fair) return pat;
      }
    }
    // `teach` sets the part of the rhythm for this round (or the same again after a slip), when it is shown and from
    // when the players may answer. `attempt` counts the showings: a stroke meant for an earlier one is dropped.
    function teach(len, wait) {
      const sn = S.scene, sc = place().scenes[sn.index];
      Object.assign(sn, { pattern: sn.tune.slice(0, len), step: 0, got: [], attempt: sn.attempt + 1 });
      sn.beat = Math.max(0.5, sc.echo.beat - sn.round * 0.02);                         // a little quicker every round
      sn.showAt = now() + wait;
      sn.listenAt = sn.since = sn.showAt + len * sn.beat * 1000 + 300;                // `since`: from when the next stroke is waited for (for the hints)
    }
    // The salon runs on its own between messages: customers come in, work gets done where someone stands, patience runs out.
    const QUEUE = 3, AWAY = -1, WAITING = -2;                                       // three chairs to wait on by the door
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
              else {                                                                    // done here: whoever did it takes them by the hand, on to the next thing
                const w = ['ken', 'kel'].find((q) => sn.workers[q] === c.at && !sn.cust.some((o) => o.by === q));
                if (w) { c.by = w; c.at = AWAY; sn.workers[w] = null; }
              }
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
      if (sc.play === 'flat') {
        if (now() >= sn.startAt + sn.seconds * 1000) { sn.phase = 'lost'; return true; }   // night fell first
        let freed = false;
        for (const p of sn.pieces) if (p.by && now() > p.till) { p.by = null; freed = true; }   // a phone that went quiet lets go of what it held
        return freed;
      }
      return false;
    }
    // A level counts the moment it is won (not when they tap on), so closing the game on the card loses nothing.
    function record() {
      const sn = S.scene;
      if (!sn || sn.saved || (sn.phase !== 'won' && sn.phase !== 'stub')) return;
      const p = place(), pr = prog(p.id), key = p.id + ':' + sn.index;
      sn.saved = true;
      sn.stars = starsFor(sn, p.scenes[sn.index]);
      S.save.stars = S.save.stars || {}; S.save.stars[key] = Math.max(S.save.stars[key] || 0, sn.stars);
      if (!pr.done && sn.index >= pr.scene) pr.scene = sn.index + 1;
      if (pr.scene >= p.scenes.length && !pr.done) {
        pr.done = true; sn.rescued = true;                                          // the last level of the place: they are saved
        for (const s of p.saves) if (!S.save.album.includes(s.id)) S.save.album.push(s.id);
      }
    }
    // How well a level went: 1 to 3 stars. Every win earns at least one; the third is for doing it cleanly, so a level
    // is worth playing again. Each kind of game is measured by what goes wrong in it.
    function starsFor(sn, sc) {
      if (sn.phase === 'stub') return 3;
      const k = sc.play, by = (bad, two) => (bad <= 0 ? 3 : bad <= two ? 2 : 1);            // bad: what went wrong; two: how much still earns two stars
      if (k === 'platform') return Math.min(by(sn.hurts || 0, sn.two ? 3 : 2), sn.outs ? 2 : 3);
      if (k === 'run') return Math.min(by(sn.hurts, sn.two ? 3 : 2), sn.outs ? 2 : 3);           // a ride on the partner's board: two at most
      if (k === 'memory') return Math.min(by(sn.misses - Math.floor(sn.maxMiss * 0.4), Math.floor(sn.maxMiss * 0.3)), sn.before ? 2 : 3);   // after a lost go (its pairs kept) two at most
      if (k === 'find') { const u = (now() - sn.startAt) / 1000 / sc.find.seconds; return u <= 0.6 ? 3 : u <= 0.85 ? 2 : 1; }
      if (k === 'drums') return sn.hits >= sn.marks[2] ? 3 : sn.hits >= sn.marks[1] ? 2 : 1;   // how much of the whole song they played, the two of them
      if (k === 'flat') { const u = ((sn.wonAt || now()) - sn.startAt) / 1000 / sn.seconds; return u <= 0.5 ? 3 : u <= 0.8 ? 2 : 1; }   // how much daylight was left
      if (k === 'echo') return by(sn.misses + sn.hints, sn.two ? 4 : 3);                // slips, and strokes played only once the drum was shown
      if (sn.maxLives) return by(sn.maxLives - sn.lives, Math.floor(sn.maxLives / 2));
      return 3;
    }
    function complete() {
      record();
      const p = place(), rescued = S.scene.rescued;
      S.scene = null;
      S.where = rescued ? { screen: 'rescued', place: p.id, region: p.region } : regionOf(p);
    }

    // Something that counts, reported by a device while a game is on.
    function event(who, m) {
      const sn = S.scene; if (!sn || sn.phase !== 'play' || sn.paused) return;
      const sc = place().scenes[sn.index], kind = sc.play;
      if (m.e === 'pick' && sc.pickup && !sn.picked) {                                  // one grabs it, both get it
        sn.picked = true;
        if (kind === 'shoot') sn.item = sc.pickup; else sn.power = now() + 5000;
      }
      // The surf: `i` is which obstacle. Out of hearts, one rides on the other's board until that one has passed three
      // more; it is lost only when nobody is left surfing. A boomerang knocks its obstacle out for both of them.
      if (kind === 'run') {
        const team = sn.two ? ['ken', 'kel'] : [who], other = who === 'ken' ? 'kel' : 'ken', i = m.i | 0;
        if (m.e === 'hurt' && !sn.out[who] && !sn.ko.includes(i)) {                     // a thing already knocked out hurts nobody (the news was slow)
          sn.hurts++;
          if (--sn.hp[who] <= 0) {
            sn.out[who] = true; sn.outs++; sn.ride[who] = 0; sn.outAt[who] = i;
            if (team.every((w) => sn.out[w])) sn.phase = 'lost';
          }
        }
        if (m.e === 'pass' && sn.two && sn.out[other] && !sn.out[who] && i > sn.outAt[other] && i > (sn.passed[who] ?? -1)) {
          sn.passed[who] = i;
          if (++sn.ride[other] >= 3) { sn.out[other] = false; sn.hp[other] = 2; }        // back on their own board
        }
        if (m.e === 'ko' && sn.picked && i >= 0 && i < 200 && !sn.ko.includes(i)) sn.ko.push(i);
        if (m.e === 'heal' && sc.run.heart && !sn.out[who] && !sn.healed[who]) { sn.healed[who] = true; sn.hp[who] = Math.min(sn.max, sn.hp[who] + 1); }   // each may catch the heart once
        if (m.e === 'finish' && team.some((w) => !sn.out[w])) sn.phase = 'won';
      }
      if (kind === 'platform') {
        const team = sn.two ? ['ken', 'kel'] : [who], other = who === 'ken' ? 'kel' : 'ken';
        if (m.e === 'hurt' && !sn.out[who] && !sn.fin[who]) sn.hurts++;
        if (m.e === 'hurt' && !sn.out[who] && !sn.fin[who] && --sn.hp[who] <= 0) {
          sn.out[who] = true; sn.outs++;                                               // out of hearts: floating in a bubble
          if (team.every((w) => sn.out[w])) sn.phase = 'lost';                         // nobody left walking
          else if (team.every((w) => sn.fin[w] || sn.out[w])) sn.phase = 'won';         // the other is already at the door: the bubble comes along (else they would wait for ever)
        }
        if (m.e === 'revive' && sn.two && sn.out[other] && !sn.out[who]) { sn.out[other] = false; sn.hp[other] = 2; }   // the partner jumped into the bubble
        const id = String(m.id).slice(0, 12);
        if (m.e === 'beat' && /^\d+(\.\d+)?$/.test(id) && !sn.beaten.includes(id)) sn.beaten.push(id);
        if (m.e === 'got' && /^\d+$/.test(id) && !sn.got.includes(+id)) {
          sn.got.push(+id);
          const it = course.platform(sc).items[+id];
          if (it && it.kind === 'heart' && !sn.out[who]) sn.hp[who] = Math.min(sn.max, sn.hp[who] + 1);   // a heart picked up: one back
        }
        if (m.e === 'finish' && !sn.out[who] && !course.missing(sc, sn.got).length) {   // with a list, the door stays shut until all of it is found
          sn.fin[who] = true;                                                          // at the door; one still in a bubble comes along with the other
          if (team.every((w) => sn.fin[w] || sn.out[w])) sn.phase = 'won';
        }
      }
      if (kind === 'shoot') {
        const id = m.id | 0, fresh = !sn.hit.includes(id) && !sn.missed.includes(id), t = (now() - sn.startAt) / 1000;
        const at = clamp(Number.isFinite(+m.at) ? +m.at : t, t - 3, t);                  // when, by the shared clock, as the phone says
        // Enough padlocks open: the big golden one comes down (`gold.at`, seconds into the game). Two open it by both
        // throwing at it within two seconds of each other (each phone says when its shot left: Kellyn only sees that
        // it is her turn once his shot has landed), one by hitting it three times. Nothing can be lost any more by then.
        if (sn.gold) {
          if (m.e !== 'gold') return;
          const g = sn.gold;
          g.n++; g[who] = at;
          if (sn.two ? g.ken !== undefined && g.kel !== undefined && Math.abs(g.ken - g.kel) <= 2 : g.n >= 3) sn.phase = 'won';
          return;
        }
        if (m.e === 'hit' && fresh) { sn.hit.push(id); if (sn.go === null) sn.go = at; if (++sn.hits >= sn.need) sn.gold = { at: t, n: 0 }; }   // the first one open: the rest start coming
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
        const busy = (q) => q.at >= 0 && cfg.stations[q.at].k === q.order[q.step];          // sitting where their next thing is done: not to be pulled away
        if (m.e === 'take' && c && !c.by && !busy(c) && !sn.cust.some((q) => q.by === who)) { c.by = who; c.at = AWAY; c.work = 0; }    // leading a customer by the hand
        if (m.e === 'drop' && c && c.by === who && sn.cust.filter((q) => q.at === WAITING).length < QUEUE) { c.by = null; c.at = WAITING; c.work = 0; }   // let go: back to a chair by the door, if one is free
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
        else { sn.misses++; sn.hideAt = now() + 2000; }                                       // not a pair: they stay up long enough to remember, then turn back
        if (sn.first) { sn.first = other(sn.first); sn.turn = sn.first; }                     // and the roles swap
      }
      if (kind === 'collect') {
        const beach = course.collect(sn.seed, sc, sn.two), big = beach.big, t = (now() - sn.startAt) / 1000;
        if (m.e === 'finish') sn.phase = 'lost';
        // The big bottle: with two, it comes up once both stand at it; alone, once held up for a second (the phone times it).
        if ((m.e === 'at' || m.e === 'lift') && big && !sn.lifted && t > big.at - 1 && t < big.at + big.stay + 1) {
          if (m.e === 'at') sn.at[who] = !!m.on;
          if (m.e === 'lift' ? !sn.two : sn.two && sn.at.ken && sn.at.kel) { sn.lifted = true; sn.have += sn.bigPart; }
        }
        const id = m.id | 0, it = beach.items[id];
        if (it && m.e === 'grab' && it.kind !== 'jelly' && !sn.got.includes(id)) { sn.got.push(id); sn.have++; }
        // Each jellyfish stings each of them once at most, and costs one heart however many it stings. With two, one
        // of them alone can cost all but the last heart: it takes both to lose.
        if (it && m.e === 'sting' && it.kind === 'jelly' && !sn.stung.includes(id + ':' + who)) {
          sn.stung.push(id + ':' + who);
          if (!sn.paid.includes(id) && (!sn.two || sn.cost[who] < sn.maxLives - 1)) { sn.paid.push(id); sn.cost[who]++; if (--sn.lives <= 0) sn.phase = 'lost'; }
        }
        if (sn.have >= sn.need && sn.phase === 'play') sn.phase = 'won';
        // The finale: the tide comes once `tideNote` of the note is found (or in the last seconds, the phones know when),
        // a second after this so both phones hear of it before anything more washes up.
        else if (sn.tideAt === null && sn.have >= sn.need * (sc.collect.tideNote || 1)) sn.tideAt = Math.max(0, t) + 1;
      }
      // The tower: Kendrick moves the crane, Kellyn lets each storey go. It lands if it is over the top of the house.
      if (kind === 'tower') {
        const two = !solo && both();
        if (m.e === 'crane' && (!two || who === 'ken')) sn.crane = clamp(+m.x || 96, 12, 168);
        // the hook picks up a storey from the stack on the ground, if the crane is right above it (as her phone saw it)
        if (m.e === 'pick' && (!two || who === 'kel') && !sn.holding && now() >= sn.busyUntil && !sn.endAt) {
          const x = Number.isFinite(+m.x) ? +m.x : sn.crane;
          if (Math.abs(x - (sc.tower.stack || 24)) <= 12) { sn.holding = true; sn.lifts++; sn.busyUntil = now() + 1000; }
        }
        if (m.e === 'drop' && (!two || who === 'kel') && sn.holding && now() >= sn.busyUntil && !sn.endAt) {
          sn.holding = false;
          // where the storey hung when she let it go, as her phone saw it (the room hears the crane only now and then)
          const t = (now() - sn.startAt) / 1000, seen = +m.x, hook = Number.isFinite(seen) ? clamp(seen, 0, 192) : sn.crane + course.sway(t, sn.floors.length - 1), off = hook - sn.floors[sn.floors.length - 1];
          const ok = Math.abs(off) <= course.slack(sc.tower.slack, sn.floors.length - 1);
          sn.last = { n: ++sn.n, x: hook, ok, perfect: Math.abs(off) <= 2.5 };
          if (ok) sn.floors.push(hook); else sn.lives--;
          sn.busyUntil = now() + 1100;
          if (sn.floors.length >= sn.need) { sn.endAt = now() + 1000; sn.endPhase = 'won'; }
          else if (sn.lives <= 0) { sn.endAt = now() + 1000; sn.endPhase = 'lost'; }
        }
      }
      if (kind === 'rescue') {
        if (sn.stage === 'throw' && m.e === 'hit') { if (++sn.hits >= sn.needHits) { sn.stage = 'pull'; sn.pullAt = now() + 2400; } }   // 3, 2, 1, pull!
        if (sn.stage === 'throw' && m.e === 'miss') { if (--sn.lives <= 0) sn.phase = 'lost'; }
        if (sn.stage === 'pull' && m.e === 'pull' && now() >= sn.pullAt) { sn.pull += clamp(m.n | 0, 0, 12); if (sn.pull >= sn.needPull) sn.phase = 'won'; }
      }
      // Moving in: a piece is taken (a free one, one at a time; the phone says so every second or so while it holds it),
      // let go (back to the heap, or, when the phone says `park`, left standing at its place the wrong way round, for
      // anyone to turn) or put in. The room checks the place, the facing and the order; a refusal says why, for the
      // phone that asked. What the other one holds is theirs: taking or putting it in is refused as 'taken'.
      if (kind === 'flat') {
        const id = m.id | 0, p = sn.pieces[id], spec = course.flat(sn.seed, sc).pieces[id];
        if (!p || p.done) return;
        const f = m.f === -1 ? -1 : 1, near = Math.abs(m.x - spec.x) <= 30 && Math.abs(m.y - spec.y) <= 30;      // no x at all is never near
        const no = (why) => { sn.no = { id, why, who, n: (sn.no ? sn.no.n : 0) + 1 }; };
        if (p.by && p.by !== who) return m.e === 'drop' ? undefined : no('taken');
        if (m.e === 'grab') {
          for (const q of sn.pieces) if (q.by === who && q !== p) q.by = null;
          p.by = who; p.till = now() + 4000;
        }
        if (m.e === 'drop') { p.by = null; p.f = f; p.rest = m.park && near && spec.face && spec.face !== f ? [spec.x, spec.y] : null; }
        if (m.e === 'place') {
          const why = !near ? 'far' : spec.after >= 0 && !sn.pieces[spec.after].done ? 'order' : spec.face && spec.face !== f ? 'face' : null;
          p.by = null; p.f = f; p.rest = why === 'face' ? [spec.x, spec.y] : null;
          if (why) no(why);
          else { p.done = true; p.who = who; if (sn.pieces.every((q) => q.done)) { sn.phase = 'won'; sn.wonAt = now(); } }
        }
      }
      // A stroke says which place in the rhythm it is meant for (`i`) and which showing it answers (`a`), so strokes
      // that arrive out of order still count, and one sent just before the rhythm was played again is not a mistake.
      if (kind === 'echo' && m.e === 'pad') {
        const p = m.p | 0, i = Number.isInteger(m.i) ? m.i : sn.step, two = !solo && both(), cfg = sc.echo;
        if (now() < sn.listenAt - 150 || p < 0 || p > 3 || (two && owner(p) !== who)) return;     // still being shown, or not this one's drum
        if ((m.a !== undefined && m.a !== sn.attempt) || i < 0 || i >= sn.pattern.length || sn.got.includes(i)) return;
        const ok = p === sn.pattern[i], at = Number.isFinite(m.at) ? clamp(m.at, sn.listenAt, now()) : now();   // when it was struck, by that device's clock
        sn.last = { p, ok, n: ++sn.n, who, i };                                        // so both devices can show and sound the stroke
        if (!ok) {                                                                     // a slip: the same rhythm is played once more; the first in a round is free
          sn.misses++;
          // with two, Kellyn's slip never takes the last heart: the younger is never the only reason they lose
          if (sn.slips++ > 0 && !(two && who === 'kel' && sn.lives === 1)) sn.lives--;
          if (sn.lives <= 0) sn.phase = 'lost'; else teach(sn.pattern.length, 1400);
          return;
        }
        // played only after its drum had lit up as a hint (see Echo in game.js): it still counts, but not for the third star
        const by = two ? owner(p) : who, hint = sn.round ? cfg.hint[by] : cfg.hint.first;
        if (sn.round && at - Math.max(sn.since, sn.listenAt) > hint * 1000) sn.hints++;
        sn.got.push(i); sn.since = Math.max(sn.since, at);
        while (sn.got.includes(sn.step)) sn.step++;
        if (sn.step >= sn.pattern.length) { sn.slips = 0; if (++sn.round >= sn.rounds) sn.phase = 'won'; else teach(sn.pattern.length + 1, 1700); }
      }
      if (kind === 'drums') {
        const by = sn.by || (sn.by = { ken: 0, kel: 0 }), n = m.n === 2 ? 2 : 1;
        if (m.e === 'hit') { sn.hits += n; by[who] += n; }
        if (m.e === 'miss' && by[who] > 0) { sn.hits--; by[who]--; }                           // banging away at nothing: it costs one's own hits, never the partner's
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
      if (m.type === 'pause' && sn && sn.pieces && sn.phase === 'play' && !sn.paused) for (const p of sn.pieces) p.by = null;   // moving in: a pause lets go of what is held
      // A pause stops the game's clock: on carrying on, every moment the game keeps is moved on by the pause.
      if (m.type === 'pause') { if (sn && sn.phase === 'play' && !sn.paused) { sn.paused = now(); sn.pausedBy = who; } }
      else if (m.type === 'resume') {
        if (sn && sn.paused) { const d = now() - sn.paused; for (const k of ['startAt', 'busyUntil', 'hideAt', 'pullAt', 'power', 'showAt', 'listenAt', 'endAt', 'finAt']) if (sn[k]) sn[k] += d; sn.paused = 0; }
      }
      // A save code typed in (see game.js): how far they had got, added to what is here.
      else if (m.type === 'load' && m.places && typeof m.places === 'object') merge({ places: m.places, round: S.save.round });
      // A new game: everything played is forgotten, on both phones.
      else if (m.type === 'restart' && S.where.screen !== 'scene') { S.save = { places: {}, album: [], round: (S.save.round | 0) + 1, stars: {} }; S.scene = null; S.where = { screen: 'map' }; }
      else if (m.type === 'back') {
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
      else if (m.type === 'next' && sn && sn.phase === 'talk' && (m.line === undefined || m.line === sn.line)) {
        sn.read = { ...(sn.read || {}), [who]: true };                                // with two playing, a line stays until both have read it
        if (solo || !both() || (sn.read.ken && sn.read.kel)) { sn.read = {}; if (++sn.line >= sc.talk.length) begin(); }
      }
      else if (m.type === 'done' && sn && sn.phase === 'stub') complete();
      else if (m.type === 'ev') event(who, m);
      else if (m.type === 'cont' && sn && sn.phase === 'won') complete();
      // Pexeso lost: another go with the same cards on the table, the pairs found staying found; only the wrong guesses start again.
      else if (m.type === 'retry' && sn && sn.phase === 'lost' && sc.play === 'memory') { start(sn.index, true); Object.assign(S.scene, { deck: sn.deck, done: sn.done, before: (sn.before || 0) + sn.misses }); }
      else if (m.type === 'retry' && sn && sn.phase === 'lost') start(sn.index, true);
      push();
    }

    return {
      state: S,
      tick() { if (S.scene && S.scene.paused) return; const a = salonTick(), b = clockTick(); if (a || b) push(); },
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
