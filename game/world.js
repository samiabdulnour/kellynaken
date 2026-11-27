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
//   tower   build a house storey by storey: drive the crane to the stack, pick a storey up, bring it over the house and
//           let it go; with two, one drives the crane and the other works the hook
//   shoot   padlocks appear on the `spots` of the picture and slip away: tap one to shoot at it (with two, each has their own colour). Kendrick fires a puck with his hockey stick,
//           Kellyn throws her white bunny
//   flat    moving in: drag the furniture from the heap to its silhouette in the rooms, tap a piece to turn it round,
//           before the sun goes down in the windows
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
        { id: 'praha-home', name: 'Doma', at: [22, 234], label: 'below', bg: 'praha-home', play: 'shoot', code: 'ZAMEK',
          shoot: { need: 16, every: 1.5, stay: 3.4, sway: 2, target: 'zámek',                 // padlocks on the lamp, the three portraits, the shelves and baskets, the sofa, the TV and its cabinet
            spots: [[96, 30], [60, 76], [94, 76], [128, 76], [9, 46], [8, 112], [70, 138], [126, 142], [176, 110], [168, 42], [180, 74], [178, 162]] },
          talk: [['', 'Doma je divné ticho. Někdo tu chybí…'], ['', 'A někdo vás zamkl! Na dveřích, na skříních, všude visí zámky.'], ['hero', 'Ty zámky sestřelím!']] },
        // A walk down the street to the salon (play 'platform', see Room.course.platform): ◀ ▶ walk, Skok, Hoď.
        // blocks [x, width, height, kind] stand on the pavement and can be climbed; foes [kind, from, to, height,
        // speed, every]; items [kind, x, height]. Heights are above the pavement, in game pixels. Flyers swoop 12 up and
        // down, and fly 60 above whatever is under them: they only catch someone who jumps into them.
        { id: 'praha-street', name: 'Ulice', at: [52, 250], label: 'right', bg: 'praha-street', scroll: true, play: 'platform', music: 'street', code: 'HOLUB',
          platform: { length: 2640, goal: 2552, gate: 'salon',
            // parked cars 24 high, a bench seat 13, a waste container 28, a brick wall 26 (the pictures in tools/sprites.py, P17)
            blocks: [[170, 40, 13, 'bench'], [330, 30, 28, 'bin'], [460, 50, 24, 'car1'], [610, 60, 24, 'car2'],
              [780, 48, 26, 'wall'], [900, 40, 13, 'bench'], [1010, 30, 28, 'bin'], [1120, 60, 24, 'car2'], [1250, 50, 24, 'car1'],
              [1420, 48, 26, 'wall'], [1530, 40, 13, 'bench'], [1650, 30, 28, 'bin'], [1680, 48, 26, 'wall'], [1820, 50, 24, 'car1'], [1960, 60, 24, 'car2'],
              [2120, 40, 13, 'bench'], [2230, 30, 28, 'bin'], [2350, 50, 24, 'car1'], [2470, 48, 26, 'wall']],
            foes: [['pigeon', 90, 150, 0, 14], ['pigeon', 230, 310, 0, 18], ['puddle', 400], ['pigeon', 528, 600, 0, 18],
              ['pigeon', 466, 504, 24, 12], ['flyer', 680, 760, 60, 22], ['pigeon', 850, 894, 0, 20], ['puddle', 962], ['pigeon', 1066, 1112, 0, 22],
              ['flyer', 1150, 1260, 84, 26], ['pigeon', 1322, 1400, 0, 24],
              ['puddle', 1512], ['pigeon', 1592, 1640, 0, 24], ['pigeon', 1596, 1646, 0, 30], ['flyer', 1700, 1820, 86, 28], ['pigeon', 1826, 1864, 24, 14],
              ['puddle', 1922], ['flyer', 1960, 2100, 84, 30], ['pigeon', 2052, 2110, 0, 26],
              ['pigeon', 2176, 2226, 0, 28], ['puddle', 2312], ['flyer', 2250, 2400, 88, 34], ['pigeon', 2416, 2462, 0, 28], ['pigeon', 2532, 2550, 0, 20], ['flyer', 2430, 2540, 86, 36]],
            items: [['coin', 178, 30], ['coin', 190, 30], ['coin', 202, 30], ['coin', 345, 46], ['coin', 470, 40], ['coin', 485, 40], ['coin', 500, 40],
              ['coin', 625, 40], ['coin', 640, 40], ['coin', 655, 40], ['coin', 700, 10], ['coin', 720, 10], ['comb', 804, 34], ['coin', 910, 30], ['coin', 922, 30],
              ['coin', 934, 30], ['coin', 1025, 46], ['coin', 1135, 40], ['coin', 1150, 40], ['coin', 1165, 40], ['coin', 1262, 40], ['coin', 1277, 40],
              ['coin', 1444, 44], ['heart', 1550, 32], ['coin', 1665, 46], ['clip', 1704, 34], ['coin', 1830, 40], ['coin', 1845, 40], ['coin', 1860, 40],
              ['coin', 1975, 40], ['coin', 1990, 40], ['coin', 2005, 40], ['coin', 2130, 30], ['coin', 2145, 30], ['heart', 2245, 46], ['coin', 2360, 40],
              ['coin', 2375, 40], ['coin', 2494, 44], ['coin', 2515, 10], ['coin', 2535, 10]] },
          talk: [['', 'Venku na chodníku leží hřeben a kousek dál sponka do vlasů. Stopa vede ulicí!'], ['', 'Šipkami jdeš, Skok skáče, Hoď hází. Na holuby skoč, nebo je traf!']] },
      ],
      done: [['', 'Stopa končí před kadeřnictvím. Najdete ho na mapě.']],
    },
    // The salon, also in Praha 5: locked, and the key is under the pexeso cards. Inside, someone is waiting.
    {
      id: 'kadernictvi', name: 'Kadeřnictví', area: 'Praha 5', region: 'praha',
      saves: [{ id: 'leila', name: 'Mamka' }],           // Leila on the character sheet; in the game she is Mamka
      look: { sky: '#8FD3F4', far: '#F2C078', far2: '#E7A6B5', ground: '#A39B96', line: '#7A6F6A' },
      scenes: [
        { id: 'praha-door', name: 'Před salonem', at: [62, 284], label: 'right', bg: 'praha-door', play: 'memory', code: 'KLIC',
          memory: { pairs: 8, miss: 10, key: true, won: 'A pod poslední dvojicí byl klíč. Dveře jsou odemčené!',
            faces: [['salonkit', 'scissors'], ['salonkit', 'comb'], ['salonkit', 'brush'], ['salonkit', 'dryer'], ['salonkit', 'spray'], ['salonkit', 'dye'], ['salonkit', 'curlers'], ['salonkit', 'mirror']] },
          talk: [['', 'Kadeřnictví je zamčené. Na dveřích visí cedulka: Klíč dostane, kdo najde všechny dvojice.'], ['', 'Na lavičce před dveřmi leží kartičky. Samé kadeřnické věci.'], ['hero', 'Pexeso! Jeden otočí první kartičku, druhý k ní hledá dvojici.']] },
        // From here on she is found: the salon is full and she cannot get away until every customer is done.
        { id: 'praha-salon', name: 'V salonu', at: [44, 262], label: 'right', bg: 'praha-salon', play: 'salon', code: 'NUZKY', cast: ['leila'],
          salon: {
            seconds: 180, need: 7, patience: 36, every: [11, 15],
            // along the back wall: the basin, the picture's own two chairs at the mirrors (cutting, dyeing) and the dryer;
            // `chair` means the picture already has it. The till stands in front. `side` is where the hairdresser stands.
            stations: [{ k: 'wash', x: 18, y: 142, side: 20 }, { k: 'cut', x: 58, y: 142, chair: true, side: 20 }, { k: 'dye', x: 133, y: 142, chair: true, side: -20 },
              { k: 'dry', x: 174, y: 142, side: -36 }, { k: 'pay', x: 120, y: 262, side: -18 }],
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
        // Up the hill to the stadium, on foot: stone stairs with cones rolling down them, crows overhead, and the drumstick.
        { id: 'strahov-hill', name: 'Do kopce', at: [40, 196], label: 'right', bg: 'strahov-hill', scroll: true, play: 'platform', music: 'street', code: 'SISKA', pickup: 'drumstick',
          platform: { length: 2640, goal: 2552, gate: 'stadium',
            // terraces of stone (any size), a boulder 22 high and a pile of logs 22, standing on whatever is under them (P18)
            blocks: [[260, 380, 8, 'stones'], [300, 340, 16, 'stones'], [340, 300, 24, 'stones'], [470, 30, 46, 'boulder'],
              [760, 40, 22, 'logs'], [860, 360, 8, 'stones'], [900, 320, 16, 'stones'], [940, 280, 24, 'stones'], [980, 240, 32, 'stones'], [1080, 40, 54, 'logs'],
              [1340, 40, 13, 'bench'], [1460, 30, 22, 'boulder'], [1580, 300, 8, 'stones'], [1620, 260, 16, 'stones'], [1660, 220, 24, 'stones'], [1760, 30, 46, 'boulder'],
              [2040, 40, 22, 'logs'], [2200, 40, 13, 'bench'], [2330, 30, 22, 'boulder'], [2440, 40, 22, 'logs']],
            foes: [['crow', 110, 250, 60, 24], ['cone', 240, 636, 0, 40, 4.4], ['crow', 520, 660, 84, 26], ['pigeon', 680, 750, 0, 20],
              ['crow', 700, 860, 60, 28], ['cone', 840, 1216, 0, 44, 3.8], ['crow', 1000, 1150, 92, 30], ['pigeon', 1240, 1330, 0, 22],
              ['crow', 1360, 1520, 60, 30], ['cone', 1560, 1876, 0, 46, 3.4], ['crow', 1680, 1860, 84, 32], ['pigeon', 1900, 2030, 0, 26],
              ['crow', 1960, 2120, 60, 32], ['cone', 2100, 2490, 0, 48, 3.2], ['crow', 2240, 2400, 60, 34], ['pigeon', 2370, 2430, 0, 28], ['crow', 2400, 2540, 60, 36]],
            items: [['note', 150, 14], ['note', 170, 14], ['note', 370, 40], ['note', 390, 40], ['note', 410, 40], ['pickup', 485, 62], ['note', 560, 40],
              ['note', 580, 40], ['note', 700, 12], ['note', 720, 12], ['note', 780, 36], ['note', 1000, 48], ['note', 1020, 48], ['note', 1040, 48],
              ['note', 1100, 68], ['note', 1150, 48], ['heart', 1290, 14], ['note', 1355, 28], ['note', 1370, 28], ['note', 1475, 36], ['note', 1690, 40],
              ['note', 1710, 40], ['note', 1775, 60], ['note', 1830, 40], ['note', 1950, 12], ['note', 1970, 12], ['heart', 2060, 36], ['note', 2215, 28],
              ['note', 2345, 36], ['note', 2460, 36], ['note', 2500, 12]] },
          talk: [['', 'Z kopce nad městem někdo volá o pomoc.'], ['', 'Nahoru se musí pěšky. Pozor na šišky a vrány!'], ['', 'Když najdeš paličku, chvíli smeteš všechno v cestě.']] },
        { id: 'strahov-gate', name: 'Brána stadionu', at: [62, 149], label: 'below', bg: 'strahov-gate', play: 'shoot', code: 'BRANA',
          shoot: { need: 16, every: 1.3, stay: 3.2, sway: 3, target: 'zámek',                 // padlocks on the gates under the stands, the stair railing and the rail above
            spots: [[52, 186], [70, 186], [88, 186], [106, 186], [124, 186], [140, 186], [164, 160], [180, 150], [120, 150], [96, 152]] },
          talk: [['', 'Velký strahovský stadion. Všechny vchody jsou zavřené a na mřížích visí zámky.']] },
        // From here on he is found: he shows the rhythm, and at the concert he plays along.
        { id: 'strahov-drums', name: 'Zkušebna', at: [18, 136], label: 'below', bg: 'strahov-drums', play: 'echo', code: 'BUBEN', cast: ['alan'],
          echo: { rounds: 6, first: 2, beat: 0.6 },
          talk: [['', 'Pod tribunou je zkušebna. A v ní někdo bubnuje!'], ['alan', 'Večer hraju na stadionu a kapela nikde. Zahrajete to se mnou?'], ['alan', 'Nejdřív zkouška. Já zahraju, vy to po mně zopakujete.']] },
        { id: 'strahov-concert', name: 'Koncert', at: [42, 125], label: 'right', bg: 'strahov-concert', play: 'drums', code: 'PODIUM', pickup: 'drumstick', cast: ['alan'],
          drums: { bpm: 104, beats: 96, pass: 0.62, busy: 0.35 }, say: { won: ['Stadion šílí!', 'Takový koncert tu dlouho nebyl.'] },
          talk: [['', 'Stadion je plný. Světla, pódium a vy tři.'], ['alan', 'Trefujte noty, až budou na čáře. Raz, dva, tři, čtyři!']] },
      ],
      done: [['alan', 'To byl koncert! Díky, parťáci.']],
    },
    {
      id: 'australia', name: 'Austrálie', region: 'australia',
      saves: [{ id: 'sami', name: 'Sami' }, { id: 'zofia', name: 'Žofia' }],
      look: { sky: '#FFE2B0', far: '#D9622B', far2: '#C98A4B', ground: '#F5D7A1', line: '#D9A441' },
      scenes: [
        { id: 'australia-beach', name: 'Pláž Bondi', at: [120, 244], label: 'below', bg: 'australia-beach', play: 'collect', code: 'LAHEV', ground: 226,
          collect: { seconds: 55, need: 15, stay: 3.6, every: [1.0, 1.7], jelly: 0.24, won: 'Na vzkazu stojí: POMOC! Jsme na skále za útesem.' },
          // The saga opens like a short film: the voyage, his photograph, and today's two travellers seen from behind.
          talk: [['', 'Po válce utekl praděda Václav z Československa. Na lodi s uprchlíky plul přes celý oceán až do Austrálie.', null, 'ship'],
            ['', 'Byl to skvělý chlap. Dva roky pracoval ve vnitrozemí, získal australské občanství a pak žil v Brisbane.', null, 'photo'],
            ['', 'Na fotce je i jeho malý pejsek Filip. Bydlel s pradědou v jeho posledních letech.', null, 'photo'],
            ['', 'A nějaký čas tu žil i váš druhý praděda, Georges.', null, 'photo'],
            ['', 'Dnes se po stopách pradědy Václava vydali dva cestovatelé. Chtěli vidět místa, kde kdysi žil.', null, 'travellers'],
            ['', 'Jenže na pláži Bondi teď vyplavilo moře roztrhaný vzkaz v láhvi.'], ['hero', 'Posbíráme všechny kousky, než je vlny zase odnesou!']] },
        { id: 'australia-sea', name: 'Na vlně', at: [136, 230], label: 'right', bg: 'australia-sea', scroll: true, play: 'run', code: 'SURF', ground: 200, tile: 'repeat', pickup: 'boomerang',
          run: { seconds: 40, low: 'žralok', high: 'papoušek', board: true, art: { low: ['aussie', 'fin', 'fin2'], high: ['parrot', 'parrot1', 'parrot2'] } },
          talk: [['', 'Za útesem se zvedají pořádné vlny. Vy to zvládnete na prkně!'], ['', 'Na prkno! Žraloka přeskoč, pod papouškem zůstaň dole.']] },
        // Koalas sit still, small, in the forks and on the trunks of the bush picture (S15). A hiding place is [x, y, pose]:
        // where its feet are on the picture, and whether it hugs the trunk (branch), looks round it (side) or peeks over leaves (peek).
        { id: 'australia-outback', name: 'Buš', at: [151, 102], label: 'left', bg: 'australia-bush', play: 'find', code: 'KOALA', ground: 284,
          find: { seconds: 100, need: 10, hidden: true, size: 0.28, show: 0.45, every: [6, 10],                 // a wide bush, four and a half screens
            spots: [[78, 130, 'branch'], [36, 94, 'peek'], [132, 80, 'peek'], [205, 140, 'branch'], [262, 88, 'side'], [190, 52, 'peek'], [152, 170, 'side'],
              [314, 160, 'side'], [352, 140, 'branch'], [402, 62, 'peek'], [418, 160, 'side'], [505, 160, 'side'], [472, 76, 'peek'], [560, 86, 'peek'],
              [640, 150, 'branch'], [606, 40, 'peek'], [706, 160, 'branch'], [766, 112, 'peek'], [820, 150, 'branch'], [792, 60, 'peek'], [742, 176, 'side']] },
          talk: [['', 'Cesta vede buší. Ve stromech se něco hýbe…'], ['hero', 'Koaly! Najdeme je všechny.']] },
        // From here on they are found: stranded on the rock, waving.
        { id: 'australia-reef', name: 'Žraločí útes', at: [147, 63], label: 'left', bg: 'australia-reef', play: 'rescue', code: 'ZRALOK', ground: 246, cast: ['sami', 'zofia'],
          rescue: { hits: 3, pull: 45, seconds: 14, land: { x: 92, y: 140, w: 18 }, green: [0.18, 0.44], jetty: 206 },
          talk: [['', 'Támhle někdo mává! Na skále uprostřed moře, a kolem krouží žralok.'], ['hero', 'Hodíme jim záchranné kruhy!']] },
        // After the rescue: Sami is an architect, and his house in Sydney is waiting to be built.
        { id: 'australia-sydney', name: 'Sydney', at: [98, 228], label: 'left', bg: 'australia-sydney', play: 'tower', code: 'JERAB', cast: ['sami', 'zofia'],
          tower: { need: 15, slack: 15, stack: 16 },   // `stack`: where the storeys wait on the ground, to be picked up one by one                // 14 storeys on the lobby; the higher, the harder (room.js: course.sway, course.slack)
          talk: [['sami', 'Díky, že jste nás zachránili! Víte, že jsem architekt?'], ['sami', 'Navrhl jsem v Sydney nový dům. Jenže stavba se zasekla a sám ho nepostavím.'],
            ['zofia', 'Kendrick bude řídit jeřáb a Kellyn bude pouštět patra. Spolu to zvládnete!'], ['hero', 'Jdeme stavět!']] },
        // The new flat is empty. In Sydney people put furniture they no longer need out on the kerb: walk the street of
        // terrace houses and find everything on the list (play 'platform', with `list`: the door of the flat opens only
        // when all of it is found). Ibises walk the footpath, magpies swoop.
        // The pieces on the list are items named like their pictures, standing where `h` says (on the footpath, or on top
        // of a pile); touching one takes it. The junk to climb is kerbside rubbish: a box 18 high, an old TV 23, a bin 23
        // (each fitted to its width: 34, 30, 24), stacked by putting one over another. Magpies ['magpie', from, to, height,
        // speed, every] glide high and every few seconds dive at whoever is near (game.js); only a dive can hurt, and it
        // is seen coming. `forgiving`: the gentler controls (a jump pressed a moment early or late still counts, a knock
        // pushes you back off what hurt you, one who stops to free the other from a bubble is not dived at).
        // No step is taller than 23 (a short press of Skok), from either side, so a child going back is never stuck.
        // `later`: a piece a neighbour puts out only once another is found (the plant, once the shelf is): it turns up a
        // little way back, so it is found by turning round. The rug in the dip between two TVs can be jumped over too.
        { id: 'sydney-kerb', name: 'Nábytek', at: [112, 204], label: 'left', bg: 'sydney-street', scroll: true, play: 'platform', music: 'street', code: 'GAUC', cast: ['sami', 'zofia'], ground: 228,
          platform: { length: 2640, goal: 2552, gate: 'flat', forgiving: true, list: ['sofa', 'armchair', 'lamp', 'table', 'chair', 'shelf', 'rugroll', 'plant', 'bed'], later: { plant: 'shelf' },
            blocks: [[400, 34, 18, 'box'], [490, 34, 18, 'box'], [524, 34, 18, 'box'],
              [720, 34, 18, 'box'], [754, 30, 23, 'tv'], [752, 34, 41, 'box'], [786, 34, 18, 'box'], [1010, 24, 23, 'bin'], [1090, 34, 18, 'box'],
              [1310, 34, 18, 'box'], [1344, 30, 23, 'tv'], [1420, 30, 23, 'tv'], [1452, 34, 18, 'box'],
              [1620, 24, 23, 'bin'], [1644, 24, 23, 'bin'], [1740, 34, 18, 'box'], [1774, 30, 23, 'tv'], [1772, 34, 41, 'box'], [1806, 30, 23, 'tv'], [1806, 30, 46, 'tv'], [1836, 30, 23, 'tv'],
              [2080, 24, 23, 'bin'],
              [2200, 34, 18, 'box'], [2234, 30, 23, 'tv'], [2232, 34, 41, 'box'], [2266, 30, 23, 'tv'], [2266, 30, 46, 'tv'], [2296, 30, 23, 'tv'], [2296, 30, 46, 'tv'],
              [2326, 30, 23, 'tv'], [2326, 30, 46, 'tv'], [2356, 30, 23, 'tv']],
            foes: [['ibis', 250, 330, 0, 10], ['ibis', 600, 670, 0, 14], ['magpie', 680, 900, 116, 20, 7], ['ibis', 920, 990, 0, 18], ['ibis', 1022, 1022, 23, 0],
              ['magpie', 1080, 1270, 112, 22, 6], ['ibis', 1215, 1270, 0, 20], ['ibis', 1500, 1580, 0, 22], ['ibis', 1630, 1658, 23, 10],
              ['magpie', 1540, 1730, 120, 24, 5], ['ibis', 1900, 1990, 0, 24], ['ibis', 1960, 2040, 0, 28], ['magpie', 1880, 2100, 112, 26, 4.5],
              ['ibis', 2272, 2290, 46, 8], ['magpie', 2230, 2420, 130, 26, 4], ['ibis', 2410, 2470, 0, 22]],   // the last ibis keeps clear of the door, which pushes back whoever comes too soon
            items: [['armchair', 170, 0], ['table', 524, 18], ['lamp', 769, 41], ['chair', 880, 0], ['heart', 1107, 34], ['sofa', 1180, 0],
              ['rugroll', 1398, 0], ['shelf', 1789, 41], ['plant', 1712, 0], ['heart', 2092, 38], ['bed', 2326, 46]] },
          talk: [['sami', 'Dům stojí, jenže náš nový byt je úplně prázdný.'], ['zofia', 'V Sydney lidi dávají nábytek, který už nechtějí, ven na chodník. Kdo chce, ten si ho vezme!'],
            ['sami', 'Seznam máte nahoře. Najděte všechno, co na něm je.'], ['', 'Pozor na ibisy a straky!']] },
        // Moving in before night: the flat seen like a dollhouse, two rooms; drag every piece to its place (play 'flat').
        // A place is [piece, x, y, size, facing, after]: where the piece's feet stand on the picture (the bedroom floor is
        // y 98-136, the living room's 229-282; the heap lies along the bottom, so nothing stands below 256 there), how big
        // it is drawn (of its picture in the furniture or kerb sheet), which way round it must stand (1 as drawn, -1
        // turned round, 0 either way; shown by its silhouette) and which piece must be down first. The rug ('rugroll',
        // rolled up in the heap) lies flat; the sofa and the coffee table stand on it. Two get a fifth more time.
        { id: 'sydney-flat', name: 'Byt', at: [80, 240], label: 'below', bg: 'sydney-flat', play: 'flat', code: 'BYT', cast: ['sami', 'zofia'], ground: 274,
          flat: { seconds: 120,
            places: [['bed', 50, 114, 0.62, 1], ['shelf', 104, 100, 0.55, 0], ['chair', 153, 124, 0.42, 0],
              ['rugroll', 98, 251, 0.62, 0], ['sofa', 98, 239, 0.45, 0, 'rugroll'], ['table', 98, 252, 0.4, 0, 'rugroll'],
              ['lamp', 62, 236, 0.42, 0], ['armchair', 141, 247, 0.42, 0], ['plant', 25, 254, 0.36, -1]] },
          talk: [['zofia', 'Všechno máme! Teď to rychle nastěhovat, než se setmí.'], ['', 'Táhni věci na svá místa. Klepnutím je otočíš.']] },
      ],
      done: [['sami', 'Díky! Dům stojí a byt je zařízený. Sám bych to nikdy nezvládl.'], ['zofia', 'Juchůů! Zachránili jste nás, postavili mrakodrap a ještě nás nastěhovali!']],
    },
  ],
};
