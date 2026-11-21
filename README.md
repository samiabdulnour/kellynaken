# Tajné operace

A code-cracking game for two kids, in Czech. Each gets a handwritten postcard with a number code.
The code opens their own operation on the site:

- **Kendrick, Operace Hattrick** (hockey): three codes, three goals, a secret in the net.
- **Kellyn, Operace Zlatá medaile** (gymnastics): three codes, bronze, silver and gold, a secret under the podium.

Each operation has two minigames that hand over pieces of a code.

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
that the two of them play together, each on their own phone.

| Boss | Round |
|---|---|
| Alan | Drums. The boss plays a pattern on four pads and the kids repeat it. Each kid owns two of the pads. |
| Sami | Australia. A kangaroo that cannot be hit while it is in the air. |
| Leila | The salon. Fast, a hairdryer that blows shots away, and she darts off when hit. |

In the two fights both kids tap the boss and share one health bar. Two hits close together count triple.
A boss that beats them comes back with a little less health.

This part needs a small server, because a plain web host cannot connect two phones:

```bash
node server.mjs
```

Then open `http://localhost:8080` on two devices on the same network, or in two browser windows, one as each kid.
`server.mjs` serves `docs/` and keeps the shared round; it has no dependencies.
On a host without it, such as GitHub Pages, the rest of the site works and the co-op card simply does not appear.

The bosses, their difficulty and the shared final message live under `coop` in `config.json`.
To give a boss a face, add `photos/boss-<id>.jpg` (a square crop) and rebuild.
If the page is hosted somewhere else, set `coop.server` to the server's address.

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
