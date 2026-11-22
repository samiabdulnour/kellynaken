# Kellyn a Ken: art package for ChatGPT

Everything ChatGPT needs to draw the game's scenes and objects, in the order to ask for it. There are 14 images in all. The characters are yours and are not part of this.

## How to use this

1. Open **one new ChatGPT conversation** and keep all of this in it, so the style stays the same.
2. Paste **Step 0** first and **attach one of your finished character images** to that message, so the scenes are drawn to match them. Wait for "ready".
3. Then paste one prompt at a time, in the order below.
4. Save each result. When you send them to me, say which code each one is (S3, P2 and so on).

If a result is wrong:

- **It added people, animals or lettering to a scene:** reply `Same image, but with no people, no animals and no lettering.`
- **The style drifted** (smooth shading, tiny pixels, different colours): paste Step 0 again, then ask for the image again.
- **The layout is wrong** (ground not empty, frames not in a row): ask for it again from scratch. Editing a wrong layout rarely fixes it.
The background colour for objects is bright magenta on purpose. I cut it away afterwards.

---

## Step 0: style setup (paste first, with one of your character images attached)

```text
I'm making a pixel-art adventure game for two children. I'll ask you for images one at a time: background scenes and objects. Use these rules for every image in this conversation.

REFERENCE. The attached image is one of the game's finished characters. Everything you draw must look like it belongs in the same game: the same size of pixels, the same kind of outline and shading, and colours that sit well next to it. Do not draw this character, or any character, in the images I ask for.

STYLE. 16-bit era pixel art, like a Super Nintendo adventure game. Large, clearly visible square pixels on one consistent grid, as if the whole image were drawn about 192 pixels wide and then enlarged. Flat colours with simple two-tone shading, a thin dark outline around objects, crisp hard edges.

PALETTE. One small shared palette of about 32 colours, the same in every image. Warm and friendly: sunny yellow, brick red, royal blue, hot pink, teal and cream, with charcoal outlines. Where the attached character uses different colours, follow the character.

SCENES. A side-on stage view, like a classic side-scrolling game. Scenery fills the upper part of the image. The bottom third is flat, open ground where the characters will stand and move, kept clear of furniture and objects. Scenes are empty of people and animals, because I add the characters myself. Signs, posters and screens are blank shapes.

OBJECTS. Drawn on a plain, flat, bright magenta background (#FF00FF) with nothing else in the image: no ground, no shadow, no scenery. Same pixel size, outline and palette as the scenes. Seen from the side. Each object is separate, with clear magenta space all around it.

MOOD. Bright, playful, safe for children.

No text, no letters, no numbers, no logos, no watermark, no border.

Reply "ready" and wait for my first request.
```

---

## Part 1: the look (2 images)

Do these first. They set the look for everything else.

### S0. World map

```text
S0, the world map. Landscape, 3:2 (1536x1024). This one is a flat top-down map, so it has no ground strip.

A stylised pixel-art map of the whole world: chunky, simplified continents in greens and sandy yellows on a deep blue ocean with small wave marks. Europe and Australia are both clearly visible and uncluttered, because I will place level markers on them. The oceans hold a few playful details: a tiny sailing ship, an island with one palm tree, a compass rose in one corner, small white clouds. Even daylight, cheerful treasure-map feeling.

Same pixel-art style and palette as set up. No text, no labels, no markers.
```

### S1. Title screen

```text
S1, the title screen. Portrait, 2:3 (1024x1536).

Night over the rooftops of Prague. In the lower middle: red tiled roofs, chimneys, two church spires, warm yellow lit windows, and in the distance a river with an arched stone bridge. The upper half is open deep-blue sky with a large full moon and scattered stars, left empty because the game logo goes there. The bottom third is a flat rooftop terrace, clear and empty.

Same pixel-art style and palette as set up. No text.
```

---

## Part 2: Praha 5 (4 images)

### S2. At home

