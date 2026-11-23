# Tajné operace

A code-cracking game for two kids, in Czech. Each gets a handwritten postcard with a number code.
The code opens their own operation on the site:

- **Kendrick, Operace Hattrick** (hockey): three codes, three goals, a secret in the net.
- **Kellyn, Operace Zlatá medaile** (gymnastics): three codes, bronze, silver and gold, a secret under the podium.

Each operation has two minigames that hand over pieces of a code.

## The pixel game (in progress)

The game is being rebuilt as a continuing pixel-art adventure: Kendrick and Kellyn travel the world rescuing people.
It lives beside the current game, at `/v2/`, until it is ready to take over. The postcard will simply carry the link.

It is always played by the two of them together, each on their own device: one is Kendrick, the other Kellyn.
Nothing starts until both are there; they travel, read the story and play every scene together, and share the lives,
the hits and the items. What they share lives in one room on the server (`server.mjs`, under `/v2/api/`), so the
game has to be opened from the server's address. Each device also remembers the progress, so a restarted server is
told how far they had got. Adding `?solo` to the address plays it alone on one device, for trying things out.

Levels are picked on a spinning planet. Each place has four scenes, and who is waiting to be rescued there is a
surprise: the game never names them before they are free.

| Place | Rescued there | Built so far |
|---|---|---|
| Praha 5, at home | Mamka (Leila) | pexeso with hairdressing things at home (one turns the first card, the other the second), a dash down the street, shooting the locks off the door, running the salon together (wash, cut, dye, dry, take the money) |
| Praha 6, Strahov | Alan | a dash up the hill, the locks on the stadium gate, repeating Alan's rhythms in the rehearsal room, the concert; the drumstick is this saga's item |
| Australia | Sami and Žofia | picking up a torn message on Bondi beach, a dash across the sea, spotting small koalas hidden in the bush, throwing lifebuoys and pulling them off the shark reef; the boomerang is this saga's item |

Kendrick shoots a puck with his hockey stick; Kellyn throws her white bunny and stars.
Some scenes hold an item to pick up, like a power-up. The drumstick is for hitting: in a dash the hero whacks whatever
comes at them for a few seconds, and in the drums every hit counts twice. The boomerang is for throwing: in a dash it gives
three throws that fly ahead, knock out the first thing in the way and come back.

| Path | What it is |
|---|---|
| `game/world.js` | The world: the planet's pins, every place, its four scenes, the story lines. A new place is a new entry here plus its pictures. |
| `game/room.js` | The rules of a session, shared by the server and the page: who is here, where they are, lives and hits, what each scene throws at them. |
| `game/engine.js` | The pixel screen (192 x 288, scaled by whole numbers), scenes, input, saving, art loading. |
| `game/game.js` | Title, the planet, places, the games inside a scene (dash, drums, shot), the album. Shows the room's state and reports what its own hero does. |
| `art/CHATGPT-PACK.md` | The prompts for drawing the scenes and objects in the style of the character sheets. |
| `art/scenes.json` | Which picture is which scene, and its size in the game. |
| `art/source/` | The pictures as they come back from ChatGPT, named by code: `S3.png`. |
| `art/source/characters.webp` | The character sheet: six cards of standing figures, action poses and faces. |
| `tools/sprites.py` | Cuts the characters: the heroes' drawn poses from `art/source/poses/`, the grown-ups' sheets of eight figures from `art/source/people/`, the faces, and rows of objects from `art/source/objects/`. Dark outlines round the characters become darker shades of their own colours. |
| `tools/pixelate.py` | Shrinks those pictures to the game's true pixel size, keeping every colour and edge as painted. |

All 14 scene backgrounds and all six characters are in. The objects (obstacles, targets, the puck, the bunny, the
hockey stick, the items) are still drawn stand-ins. Until a picture exists the game draws a stand-in for it, so everything is playable before the art arrives.
To add art: drop the pictures into `art/source/`, run `python3 tools/pixelate.py` (scenes) or `python3 tools/sprites.py`
(characters; needs numpy and Pillow), then `node build.mjs`.

