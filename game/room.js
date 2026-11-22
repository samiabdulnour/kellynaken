// The rules of a game session, shared by the server and the page.
//
// The game is always played by the two of them together, each on their own device. One room holds what they share:
// who is here, how far they have got, where they are, and the scene being played. Each device shows its own hero
// and reports what happens to it; the room counts lives and hits and decides when a scene is won or lost.
// On the server this file runs for real (server.mjs). With ?solo in the address the page runs it by itself,
// for trying things out on one device.
//
// Messages a device sends:
//   go {place}          open a place from the planet             open {index}     start one of its scenes
//   next                the next line of the story               done             leave a scene that has no game yet
//   ev {e, ...}         something that counts: hurt, hit, miss, pick, finish
//   fx {...}            something only to show on the other device (a jump, a shot, a drum tap)
//   cont / retry        after a scene is won / lost              home             back to the planet after a rescue
//   back                up one level
// The room answers everyone with its whole state after every change.
(function (root) {
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
        if (b > 7 && r() < 0.22) notes.push({ at: at + beat / 2, lane: 2 });
      }
      // the pick-up falls down the middle lane between two beats, about a third of the way into the song
      return { notes, beat, pick: sc.pickup ? { lane: 1, at: 2.6 + (Math.floor(cfg.beats * 0.3) + 0.5) * beat } : null };
    },
    shoot(seed, sc, every) {
      const r = rng(seed), targets = [];
      for (let at = 1.2, id = 0; id < 160; id++) { targets.push({ id, born: at, x: 74 + r() * 100, y: 56 + r() * 130, phase: r() * 6 }); at += every * (0.8 + r() * 0.4); }
      return { targets };
    },
  };

  function create({ world, solo, now, emit }) {
    const places = world.places, GAMES = ['run', 'drums', 'shoot'];
    const S = { online: { ken: false, kel: false }, save: { places: {}, album: [] }, where: { screen: 'planet' }, scene: null };
    let serial = 0;
    const prog = (id) => (S.save.places[id] = S.save.places[id] || { scene: 0, done: false });
    const isOpen = (p) => { const i = places.indexOf(p); return i === 0 || (i > 0 && prog(places[i - 1].id).done); };
    const both = () => S.online.ken && S.online.kel;
    const ready = () => !!solo || both();
    const place = () => places.find((p) => p.id === S.where.place);
    const push = () => emit('all', { type: 'state', now: now(), ready: ready(), solo: !!solo, online: S.online, save: S.save, where: S.where, scene: S.scene });

    // Two devices may each remember a different amount: keep whichever got further.
    function merge(save) {
      if (!save || typeof save !== 'object') return;
      for (const p of places) {
        const theirs = save.places && save.places[p.id];
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
      S.where = { screen: 'scene', place: p.id };
      if (skipTalk || !(sc.talk || []).length) begin();
    }
    // The talking is over: set up the game, counted for one player or two.
    function begin() {
      const sn = S.scene, sc = place().scenes[sn.index], two = both();
      if (!GAMES.includes(sc.play)) { sn.phase = 'stub'; return; }
      Object.assign(sn, { phase: 'play', startAt: now() + 1600, fin: {}, picked: false, power: 0 });
      if (sc.play === 'run') sn.lives = two ? 4 : 3;
      if (sc.play === 'shoot') Object.assign(sn, { lives: two ? 4 : 3, hits: 0, need: Math.round(sc.shoot.need * (two ? 1.6 : 1)), every: sc.shoot.every / (two ? 1.4 : 1), hit: [], missed: [], item: null });
      if (sc.play === 'drums') Object.assign(sn, { hits: 0, need: Math.ceil(course.drums(sn.seed, sc).notes.length * (sc.drums.pass || 0.6) * (two ? 2.3 : 1)) });    // two need more than one could ever drum alone
    }
    function complete() {
      const p = place(), pr = prog(p.id), index = S.scene.index;
      S.scene = null;
      if (!pr.done && index >= pr.scene) pr.scene = index + 1;
      if (pr.scene >= p.scenes.length && !pr.done) {
        pr.done = true;
        for (const s of p.saves) if (!S.save.album.includes(s.id)) S.save.album.push(s.id);
        S.where = { screen: 'rescued', place: p.id };
      } else S.where = { screen: 'place', place: p.id };
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
      if (kind === 'drums') {
        if (m.e === 'hit') sn.hits += m.n === 2 ? 2 : 1;
        if (m.e === 'finish') {                                                        // the song is over once everyone playing has said so
          sn.fin[who] = true;
          if (solo || (sn.fin.ken && sn.fin.kel)) sn.phase = sn.hits >= sn.need ? 'won' : 'lost';
        }
      }
    }

    function act(who, m) {
      if (!m || (who !== 'ken' && who !== 'kel')) return;
      if (m.type === 'fx') return emit(who === 'ken' ? 'kel' : 'ken', { ...m, type: 'fx', from: who });
      const sn = S.scene, sc = sn && place().scenes[sn.index];
      if (m.type === 'back') {
        if (S.where.screen === 'scene') { S.scene = null; S.where = { screen: 'place', place: S.where.place }; }
        else S.where = { screen: 'planet' };
      } else if (m.type === 'home') S.where = { screen: 'planet' };
      else if (!ready()) { /* nothing below may happen until both are here */ }
      else if (m.type === 'go') { const p = places.find((x) => x.id === m.place); if (p && isOpen(p) && S.where.screen !== 'scene') S.where = { screen: 'place', place: p.id }; }
      else if (m.type === 'open' && S.where.screen === 'place') { const p = place(), pr = prog(p.id), i = m.index | 0; if (p.scenes[i] && (pr.done || i <= pr.scene)) start(i); }
      else if (m.type === 'next' && sn && sn.phase === 'talk' && (m.line === undefined || m.line === sn.line)) { if (++sn.line >= sc.talk.length) begin(); }
      else if (m.type === 'done' && sn && sn.phase === 'stub') complete();
      else if (m.type === 'ev') event(who, m);
      else if (m.type === 'cont' && sn && sn.phase === 'won') complete();
      else if (m.type === 'retry' && sn && sn.phase === 'lost') start(sn.index, true);
      push();
    }

    return {
      state: S,
      join(who, save) { S.online[who] = true; merge(save); push(); },
      leave(who) {
        S.online[who] = false;
        if (!solo && S.scene) { S.scene = null; S.where = { screen: 'place', place: S.where.place }; }      // a scene cannot go on with one of them gone
        push();
      },
      act,
    };
  }

  root.Room = { rng, course, create };
})(typeof window !== 'undefined' ? window : globalThis);