```text
S2, at home. Portrait, 2:3 (1024x1536).

A cosy living room in a flat in Prague. On the back wall: a large window showing a tram line and green hills with a small lookout tower, three framed black-and-white portrait drawings, shelves, and many green houseplants. Against the wall: a grey sofa with a zebra-striped cushion and a television on a white cabinet. A hockey stick leans in one corner and a gymnastics ribbon hangs from a hook. Warm evening lamp light. The bottom third is a wooden floor, clear and empty.

Same pixel-art style and palette as set up. No text.
```

### S3. The street (this one scrolls)

```text
S3, a street in Prague. Landscape, 3:2 (1536x1024).

A wide city street seen side-on. Along the back runs a row of four-storey nineteenth-century apartment houses in pastel yellow, pink, mint and cream, with ornate window frames and red tiled roofs. Their ground floors are small shops with blank awnings. In front of them: overhead tram wires, a tram stop shelter, old-fashioned street lamps and leafy trees. Far behind, a green hill with a small lookout tower. Sunny afternoon.

The bottom third is the roadway: cobblestones and tram tracks running perfectly straight from the left edge to the right edge, clear of vehicles and objects. Spread the buildings evenly and make the left and right edges look alike, because the game repeats this image side by side as the players run.

Same pixel-art style and palette as set up. No text.
```

### S4. The salon door

```text
S4, outside the hair salon. Portrait, 2:3 (1024x1536).

The front of a small hair salon on a Prague street at dusk. A shop window glows warm, showing the outlines of salon chairs and round mirrors inside. Above it, a pink-and-white striped awning. Beside the door, a red, white and blue barber pole and two potted plants. In the centre, the door is shut with a comically oversized combination lock and chains. The bottom third is pavement, clear and empty.

Same pixel-art style and palette as set up. No text.
```

### S5. Inside the salon

```text
S5, inside the hair salon. Portrait, 2:3 (1024x1536).

For this scene the floor takes the lower half of the image. On the back wall in the upper half: three round mirrors framed with light bulbs, salon chairs pushed against the wall, shelves of bottles and brushes, hairdryers on hooks, and a plant. The lower half is a wide open floor of pink-and-white checkerboard tiles in gentle perspective, completely empty, because the characters run around on it. Bright, cheerful light.

Same pixel-art style and palette as set up. No text.
```

---

## Part 3: Australia (4 images)

### S6. The beach

```text
S6, an Australian beach. Portrait, 2:3 (1024x1536).

A sunny surf beach. In the upper part: bright blue sky with a few puffy clouds, a turquoise sea with gentle white-capped waves, and a rocky headland in the distance. On the sand at the back: a lifeguard tower on stilts, a red-and-yellow flag on a pole, two palm trees, and surfboards stuck upright in the sand. Midday light. The bottom third is flat golden sand, clear and empty.

Same pixel-art style and palette as set up. No text.
```

### S7. The open sea (this one scrolls)

```text
S7, the open sea for a surfing level. Landscape, 3:2 (1536x1024).

Open ocean seen side-on. The top 60% is bright sky with scattered clouds, and far away a low coastline of red cliffs with a small lighthouse. The waterline runs perfectly straight across the whole image at 60% from the top. Below it is clear blue water in a few layered tones with lighter wave crests and foam marks, with nothing floating in it. Make the left and right edges look alike, because the game repeats this image side by side.

Same pixel-art style and palette as set up. No text.
```

### S8. The outback

```text
S8, the Australian outback. Portrait, 2:3 (1024x1536).

Golden hour in the red desert. On the horizon, one huge rounded red sandstone rock under an orange and pink sky. Closer: a few eucalyptus trees with pale trunks, tall termite mounds, tufts of spiky grass, and a metal windmill water pump. The bottom third is flat red earth, clear and empty.

Same pixel-art style and palette as set up. No text.
```

### S9. The shark reef

```text
S9, a tiny island in the sea. Portrait, 2:3 (1024x1536).

A small rocky islet seen side-on in the middle of deep blue water, under a bright sky. On top of the rock: one bent palm tree and a small empty wooden lookout platform with a ladder. Waves break white against the rock. Across the bottom third runs a wooden jetty deck from edge to edge, clear and empty, where the characters stand.

Same pixel-art style and palette as set up. No text.
```

---

