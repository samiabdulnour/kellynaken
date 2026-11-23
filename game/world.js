// The world: every place the kids can travel to, in the order they open, and the planet they are picked on.
// A new place is a new entry in `places`, a pin on the planet, and its pictures in art/. Nothing else needs to change.
//
// `planet.pins` sit at [x, y] on the world picture (art/source/S0, 384 x 192 in the game), which is wrapped around
// the planet. A pin leads to one place or, where several are too close together to tell apart from space
// (Praha 5 and Praha 6), to a short list. A pin marked `soon` is somewhere that opens later.
//
// Who is waiting to be rescued in a place (`saves`) is a surprise: the game never names them before they appear.
// Locked scenes show as ??? and the story lines only hint. Keep new texts that way. `cast` puts people into a
// scene once they have appeared.
//
// Each place has four scenes. A scene has a background (bg), some lines of story (talk), and a way to play.
// `ground` is how far down the picture feet stand, when it is not the usual 232 (the sea, the jetty).
// A scrolling picture is repeated with every other copy mirrored; `tile: 'repeat'` repeats it as it is.
//   run     a side-scrolling dash: tap to jump the obstacles
//   drums   notes fall down three lanes in time with the beat: tap each drum as its note reaches the line
//   echo    a rhythm is played on four drums and has to be played back; each of them has two of the drums
//   find    koalas peek out of the trees: tap them while they show; drag to look around a wide picture
//   salon   customers want washing, cutting, dyeing, drying and paying: lead them from place to place and work there
//   shoot   targets pop up and slip away: tap where the shot should go. Kendrick fires a puck with his hockey stick,
//           Kellyn throws her white bunny
//   stub    not built yet: shows a card and lets you carry on
//
// `pickup` puts one of the `items` into a scene, to grab like a power-up: jump into it in a dash, hit it in a shot,
// catch it on the line in the drums. Each item belongs to one saga: the drumstick to Praha 6 (the drumming),
// the boomerang to Australia. In a dash any item lets you smash through whatever you run into for a few seconds;
// in a shot each has its own trick; in the drums the drumstick makes every hit count twice for a while.
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
    drumstick: { name: 'Palička', art: ['strahov', 'sticks'], dash: 'Palička! Chvíli rozbiješ všechno, do čeho vběhneš.', shot: 'Palička! Každá rána je dvojitá.', drums: 'Palička! Chvíli se každá trefa počítá dvakrát.' },
    boomerang: { name: 'Bumerang', art: ['aussie', 'boomerang'], dash: 'Bumerang! Chvíli smete všechno, co ti stojí v cestě.', shot: 'Bumerang! Každá rána se vrací.' },
  },
  planet: {
    bg: 'world-map',
    pins: [
      { name: 'Praha', at: [198, 52], places: ['praha5', 'praha6'] },
      { name: 'Austrálie', at: [352, 145], places: ['australia'] },
      { at: [105, 115], soon: true },
      { at: [315, 62], soon: true },
    ],
  },
  places: [
    {
      id: 'praha5', name: 'Praha 5',
      saves: [{ id: 'leila', name: 'Mamka' }],           // Leila on the character sheet; in the game she is Mamka
      look: { sky: '#8FD3F4', far: '#F2C078', far2: '#E7A6B5', ground: '#A39B96', line: '#7A6F6A' },
      scenes: [
        { id: 'praha-home', name: 'Doma', bg: 'praha-home', play: 'stub',
          talk: [['', 'Doma je divné ticho. Někdo tu chybí…'], ['hero', 'Jdeme zjistit, co se stalo.']] },
        { id: 'praha-street', name: 'Ulice', bg: 'praha-street', scroll: true, play: 'run',
          run: { seconds: 24, low: 'holub', high: '', art: { low: ['prague', 'pigeon'] } },
          talk: [['', 'Stopa vede ulicí. Klepni a přeskoč, co ti stojí v cestě.']] },
        { id: 'praha-door', name: 'Zamčené dveře', bg: 'praha-door', play: 'shoot',
          shoot: { need: 8, every: 1.5, stay: 3.4, sway: 0, target: 'zámek' },
          talk: [['', 'Dveře drží samé zámky. Kdo je asi za nimi?'], ['hero', 'Ty zámky sestřelím!']] },
        // From here on she is found: the salon is full and she cannot get away until every customer is done.
        { id: 'praha-salon', name: 'V salonu', bg: 'praha-salon', play: 'salon', cast: ['leila'],
          salon: {
            seconds: 150, need: 5, patience: 36, every: [11, 15],
            stations: [{ k: 'wash', x: 30, y: 184 }, { k: 'cut', x: 70, y: 184 }, { k: 'dye', x: 110, y: 184 }, { k: 'dry', x: 150, y: 184 }, { k: 'pay', x: 120, y: 262 }],
            work: { wash: 3, cut: 4, dye: 4, dry: 3, pay: 1.2 },
            orders: [['cut', 'pay'], ['wash', 'cut', 'dry', 'pay'], ['wash', 'dye', 'dry', 'pay'], ['wash', 'cut', 'dye', 'dry', 'pay'], ['wash', 'dry', 'pay']],
          },
          talk: [['', 'Uvnitř je plno. Zákazníci čekají až ke dveřím a kadeřnice nestíhá.'], ['leila', 'Konečně! Dokud tu někdo čeká, nemůžu odejít.'], ['leila', 'Umýt, ostříhat, obarvit, vyfoukat a nakonec zaplatit. Hurá do práce!']] },
      ],
      done: [['leila', 'Děkuju! A teď už mi tu NELÍTEJTE!']],
    },
    {
      id: 'praha6', name: 'Praha 6', area: 'Strahov',
      saves: [{ id: 'alan', name: 'Alan' }],
      look: { sky: '#BFE3F2', far: '#A9A6A0', far2: '#8A9A72', ground: '#7FAE66', line: '#5C8650' },
      scenes: [
        { id: 'strahov-hill', name: 'Do kopce', bg: 'strahov-hill', scroll: true, play: 'run', pickup: 'drumstick',
          run: { seconds: 26, low: 'šiška', high: 'vrána', art: { low: ['strahov', 'cone'], high: ['strahov', 'crow'] } },
          talk: [['', 'Z kopce nad městem někdo volá o pomoc.'], ['', 'Nahoru se musí pěšky. Šišku přeskoč, pod vránou zůstaň dole.']] },
        { id: 'strahov-gate', name: 'Brána stadionu', bg: 'strahov-gate', play: 'shoot', pickup: 'drumstick',
          shoot: { need: 10, every: 1.3, stay: 3.2, sway: 10, target: 'zámek' },
          talk: [['', 'Starý strahovský stadion. Brána je zavřená na řetěz a zámky se na něm houpou.']] },
        // From here on he is found: he shows the rhythm, and at the concert he plays along.
        { id: 'strahov-drums', name: 'Zkušebna', bg: 'strahov-drums', play: 'echo', cast: ['alan'],
          echo: { rounds: 6, first: 3, beat: 0.6 },
          talk: [['', 'Pod tribunou je zkušebna. A v ní někdo bubnuje!'], ['alan', 'Večer hraju na stadionu a kapela nikde. Zahrajete to se mnou?'], ['alan', 'Nejdřív zkouška. Já zahraju, vy to po mně zopakujete.']] },
        { id: 'strahov-concert', name: 'Koncert', bg: 'strahov-concert', play: 'drums', pickup: 'drumstick', cast: ['alan'],
          drums: { bpm: 104, beats: 72, pass: 0.62, busy: 0.35 }, say: { won: ['Stadion šílí!', 'Takový koncert tu dlouho nebyl.'] },
          talk: [['', 'Stadion je plný. Světla, pódium a vy tři.'], ['alan', 'Trefujte noty, až budou na čáře. Raz, dva, tři, čtyři!']] },
      ],
      done: [['alan', 'To byl koncert! Díky, parťáci.']],
    },
    {
      id: 'australia', name: 'Austrálie',
      saves: [{ id: 'sami', name: 'Sami' }, { id: 'zofia', name: 'Žofia' }],
      look: { sky: '#FFE2B0', far: '#D9622B', far2: '#C98A4B', ground: '#F5D7A1', line: '#D9A441' },
      scenes: [
        { id: 'australia-beach', name: 'Pláž', bg: 'australia-beach', play: 'stub',
          talk: [['', 'Na druhém konci světa vyplavilo moře láhev. Uvnitř je jediné slovo: POMOC!']] },
        { id: 'australia-sea', name: 'Na vlně', bg: 'australia-sea', scroll: true, play: 'run', ground: 200, tile: 'repeat', pickup: 'boomerang',
          run: { seconds: 30, low: 'žralok', high: 'bumerang', board: true, art: { low: ['aussie', 'fin', 'fin2'], high: ['aussie', 'boomerang', 'boomerang2'] } },
          talk: [['', 'Na prkno! Žraloka přeskoč, pod bumerangem zůstaň dole.']] },
        // The bush wants a wide forest picture of its own (S15 in the art package, 'australia-bush'); the hiding places below fit the
        // picture it borrows for now and must be set again for the new one. [x, y] on the picture.
        { id: 'australia-outback', name: 'Buš', bg: 'australia-outback', play: 'find',
          find: { seconds: 60, need: 8, show: 1.2, every: [4, 7], spots: [[22, 64], [44, 90], [30, 116], [92, 108], [118, 118], [132, 112], [84, 140], [176, 138], [12, 142]] },
          talk: [['', 'Cesta vede buší. Ve stromech se něco hýbe…'], ['hero', 'Koaly! Najdeme je všechny.']] },
        { id: 'australia-reef', name: 'Žraločí útes', bg: 'australia-reef', play: 'stub', ground: 246,
          talk: [['', 'Támhle někdo mává! Na skále uprostřed moře.']] },
      ],
      done: [['sami', 'To byla jízda. Díky!'], ['zofia', 'Juchůů! Zachránili jste nás!']],
    },
  ],
};
