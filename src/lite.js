// Shared by the build script (Node) and the page (browser).
// Scrambles each stage with the previous answer as the key, so nothing
// readable sits in the page source. Kid-proof, not bank-proof.
const Lite = (() => {
  const K = [], H0 = [];
  (() => {
    const isPrime = (x) => { for (let i = 2; i * i <= x; i++) if (x % i === 0) return false; return true; };
    for (let n = 2; K.length < 64; n++) {
      if (!isPrime(n)) continue;
      if (H0.length < 8) H0.push((Math.pow(n, 1 / 2) * 4294967296) >>> 0);
      K.push((Math.pow(n, 1 / 3) * 4294967296) >>> 0);
    }
  })();

  function sha256(msg) {
    const l = msg.length;
    const padLen = ((l + 9 + 63) >> 6) << 6;
    const m = new Uint8Array(padLen);
    m.set(msg);
    m[l] = 0x80;
    const dv = new DataView(m.buffer);
    dv.setUint32(padLen - 8, Math.floor((l * 8) / 4294967296));
    dv.setUint32(padLen - 4, (l * 8) >>> 0);
    const h = H0.slice();
    const w = new Uint32Array(64);
    for (let off = 0; off < padLen; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const a = w[i - 15], b = w[i - 2];
        const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
        const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const ch = (e & f) ^ (~e & g);
        const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    }
    const out = new Uint8Array(32);
    const odv = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) odv.setUint32(i * 4, h[i] >>> 0);
    return out;
  }

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const utf8 = (s) => enc.encode(s);
  const cat = (...parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };
  const toB64 = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
  const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  // "Slap shot!" and "slapshot" count as the same answer.
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  const ROUNDS = 6000;
  function keyFrom(answer, salt) {
    const s = utf8(salt);
    let h = sha256(utf8(salt + '|' + norm(answer)));
    for (let i = 0; i < ROUNDS; i++) h = sha256(cat(h, s));
    return h;
  }
  function xorStream(key, data) {
    const out = new Uint8Array(data.length);
    const ctr = new Uint8Array(4);
    const cdv = new DataView(ctr.buffer);
    for (let off = 0, i = 0; off < data.length; off += 32, i++) {
      cdv.setUint32(0, i);
      const block = sha256(cat(key, ctr));
      for (let j = 0; j < 32 && off + j < data.length; j++) out[off + j] = data[off + j] ^ block[j];
    }
    return out;
  }
  const tagOf = (key, ct) => sha256(cat(key, utf8('tag'), ct)).slice(0, 8);

  function seal(answer, salt, obj) {
    const key = keyFrom(answer, salt);
    const ct = xorStream(key, utf8(JSON.stringify(obj)));
    return { s: salt, b: toB64(cat(tagOf(key, ct), ct)) };
  }
  // Returns the hidden object, or null when the answer is wrong.
  function open(answer, box) {
    if (!norm(answer)) return null;
    const raw = fromB64(box.b);
    const tag = raw.slice(0, 8), ct = raw.slice(8);
    const key = keyFrom(answer, box.s);
    const want = tagOf(key, ct);
    for (let i = 0; i < 8; i++) if (tag[i] !== want[i]) return null;
    try { return JSON.parse(dec.decode(xorStream(key, ct))); } catch (e) { return null; }
  }

  // ---- the four codes ----
  const MORSE = { A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..' };
  const GRID_ROWS = ['LK', 'ST', 'PK', 'OB', 'BR'];
  const GRID_COLS = 6;
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lettersOf = (s) => norm(s).replace(/[0-9]/g, '');

  const code = {
    // Jersey numbers: with key k, A wears k, B wears k+1 ... wrapping 26 -> 1.
    jersey: (word, key) => [...lettersOf(word)].map((ch) => ((ALPHA.indexOf(ch) + key - 1) % 26) + 1),
    morse: (word) => [...lettersOf(word)].map((ch) => MORSE[ch]),
    // grid: [row, column] pairs, column counted from 1
    grid: (word) => [...lettersOf(word)].map((ch) => { const i = ALPHA.indexOf(ch); return [Math.floor(i / GRID_COLS), (i % GRID_COLS) + 1]; }),
    mirror: (word) => lettersOf(word),
    weave: (word) => { const l = [...lettersOf(word)]; return [l.filter((_, i) => i % 2 === 0).join(''), l.filter((_, i) => i % 2 === 1).join('')]; },
  };

  return { sha256, utf8, norm, seal, open, code, MORSE, GRID_ROWS, GRID_COLS, ALPHA };
})();
