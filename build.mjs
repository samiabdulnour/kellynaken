// Builds the site from config.json, src/ and photos/.
//   node build.mjs
// Output: docs/ (the complete site, ready to host) and .artifact/ (a head-less copy for claude.ai previews).
import fs from 'node:fs';
import crypto from 'node:crypto';

const here = new URL('.', import.meta.url).pathname;
const read = (p) => fs.readFileSync(here + p, 'utf8');
const liteSrc = read('src/lite.js');
const Lite = new Function(liteSrc + '\nreturn Lite;')();
const cfg = JSON.parse(read('config.json'));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// self-check the hash against Node's own before trusting it with anything
for (const s of ['', 'abc', 'x'.repeat(200)]) {
  const mine = Buffer.from(Lite.sha256(Lite.utf8(s))).toString('hex');
  const ref = crypto.createHash('sha256').update(s).digest('hex');
  if (mine !== ref) throw new Error('sha256 self-check failed');
}

// Salts are derived from the answers, so the same config always builds the same page.
const salt = (...parts) => crypto.createHash('sha256').update('salt|' + parts.join('|')).digest('hex').slice(0, 16);
const puzzle = (p) => {
  if (p.type === 'morse') return { type: 'morse', groups: Lite.code.morse(p.answer) };
  if (p.type === 'mirror') return { type: 'mirror', word: Lite.code.mirror(p.answer) };
  if (p.type === 'grid') return { type: 'grid', shots: Lite.code.grid(p.answer) };
  if (p.type === 'weave') return { type: 'weave', lines: Lite.code.weave(p.answer), numbered: !!p.numbered };
  throw new Error('unknown puzzle type ' + p.type);
};

// One chain per player, built backwards: each answer unlocks the next puzzle.
const chains = {}, answers = [];
for (const [id, pl] of Object.entries(cfg.players)) {
  const P = pl.periods;
  let payload = { note: P[P.length - 1].note, final: pl.final };
  for (let i = P.length - 1; i >= 0; i--) {
    const head = i === 0 ? { welcome: pl.postcard.welcome } : { note: P[i - 1].note };
    payload = { ...head, puzzle: puzzle(P[i]), hint: P[i].hint, next: Lite.seal(P[i].answer, salt(id, i + 1, Lite.norm(P[i].answer)), payload) };
  }
  chains[id] = Lite.seal(pl.postcard.password, salt(id, 0, Lite.norm(pl.postcard.password)), payload);
  // prove the chain opens with the right answers and not with a wrong one
  let box = chains[id];
  for (const a of [pl.postcard.password, ...P.map((p) => p.answer)]) {
    answers.push(a);
    if (Lite.open('WRONG', box) !== null) throw new Error('chain opened with a wrong answer');
    const opened = Lite.open(a.toLowerCase(), box);
    if (!opened) throw new Error(`chain for ${id} failed at ${a}`);
    box = opened.next;
  }
}

const cards = Object.fromEntries(Object.entries(cfg.players).map(([id, pl]) => [id, pl.card]));
const page = read('src/template.html')
  .replaceAll('@@SIGNOFF@@', esc(cfg.signoff))
  .replaceAll('@@FOOTER@@', esc(cfg.footer))
  .replace('/*@@NAMES@@*/null', () => JSON.stringify(cfg.names))
  .replace('/*@@CARDS@@*/null', () => JSON.stringify(cards))
  .replace('/*@@COOP@@*/null', () => JSON.stringify((cfg.coop && cfg.coop.server) || ''));
// no answer may be readable in the page, with or without accents and spaces
const flat = Lite.norm(page);
for (const a of answers) if (flat.includes(Lite.norm(a))) throw new Error('an answer is readable in the page source: ' + a);
const html = page.replace('/*@@LITE@@*/', () => liteSrc).replace('/*@@CHAINS@@*/null', () => JSON.stringify(chains));

// docs/: a complete page plus the photos, for GitHub Pages or any web host
const cut = html.indexOf('</style>') + '</style>'.length;
const full = `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<style>body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
${html.slice(0, cut)}
</head>
<body>
${html.slice(cut)}
</body>
</html>
`;
const photos = fs.readdirSync(here + 'photos').filter((f) => f.endsWith('.jpg'));
for (const dir of ['docs', '.artifact']) {
  fs.mkdirSync(here + dir, { recursive: true });
  for (const f of photos) fs.copyFileSync(here + 'photos/' + f, here + dir + '/' + f);
}
fs.writeFileSync(here + 'docs/index.html', full);
fs.writeFileSync(here + 'docs/.nojekyll', '');
fs.writeFileSync(here + '.artifact/index.html', html);

console.log('Built docs/index.html');
for (const [id, pl] of Object.entries(cfg.players)) {
  const numbers = Lite.code.jersey(pl.postcard.password, pl.postcard.key);
  console.log(`${cfg.names[id].nom}: "${pl.postcard.password}" (key ${pl.postcard.key}) -> ${numbers.join(' - ')}`);
}
