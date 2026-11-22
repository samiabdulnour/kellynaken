// The world: every place the kids can travel to, in the order they open.
// A new place is a new entry here plus its pictures in art/. Nothing else needs to change.
//
// Each place has four scenes. A scene has a background (bg), some lines of story (talk), and a way to play:
//   run     a side-scrolling dash: tap to jump the obstacles
//   stub    not built yet: shows a card and lets you carry on
// Texts are drafts. The story of who or what is behind it all is still open.
window.WORLD = {
  title: 'Kellyn a Ken',
  subtitle: 'Záchranná mise',
  heroes: {
    ken: { name: 'Kendrick', voc: 'Kendricku', color: '#CC2233', hair: '#7A4A22' },
    kel: { name: 'Kellyn', voc: 'Kellyn', color: '#F0448F', hair: '#A8733B' },
  },
  map: { bg: 'world-map', width: 432 },
  places: [
    {
      id: 'praha', name: 'Praha 5', pin: [226, 96],
      saves: [{ id: 'leila', name: 'Leila' }],
      look: { sky: '#8FD3F4', far: '#F2C078', far2: '#E7A6B5', ground: '#8A8F9C', line: '#5B6070' },
      scenes: [
        { id: 'praha-home', name: 'Doma', bg: 'praha-home', play: 'stub',
          talk: [['', 'Přišla pohlednice. Stojí na ní: Leila zůstala zamčená v salonu!'], ['hero', 'Jdeme pro ni.']] },
        { id: 'praha-street', name: 'Ulice', bg: 'praha-street', scroll: true, play: 'run',
          run: { seconds: 24, low: 'holub', high: '' },
          talk: [['', 'Salon je až na konci ulice. Klepni a přeskoč, co ti stojí v cestě.']] },
        { id: 'praha-door', name: 'Dveře salonu', bg: 'praha-door', play: 'stub',
          talk: [['', 'Dveře drží obří zámek.']] },
        { id: 'praha-salon', name: 'V salonu', bg: 'praha-salon', play: 'stub',
          talk: [['', 'Leila je uvnitř. Ještě kousek!']] },
      ],
      done: [['leila', 'Děkuju! A teď už mi tu NELÍTEJTE!']],
    },
    {
      id: 'australia', name: 'Austrálie', pin: [374, 214],
      saves: [{ id: 'sami', name: 'Sami' }, { id: 'zofia', name: 'Zofia' }],
      look: { sky: '#FFE2B0', far: '#D9622B', far2: '#C98A4B', ground: '#F5D7A1', line: '#D9A441' },
      scenes: [
        { id: 'australia-beach', name: 'Pláž', bg: 'australia-beach', play: 'stub',
          talk: [['', 'Další pohlednice, tentokrát z druhého konce světa. Sami a Zofia uvízli na moři!']] },
        { id: 'australia-sea', name: 'Na vlně', bg: 'australia-sea', scroll: true, play: 'run',
          run: { seconds: 30, low: 'žralok', high: 'bumerang' },
          talk: [['', 'Na prkno! Žraloka přeskoč, pod bumerangem zůstaň dole.']] },
        { id: 'australia-outback', name: 'Buš', bg: 'australia-outback', play: 'stub',
          talk: [['', 'Cesta vede přes rudou poušť.']] },
        { id: 'australia-reef', name: 'Žraločí útes', bg: 'australia-reef', play: 'stub',
          talk: [['', 'Támhle jsou! Na skále uprostřed moře.']] },
      ],
      done: [['sami', 'To byla jízda. Díky!'], ['zofia', 'Juchůů! Zachránili jste nás!']],
    },
    // Places that will open later. They show on the map as question marks.
    { id: 'soon-1', name: '???', pin: [118, 196], soon: true },
    { id: 'soon-2', name: '???', pin: [312, 118], soon: true },
  ],
};
