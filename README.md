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

## Build

```bash
node build.mjs
```

It needs Node 18 or newer and nothing else. It rewrites `docs/` and prints the numbers to write on each postcard.

## Put it online with GitHub Pages

In the repository on GitHub: **Settings → Pages → Build and deployment → Deploy from a branch**, pick `main` and the `/docs` folder, then save.
The site appears at `https://<your-user>.github.io/kellynaken/` a minute or two later.

## Change the content

Edit `config.json`, run the build, commit `config.json` and `docs/`.
Answers are matched without accents, spaces or capitals, so `čepice na led` and `CEPICENALED` are the same.