## Part 4: objects (4 images)

### P1. Prague objects

```text
P1, objects for the Prague level. Landscape, 3:2 (1536x1024). Magenta background.

Eight separate objects in two rows of four, each with clear magenta space around it. Top row: a grey city pigeon standing; the same pigeon flapping its wings; a small rain puddle; a big brass padlock with a keyhole. Bottom row: a golden key; a pair of hairdresser's scissors; a pink hairdryer; a wooden comb. All seen from the side.

Same pixel-art style and palette as set up. No text.
```

### P2. The tram

```text
P2, a Prague tram. Landscape, 3:2 (1536x1024). Magenta background.

One long city tram seen exactly from the side, filling most of the width of the image: red on the lower half and cream on the upper half, with a row of windows, two doors, a pantograph on the roof and visible wheels. The destination board is a blank panel.

Same pixel-art style and palette as set up. No text, no numbers, no logos.
```

### P3. Australia objects

```text
P3, objects for the Australia level. Landscape, 3:2 (1536x1024). Magenta background.

Eight separate objects in two rows of four, each with clear magenta space around it. Top row: a grey shark fin with a little white foam at its base; the same fin leaning the other way; a wooden boomerang; the same boomerang turned a quarter turn. Bottom row: a yellow surfboard with a red stripe seen from the side; a kangaroo standing, seen from the side; the same kangaroo in mid-hop; a small palm tree.

Same pixel-art style and palette as set up. No text.
```

### P4. Rewards and map markers

```text
P4, rewards and map markers. Landscape, 3:2 (1536x1024). Magenta background.

Ten separate objects in two rows of five, each with clear magenta space around it. Top row: a wooden treasure chest with gold bands, closed; the same chest half open with light spilling out; the same chest fully open with a golden glow; a red heart; a gold star. Bottom row: a pink flower on a green stem; a postcard with a blank picture side and a blank stamp; a red map pin; a grey map pin with a small padlock on it; a green flag on a short pole.

Same pixel-art style and palette as set up. No text.
```

---

## Optional: a villain

Only if you decide the game should have one. This is a suggestion; change anything.

### C11. The Scrambler

```text
C11, the villain of the game, a comic trickster who locks things up with codes. Landscape, 3:2 (1536x1024). Magenta background.

This one is a character, drawn in the same style as the attached reference character: chunky, with a large head, seen from the side and facing right.

A funny, harmless-looking inventor, more silly than scary: tall and thin, in a long purple coat with oversized pockets, wearing a helmet shaped like a padlock, round green goggles, and a large wind-up key on his back. He carries a ring of keys.

Five drawings in one horizontal row. The first four are full body, seen from the side and facing right: standing with his hands on his hips; laughing with his head thrown back; shaking his fist; running away with his coat flapping. The fifth is a large head-and-shoulders portrait facing forward with a mischievous grin. The four full-body drawings are the same size, evenly spaced, feet on one straight line.

Same pixel-art style and palette as set up. No text, no logos.
```

---

## Checklist

| Code | What | Shape |
|---|---|---|
| S0 | World map | Landscape |
| S1 | Title screen | Portrait |
| S2 | Praha: at home | Portrait |
| S3 | Praha: the street | Landscape |
| S4 | Praha: the salon door | Portrait |
| S5 | Praha: inside the salon | Portrait |
| S6 | Australia: the beach | Portrait |
| S7 | Australia: the open sea | Landscape |
| S8 | Australia: the outback | Portrait |
| S9 | Australia: the shark reef | Portrait |
| P1 | Prague objects | Landscape |
| P2 | The tram | Landscape |
| P3 | Australia objects | Landscape |
| P4 | Rewards and map markers | Landscape |
| C11 | The Scrambler (optional) | Landscape |

## Your characters

Send them to me as they are. These make them easiest to drop in, but I can adapt:

- Side view, facing right. I mirror them for left.
- The whole body, the same size in every frame, feet on the same line.
- A plain single-colour or transparent background.
- For Kendrick and Kellyn: standing, running, jumping, hurt, cheering.
- For the people being rescued: standing, calling for help, happy.