## Layout

| Path | What it is |
|---|---|
| `config.json` | Names, passwords, answers, hints and the final messages. **Contains every answer.** |
| `src/template.html` | The page: styles, markup, games. |
| `src/lite.js` | The ciphers and the scrambling that keeps answers out of the page source. |
| `photos/` | Face crops and card photos. |
| `build.mjs` | Builds the site. |
| `docs/` | The built site, ready to host. |
| `server.mjs` | Serves `docs/` and runs the play-together rounds. |

## Build

```bash
node build.mjs
```

It needs Node 18 or newer and nothing else. It rewrites `docs/` and prints the numbers to write on each postcard.

## Put it online with GitHub Pages

In the repository on GitHub: **Settings → Pages → Build and deployment → Deploy from a branch**, pick `main` and the `/docs` folder, then save.
The site appears at `https://<your-user>.github.io/kellynaken/` a minute or two later.

## Playing together

When a kid finishes their own operation, the final card offers **Společná mise**: three boss rounds
that the two of them play together, each on their own phone. The bosses' names stay hidden until each one appears.

| Boss | Round |
|---|---|
| Alan | Drums. The boss plays a pattern on four pads and the kids repeat it. Each kid owns two of the pads. |
| Sami | Surfing. A runner on a shared wave: tap to jump the sharks, stay low under the boomerangs. Every crash costs one of the shared lives. A friend dashes through every few seconds and throws a heart: jump to catch it and win a life back. |
| Leila | The salon. Both kids run around one room collecting flowers for her while she chases whoever is nearest. Whoever she catches gets combed for a moment, and a flower wilts. |

A round that beats them comes back a little kinder, so they cannot get stuck forever.
Getting through all three drops a treasure chest: tap it and it opens on a special photo and the shared final message.

This part needs a small server, because a plain web host cannot connect two phones:

```bash
node server.mjs
```

Then open `http://localhost:8080` on two devices on the same network, or in two browser windows, one as each kid.
`server.mjs` serves `docs/` and keeps the shared round; it has no dependencies.
On a host without it, the rest of the site works and the co-op card simply does not appear.

The bosses, their difficulty and the shared final message live under `coop` in `config.json`.
Photos go in `photos/` as square crops, then rebuild:

| File | Used for |
|---|---|
| `boss-<id>.jpg` | A boss's face. Without it the boss shows their initial. |
| `boss-<id>-cool.jpg`, `boss-<id>-serious.jpg` | Optional extra faces for the drum boss: while playing the pattern, and after a wrong note. |
| `truhla.jpg` | The special photo inside the chest. |
| `zofia-1.jpg` … | Faces for the friend who dashes through the surfing round and throws hearts. Listed under that boss's `cameo` in `config.json`. |

### Hosting the server

The room lives in one process's memory, so whatever hosts it must run **one** instance.

**Render** (free plan): `render.yaml` describes the service. In Render choose New → Blueprint, pick this repository
and apply. A free service goes to sleep after about 15 minutes without visitors and takes around a minute to wake.
The page pings the server every few minutes while it is open, so it stays awake while the kids play.

Two ways to use it:

- **Everything on Render.** One address, nothing to configure. The first visit after a quiet spell waits for the wake-up.
- **Site on GitHub Pages, co-op on Render.** The site always opens instantly. Set `coop.server` in `config.json`
  to the Render address (for example `https://kellynaken.onrender.com`), rebuild and commit.

**Fly.io**: `Dockerfile` and `fly.toml` are there as an alternative. Deploy as a single machine.

None of these hosting files has been deployed yet.

## Change the content

Edit `config.json`, run the build, commit `config.json` and `docs/`.
Answers are matched without accents, spaces or capitals, so `čepice na led` and `CEPICENALED` are the same.
