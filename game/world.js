// The world: every place the kids can travel to, in the order they open, and the maps they are picked on.
// A new place is a new entry in `places`, a pin on one of the maps, and its pictures in art/. Nothing else needs to change.
//
// The maps nest. The planet (`planet`: art/source/S0, 384 x 192 in the game, wrapped around a ball) shows the world,
// with a pin for each country. The Česko pin zooms in to the map of Czechia (`map`), where Prague, under a
// magnifying glass, opens the map of Prague. Each region (`regions`: Praha, Austrálie) has a map of its own, and on
// it every level is a pin of its own at the spot where it happens: a scene's `at` is [x, y] on that picture and
// `label` the side its name goes. The maps are drawn by tools/maps.py, which also prints where things are on them.
// A pin with `later` is a place that opens in the future. A place's levels open one after another, and the next
// place opens once one is done; the version for trying levels out (/v3/) has everything open.
//
// Who is waiting to be rescued in a place (`saves`) is a surprise: the game never names them before they appear.
// Locked scenes show as ??? and the story lines only hint. Keep new texts that way. `cast` puts people into a
// scene once they have appeared. A story line can name a third thing, someone it tells of: their face is shown with
// the line. A fourth thing shows a picture instead of the scene while the line is read ('ship', 'photo',
// 'travellers': the opening of Australia, told like a short film, with the past in old-photo colours).
// A place with nobody to rescue (Domov) ends with its `done` lines on a card, and the next place opens.
//
// A place has a few scenes. A scene has a background (bg), some lines of story (talk), and a way to play.
// `ground` is how far down the picture feet stand, when it is not the usual 232 (the sea, the jetty).
// A scrolling picture is repeated with every other copy mirrored; `tile: 'repeat'` repeats it as it is.
//   run     a side-scrolling dash: tap to jump the obstacles
//   drums   notes fall down three lanes in time with the beat: tap each drum as its note reaches the line
//   echo    a rhythm is played on four drums and has to be played back; each of them has two of the drums
//   find    koalas peek out of the trees: tap them while they show; drag to look around a wide picture
//   salon   customers want washing, cutting, dyeing, drying and paying: lead them from place to place and work there
//   memory  pexeso: one turns the first card over, the other turns the second looking for its pair; then they swap.
//           With `key`, a key comes out from under the last pair: it opens the door to the next scene
//   collect run along the beach picking up what the waves wash in, and keep away from the jellyfish
//   rescue  throw lifebuoys to the people on the rock, then pull them across before the shark gets there
//   tower   build a house storey by storey: one drives the crane, the other lets each storey go
//   shoot   targets pop up and slip away: tap where the shot should go. Kendrick fires a puck with his hockey stick,
//           Kellyn throws her white bunny
//   stub    not built yet: shows a card and lets you carry on
//
// `pickup` puts one of the `items` into a scene, to grab like a power-up: jump into it in a dash, hit it in a shot,
// catch it on the line in the drums. Each item belongs to one saga: the drumstick to Strahov (the drumming),
// the boomerang to Australia. The drumstick is for hitting: in a dash the hero whacks whatever comes at them for a few
// seconds, and in the drums every hit counts twice. The boomerang is for throwing: in a dash it gives three throws
// that fly ahead, knock out the first thing in the way and come back.
// Texts are drafts. The story of who or what is behind it all is still open.
window.WORLD = {
  title: 'Kellyn a Ken',
  subtitle: 'Rodinná mise',
  server: 'https://kellynaken.onrender.com',     // where the room lives, when the page itself is served from somewhere else
  heroes: {
    ken: { name: 'Kendrick', shirt: '#33313A', legs: '#3F5E9E', badge: '#F08BA0', hair: '#8A5A2B' },
    kel: { name: 'Kellyn', shirt: '#BFE8D0', legs: '#F6C1D0', badge: '#F08BA0', hair: '#9A6535', tie: '#F3A6C0' },
  },
  items: {
    drumstick: { name: 'Palička', art: ['strahov', 'sticks'], use: 'hit', dash: 'Palička! Chvíli praštíš do všeho, co ti stojí v cestě.', shot: 'Palička! Každá rána je dvojitá.', drums: 'Palička! Chvíli se každá trefa počítá dvakrát.' },
    boomerang: { name: 'Bumerang', art: ['aussie', 'boomerang'], use: 'throw', dash: 'Bumerang! Klepni na Hoď a smete, co ti stojí v cestě. Máš tři hody.', shot: 'Bumerang! Každá rána se vrací.' },
  },
  // Czechia, close up: Prague under the glass (tapping anywhere on the glass opens it), and Ostrov.
  map: {
    bg: 'czech-map', name: 'Česko',
    pins: [
      { region: 'praha', at: [96, 208], label: 'below', glass: [96, 202, 52] },
      { later: 'ostrov', at: [29, 65], label: 'below' },
    ],
  },
  planet: {
    bg: 'world-map',
    pins: [
      { name: 'Česko', at: [198, 52], map: true },          // zooms in to the map of Czechia
      { name: 'Austrálie', at: [352, 145], region: 'australia' },
      { name: 'Kypr', at: [215, 69], later: ['kypr'] },
      { name: 'Libanon', at: [228, 73], later: ['libanon'] },
      { name: 'Thajsko', at: [290, 93], later: ['thajsko'] },
    ],
  },
  // The maps the levels are picked on. `up` is the map one goes back out to; `later` puts places that are not
  // open yet on the map, locked.
  regions: {
    praha: { name: 'Praha', bg: 'praha-map', up: 'map', later: [{ id: 'zimni', at: [156, 94], label: 'below' }] },
    australia: { name: 'Austrálie', bg: 'australia-map', up: 'planet' },
  },
  // Places that will open later. They show on the maps, locked, with their names. To open one, give it scenes
  // and move it into `places` (and on its pin from `later` to `place`, or `places` on the planet).
  later: [
    { id: 'zimni', name: 'Zimní stadion', area: 'Praha 7' },
    { id: 'ostrov', name: 'Ostrov', area: 'u Karlových Varů' },
    { id: 'kypr', name: 'Kypr' },
    { id: 'libanon', name: 'Libanon' },
    { id: 'thajsko', name: 'Thajsko' },
  ],
  places: [
    // Home in Praha 5: someone is missing, and somebody has locked the kids in. The trail leads down the street.
    {
      id: 'domov', name: 'Domov', area: 'Praha 5', region: 'praha',
      saves: [],
      look: { sky: '#8FD3F4', far: '#F2C078', far2: '#E7A6B5', ground: '#A39B96', line: '#7A6F6A' },
      scenes: [
        { id: 'praha-home', name: 'Doma', at: [26, 222], label: 'below', bg: 'praha-home', play: 'shoot',
          shoot: { need: 8, every: 1.5, stay: 3.4, sway: 0, target: 'zámek' },
          talk: [['', 'Doma je divné ticho. Někdo tu chybí…'], ['', 'A někdo vás zamkl! Na dveřích, na skříních, všude visí zámky.'], ['hero', 'Ty zámky sestřelím!']] },
        { id: 'praha-street', name: 'Ulice', at: [64, 232], label: 'below', bg: 'praha-street', scroll: true, play: 'run',
          run: { seconds: 24, low: 'holub', high: '', art: { low: ['prague', 'pigeon'] } },
          talk: [['', 'Venku na chodníku leží hřeben a kousek dál sponka do vlasů. Stopa vede ulicí!'], ['', 'Klepni a přeskoč, co ti stojí v cestě.']] },
      ],
      done: [['', 'Stopa končí před kadeřnictvím. Najdete ho na mapě.']],
    },
    // The salon, also in Praha 5: locked, and the key is under the pexeso cards. Inside, someone is waiting.
    {
      id: 'kadernictvi', name: 'Kadeřnictví', area: 'Praha 5', region: 'praha',
      saves: [{ id: 'leila', name: 'Mamka' }],           // Leila on the character sheet; in the game she is Mamka
      look: { sky: '#8FD3F4', far: '#F2C078', far2: '#E7A6B5', ground: '#A39B96', line: '#7A6F6A' },
      scenes: [
        { id: 'praha-door', name: 'Před salonem', at: [94, 212], label: 'right', bg: 'praha-door', play: 'memory',
          memory: { pairs: 8, miss: 10, key: true, won: 'A pod poslední dvojicí byl klíč. Dveře jsou odemčené!',
            faces: [['salonkit', 'scissors'], ['salonkit', 'comb'], ['salonkit', 'brush'], ['salonkit', 'dryer'], ['salonkit', 'spray'], ['salonkit', 'dye'], ['salonkit', 'curlers'], ['salonkit', 'mirror']] },
          talk: [['', 'Kadeřnictví je zamčené. Na dveřích visí cedulka: Klíč dostane, kdo najde všechny dvojice.'], ['', 'Na lavičce před dveřmi leží kartičky. Samé kadeřnické věci.'], ['hero', 'Pexeso! Jeden otočí první kartičku, druhý k ní hledá dvojici.']] },
        // From here on she is found: the salon is full and she cannot get away until every customer is done.
        { id: 'praha-salon', name: 'V salonu', at: [106, 198], label: 'right', bg: 'praha-salon', play: 'salon', cast: ['leila'],
          salon: {
            seconds: 150, need: 5, patience: 36, every: [11, 15],
            stations: [{ k: 'wash', x: 30, y: 184 }, { k: 'cut', x: 70, y: 184 }, { k: 'dye', x: 110, y: 184 }, { k: 'dry', x: 150, y: 184 }, { k: 'pay', x: 120, y: 262 }],
            work: { wash: 3, cut: 4, dye: 4, dry: 3, pay: 1.2 },
            orders: [['cut', 'pay'], ['wash', 'cut', 'dry', 'pay'], ['wash', 'dye', 'dry', 'pay'], ['wash', 'cut', 'dye', 'dry', 'pay'], ['wash', 'dry', 'pay']],
          },
          talk: [['', 'Klíč pasuje! Uvnitř je plno. Zákazníci čekají až ke dveřím a kadeřnice nestíhá.'], ['leila', 'Konečně! Dokud tu někdo čeká, nemůžu odejít.'], ['leila', 'Umýt, ostříhat, obarvit, vyfoukat a nakonec zaplatit. Hurá do práce!']] },
      ],
      done: [['leila', 'Děkuju! A teď už mi tu NELÍTEJTE!']],
    },
    {
      id: 'praha6', name: 'Strahov', area: 'Praha 6', region: 'praha',
      saves: [{ id: 'alan', name: 'Alan' }],
      look: { sky: '#BFE3F2', far: '#A9A6A0', far2: '#8A9A72', ground: '#7FAE66', line: '#5C8650' },
      scenes: [
        { id: 'strahov-hill', name: 'Do kopce', at: [40, 186], label: 'right', bg: 'strahov-hill', scroll: true, play: 'run', pickup: 'drumstick',
          run: { seconds: 26, low: 'šiška', high: 'vrána', art: { low: ['strahov', 'cone'], high: ['strahov', 'crow'] } },
          talk: [['', 'Z kopce nad městem někdo volá o pomoc.'], ['', 'Nahoru se musí pěšky. Šišku přeskoč, pod vránou zůstaň dole.']] },
        { id: 'strahov-gate', name: 'Brána stadionu', at: [62, 149], label: 'below', bg: 'strahov-gate', play: 'shoot',
          shoot: { need: 10, every: 1.3, stay: 3.2, sway: 10, target: 'zámek' },
          talk: [['', 'Velký strahovský stadion. Všechny vchody jsou zavřené a na mřížích visí zámky.']] },
        // From here on he is found: he shows the rhythm, and at the concert he plays along.
        { id: 'strahov-drums', name: 'Zkušebna', at: [18, 136], label: 'below', bg: 'strahov-drums', play: 'echo', cast: ['alan'],
          echo: { rounds: 6, first: 3, beat: 0.6 },
          talk: [['', 'Pod tribunou je zkušebna. A v ní někdo bubnuje!'], ['alan', 'Večer hraju na stadionu a kapela nikde. Zahrajete to se mnou?'], ['alan', 'Nejdřív zkouška. Já zahraju, vy to po mně zopakujete.']] },
        { id: 'strahov-concert', name: 'Koncert', at: [42, 125], label: 'right', bg: 'strahov-concert', play: 'drums', pickup: 'drumstick', cast: ['alan'],
          drums: { bpm: 104, beats: 72, pass: 0.62, busy: 0.35 }, say: { won: ['Stadion šílí!', 'Takový koncert tu dlouho nebyl.'] },
          talk: [['', 'Stadion je plný. Světla, pódium a vy tři.'], ['alan', 'Trefujte noty, až budou na čáře. Raz, dva, tři, čtyři!']] },
      ],
      done: [['alan', 'To byl koncert! Díky, parťáci.']],
    },
    {
      id: 'australia', name: 'Austrálie', region: 'australia',
      saves: [{ id: 'sami', name: 'Sami' }, { id: 'zofia', name: 'Žofia' }],
      look: { sky: '#FFE2B0', far: '#D9622B', far2: '#C98A4B', ground: '#F5D7A1', line: '#D9A441' },
      scenes: [
        { id: 'australia-beach', name: 'Pláž Bondi', at: [120, 244], label: 'below', bg: 'australia-beach', play: 'collect', ground: 226,
          collect: { seconds: 60, need: 8, stay: 3.6, every: [1.0, 1.7], jelly: 0.24, won: 'Na vzkazu stojí: POMOC! Jsme na skále za útesem.' },
          // The saga opens like a short film: the voyage, his photograph, and today's two travellers seen from behind.
          talk: [['', 'Po válce utekl praděda Václav z Československa. Na lodi s uprchlíky plul přes celý oceán až do Austrálie.', null, 'ship'],
            ['', 'Byl to velký muž. Dva roky pracoval ve vnitrozemí, získal australské občanství a pak žil v Brisbane.', null, 'photo'],
            ['', 'Na fotce je i jeho malý pejsek Filip. Bydlel s pradědou v jeho posledních letech.', null, 'photo'],
            ['', 'A nějaký čas tu žil i váš druhý praděda, Georges.', null, 'photo'],
            ['', 'Dnes se po stopách pradědy Václava vydali dva cestovatelé. Chtěli vidět místa, kde kdysi žil.', null, 'travellers'],
            ['', 'Jenže na pláži Bondi teď vyplavilo moře roztrhaný vzkaz v láhvi.'], ['hero', 'Posbíráme všechny kousky, než je vlny zase odnesou!']] },
        { id: 'australia-sea', name: 'Na vlně', at: [136, 230], label: 'right', bg: 'australia-sea', scroll: true, play: 'run', ground: 200, tile: 'repeat', pickup: 'boomerang',
          run: { seconds: 30, low: 'žralok', high: 'bumerang', board: true, art: { low: ['aussie', 'fin', 'fin2'], high: ['aussie', 'boomerang', 'boomerang2'] } },
          talk: [['', 'Za útesem se zvedají pořádné vlny. Vy to zvládnete na prkně!'], ['', 'Na prkno! Žraloka přeskoč, pod bumerangem zůstaň dole.']] },
        // Koalas sit still, small, in the forks and on the trunks of the bush picture (S15). A hiding place is [x, y, pose]:
        // where its feet are on the picture, and whether it hugs the trunk (branch), looks round it (side) or peeks over leaves (peek).
        { id: 'australia-outback', name: 'Buš', at: [151, 102], label: 'left', bg: 'australia-bush', play: 'find', ground: 284,
          find: { seconds: 75, need: 7, hidden: true, size: 0.28, show: 0.45, every: [6, 10],
            spots: [[53, 118, 'branch'], [188, 130, 'branch'], [150, 32, 'side'], [104, 66, 'side'], [133, 106, 'branch'], [121, 180, 'peek'],
              [318, 60, 'side'], [392, 90, 'branch'], [322, 114, 'branch'], [417, 148, 'branch'], [362, 222, 'peek'], [262, 178, 'branch']] },
          talk: [['', 'Cesta vede buší. Ve stromech se něco hýbe…'], ['hero', 'Koaly! Najdeme je všechny.']] },
        // From here on they are found: stranded on the rock, waving.
        { id: 'australia-reef', name: 'Žraločí útes', at: [147, 63], label: 'left', bg: 'australia-reef', play: 'rescue', ground: 246, cast: ['sami', 'zofia'],
          rescue: { hits: 2, pull: 70, seconds: 14, land: { x: 92, y: 140, w: 13 }, green: [0.22, 0.40], jetty: 206 },
          talk: [['', 'Támhle někdo mává! Na skále uprostřed moře, a kolem krouží žralok.'], ['hero', 'Hodíme jim záchranné kruhy!']] },
        // After the rescue: Sami is an architect, and his house in Sydney is waiting to be built.
        { id: 'australia-sydney', name: 'Sydney', at: [98, 228], label: 'left', bg: 'australia-sydney', play: 'tower', cast: ['sami', 'zofia'],
          tower: { need: 7, slack: 21 },
          talk: [['sami', 'Díky, že jste nás zachránili! Víte, že jsem architekt?'], ['sami', 'Navrhl jsem v Sydney nový dům. Jenže stavba se zasekla a sám ho nepostavím.'],
            ['zofia', 'Kendrick bude řídit jeřáb a Kellyn bude pouštět patra. Spolu to zvládnete!'], ['hero', 'Jdeme stavět!']] },
      ],
      done: [['sami', 'Díky, dům stojí! Sám bych ho nikdy nepostavil.'], ['zofia', 'Juchůů! Zachránili jste nás a ještě jste postavili mrakodrap!']],
    },
  ],
};
