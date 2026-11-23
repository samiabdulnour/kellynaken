# Kellyn a Ken: art package for ChatGPT

Everything ChatGPT needs to draw the game's scenes and objects so they match your characters.

## Where things stand

- **Scenes S0 to S15: done.** S6 has been redrawn as Bondi Beach, and S14 (the concert) was drawn from photos of the real Strahov stadium.
- **Objects P1, P3, P5, P7, P8, P9, P10: done**, made through the Figma connection and in the game: obstacles, padlocks, the puck, the bunny, the items, drums, koalas, the salon's work places and customers.
- **Poses A1 to A6: done.** Both heroes are drawn from them.
- **S15, the bush forest: done**, drawn after your photo of the real bush.
- **Mamka, Alan, Sami and Žofia: done**, from your new sheets of eight figures each. In the game they stand about a third taller than the kids.
- **S11, the stadium gate:** redrawn after your photos of the real Strahov stadium from outside.
- **S5 and P9, the salon:** redrawn after your photo of the real salon: dark plaster walls, tall chrome-framed mirrors, black leather chairs, grey stone tiles.
- **P11, beach things** (bottle, message, shells, crab, jellyfish, lifebuoy, raft): done, through Figma.
- **Still to draw:** P2 (the tram), P4 (rewards and map markers). The villain C11 is optional.
- **Style:** grounded, classic pixel art that follows your character sheets and the finished scenes: natural proportions, muted colours, no black outlines.

## How to use this

1. Carry on in **the ChatGPT conversation where you drew the scenes**, so the style stays the same. Step 0 is only needed if you start a new conversation.
2. In a new conversation, paste **Step 0** first and **attach your character sheet** (the one with all six characters) to that message. Wait for "ready".
3. Then paste one prompt at a time. The order inside each part does not matter.
4. Save each result under its code (`S3.png`, `P2.png`) and send them to me in a normal message.

If a result is wrong:

- **It has black outlines, or looks harsher than your characters:** reply `Same image, but with no black outlines: edge each shape with a darker shade of its own colour, like the character sheet.`
- **It added people, animals or lettering to a scene:** reply `Same image, but with no people, no animals and no lettering.`
- **The style drifted** (smooth shading, tiny pixels, different colours): paste Step 0 again with the sheet, then ask for the image again.
- **The layout is wrong** (ground not empty, objects not in rows): ask for it again from scratch. Editing a wrong layout rarely fixes it.

The background colour for objects is bright magenta on purpose. I cut it away afterwards.

---

## Step 0: style setup (paste first, with your character sheet attached)

```text
I'm making a pixel-art adventure game for two children. I'll ask you for images one at a time: background scenes and objects. Use these rules for every image in this conversation.

REFERENCE. The attached sheet shows the game's finished characters. It is the style guide: everything you draw must look as if the same artist made it. Do not draw these characters, or any other people, unless I ask for them.

STYLE. Grounded, classic pixel art with clearly visible square pixels on one consistent grid, as if the whole image were drawn about 192 pixels wide and then enlarged. Natural proportions and shapes. Every colour area has two or three flat tones: a base, a soft shadow and a small highlight. Crisp, hard pixel edges, with flat colour inside them.

OUTLINES. There are no black outlines anywhere. Each shape is edged with a darker shade of its own colour, exactly as on the character sheet: dark brown around hair, skin and wood, dark blue around blue things, dark green around leaves.

PALETTE. Warm, natural and slightly muted, taken from the character sheet: chestnut and caramel browns, warm skin tones, cream and off-white, denim blue, mint green, soft pink, brick red and sunny yellow. Skies and water are clear but gentle. The darkest colour in any image is a deep warm brown.

SCALE. In the game a character stands about one seventh of the image height tall. Draw everything to fit them: a door is about one fifth of the image height, and a chair seat reaches a character's waist.

SCENES. A side-on stage view, like a classic side-scrolling game. Scenery fills the upper part of the image. The bottom third is flat, open ground where the characters will stand and move, kept clear of furniture and objects. Scenes are empty of people and animals, because I add the characters myself. Signs, posters and screens are blank shapes.

OBJECTS. Drawn on a plain, flat, bright magenta background (#FF00FF) with nothing else in the image: no ground, no shadow, no scenery. Same pixel size, outline rule and palette as the scenes. Seen from the side. Each object is separate, with clear magenta space all around it.

MOOD. Bright, cosy, playful, safe for children.

No text, no letters, no numbers, no logos, no watermark, no border.

Reply "ready" and wait for my first request.
```

---

## Part 1: the look (2 images)

Do these first. They set the look for everything else.

### S0. The planet

```text
S0, the skin of the planet. Landscape, 3:2 (1536x1024). This one is a flat map with no ground strip. In the game it is wrapped around a spinning globe.

A flat map of the whole Earth, filling the image from edge to edge: chunky, simplified but recognisable continents in soft greens, with sandy-yellow deserts and a few darker green forests, on a gentle blue ocean with small lighter wave marks. White ice runs along the very top edge and the very bottom edge. The left and right edges are open ocean and look alike, because they meet when the map is wrapped around the globe. Europe and Australia are clear and uncluttered, because level markers go there. The ocean holds two or three tiny playful details, such as a sailing ship and a whale.

Same pixel-art style and palette as set up. No text, no labels, no markers, no compass, no frame.
```

### S1. Title screen

```text
S1, the title screen. Portrait, 2:3 (1024x1536).

Night over the rooftops of Prague. In the lower middle: red tiled roofs, chimneys, two church spires, warm yellow lit windows, and in the distance a river with an arched stone bridge. The upper half is open deep-blue sky with a large full moon and scattered stars, left empty because the game logo goes there. The bottom third is a flat rooftop terrace, clear and empty.

Same pixel-art style and palette as set up. No text.
```

---

## Part 2: Praha 5, at home (4 images)

### S2. At home

```text
S2, at home. Portrait, 2:3 (1024x1536).

A cosy living room in a flat in Prague. On the back wall: a large window showing a tram line and green hills with a small lookout tower, three framed portrait drawings, shelves, and many green houseplants. Against the wall: a grey sofa with a zebra-striped cushion and a television on a white cabinet. A hockey stick leans in one corner and a white toy bunny sits on the sofa. Warm evening lamp light. The bottom third is a wooden floor, clear and empty.

Same pixel-art style and palette as set up. No text.
```

### S3. The street (this one scrolls)

```text
S3, a street in Prague. Landscape, 3:2 (1536x1024).

A wide city street seen side-on. Along the back runs a row of four-storey nineteenth-century apartment houses in pastel yellow, pink, mint and cream, with ornate window frames and red tiled roofs. Their ground floors are small shops with blank awnings. In front of them: overhead tram wires, a tram stop shelter, old-fashioned street lamps and leafy trees. Far behind, a green hill with a small lookout tower. Sunny afternoon.

The bottom third is the roadway: cobblestones and tram tracks running perfectly straight from the left edge to the right edge, clear of vehicles and objects. Spread the buildings evenly and make the left and right edges look alike, because the game repeats this image side by side as the players run.

Same pixel-art style and palette as set up. No text.
```

### S4. The locked door

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

## Part 3: Praha 6, Strahov (4 images)

### S10. Up the hill (this one scrolls)

```text
S10, the path up the hill. Landscape, 3:2 (1536x1024).

A park on a steep green hill above Prague, seen side-on. Along the back: old leafy trees, blossoming orchard trees, an old stone wall with battlements running along the slope, park benches and iron street lamps. Above the treetops stands a steel lattice lookout tower, like a small Eiffel tower. Far below in the distance, a hazy strip of red city roofs and a river. Fresh morning light.

The bottom third is a sandy park path running perfectly straight from the left edge to the right edge, clear and empty. Spread the trees evenly and make the left and right edges look alike, because the game repeats this image side by side as the players run.

Same pixel-art style and palette as set up. No text.
```

### S11. The stadium gate

```text
S11, outside the old stadium. Portrait, 2:3 (1024x1536).

The entrance of an enormous old concrete stadium from the 1930s, seen from the street. A long, tall, pale grey concrete wall with rows of small square windows fills the upper part, weathered, with patches of moss, and weeds growing along its foot. In the centre is a tall gateway with a heavy rusty iron gate, shut and wrapped in a thick chain. A tall flagpole with a plain faded flag stands on each side of the gate, and the tops of floodlight masts show above the wall. Young birch trees have grown out of the old stands. Late afternoon light. The bottom third is cracked asphalt, clear and empty.

Same pixel-art style and palette as set up. No text.
```

### S12. The field

```text
S12, inside the old stadium. Portrait, 2:3 (1024x1536).

The inside of a gigantic, abandoned stadium, so big that its far side looks tiny in the distance. Long, low concrete stands run along the back, pale grey and weathered, with grass and small trees growing between the rows of benches. Above them stand four tall floodlight masts under a wide sky with big white clouds. A faded scoreboard with a blank panel stands to one side. Bright midday light. The bottom third is the pitch: flat, patchy grass, clear and empty.

Same pixel-art style and palette as set up. No text.
```

### S13. The drum room

```text
S13, the drum room. Portrait, 2:3 (1024x1536).

A band rehearsal room hidden under the stands of the old stadium. Bare concrete walls and a low ceiling with pipes, made cosy: egg-box soundproofing panels, strings of warm fairy lights, blank posters, a worn sofa against the back wall, two guitar amplifiers, a shelf of cymbals and spare drums, and coiled cables on hooks. A red patterned rug lies at the back of the floor, left empty, because the drum kit is added separately. Warm lamp light. The bottom third is a wooden floor, clear and empty.

Same pixel-art style and palette as set up. No text.
```

---

## Part 4: Australia (4 images)

### S6. Bondi Beach

```text
S6, Bondi Beach in Sydney. Portrait, 2:3 (1024x1536).

A sunny day, seen from the sand looking out to sea. A bright blue sky with a few puffy clouds. Clear turquoise water with darker patches over the reef, and rows of white-capped waves. On the left, a low sandstone headland of honey-coloured rock, with a rectangular ocean pool cut into the rocks at its foot, waves splashing over its sea wall, and a white two-storey clubhouse above it. Far away on the right, a low green headland. On the sand at the back: a small blue-and-white lifeguard lookout tower, a pair of red-and-yellow lifesaving flags, and a few surfboards stuck upright in the sand. Behind the headland, the tops of tall Norfolk Island pines. The bottom third is flat, pale golden sand, clear and empty.

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

## Part 5: objects (7 images)

### P7. The heroes' things

```text
P7, the two heroes' things. Landscape, 3:2 (1536x1024). Magenta background.

Eight separate objects in two rows of four, each with clear magenta space around it. Top row: a wooden ice hockey stick with white tape on its blade, lying level; a black hockey puck lying flat; the same puck flying, tilted, with three short speed lines behind it; a small yellow star-shaped impact flash. Bottom row: a white fluffy toy bunny with long floppy ears and pink inner ears, sitting, the same bunny as on the character sheet; the same bunny flying through the air with its ears streaming back; the same bunny tumbling upside down in the air; a small puff of white fluff.

Same pixel-art style and palette as set up. No text.
```

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

### P5. Strahov objects

```text
P5, objects for the Strahov level. Landscape, 3:2 (1536x1024). Magenta background.

Eight separate objects in two rows of four, each with clear magenta space around it. Top row: a red bass drum seen from the front; a snare drum on its stand; a golden cymbal on its stand; a pair of wooden drumsticks, crossed. Bottom row: a music note; a small guitar amplifier; a brown pine cone; a dark grey crow flying with its wings up, seen from the side.

Same pixel-art style and palette as set up. No text.
```

### P6. The drum kit

```text
P6, a drum kit. Landscape, 3:2 (1536x1024). Magenta background.

One complete drum kit seen from the front, filling most of the image: a big red bass drum with a plain cream front skin in the middle, two toms above it, a floor tom on one side, a snare drum on the other, a hi-hat and two golden cymbals on stands, and a round drummer's stool behind it. The stool is empty.

Same pixel-art style and palette as set up. No text, no logos.
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

Ten separate objects in two rows of five, each with clear magenta space around it. Top row: a wooden treasure chest with gold bands, closed; the same chest half open with light spilling out; the same chest fully open with a golden glow; a red heart; a gold star. Bottom row: a pink flower on a green stem; a glass bottle with a rolled paper message inside; a red map pin; a grey map pin with a small padlock on it; a green flag on a short pole.

Same pixel-art style and palette as set up. No text.
```

---

## Part 6: the new games (5 images)

### S14. The concert

```text
S14, a concert in the old stadium. Portrait, 2:3 (1024x1536).

Night inside the huge old stadium, now full for a rock concert. Across the middle stands a big outdoor stage with a high black truss roof, coloured spotlights in pink, yellow and blue shining down through a light haze, two tall speaker stacks at the sides, and a raised drum riser in the centre, left empty because the musicians are added separately. Far behind the stage rise the old concrete stands, packed with a crowd shown only as a dark mass of simple silhouettes with raised hands and a few phone lights. The bottom third is the front of the stage floor, dark wooden boards, clear and empty.

Same pixel-art style and palette as set up. No text, no logos, no band names.
```

### S15. The bush forest (for finding koalas)

If you draw this one yourself, keep to the same idea: a wide picture with plenty of leafy places at different heights where a small koala could peek out. I mark the hiding places myself.

```text
S15, a eucalyptus forest in the Australian bush. Wide landscape, 3:2 (1536x1024). In the game the players drag this picture left and right to look around.

A dense bush forest seen side-on in warm late-afternoon light. Ten to twelve tall eucalyptus trees with pale, peeling trunks and thick, rounded crowns of grey-green leaves stand at different distances, spread across the whole width. Their crowns and forks sit at many different heights, from just above the ground to the top of the picture, leaving lots of shadowy, leafy nooks where something small could hide. Between them: tree ferns, tall grass and fallen branches. Thin shafts of golden light fall through the leaves. The bottom fifth is a red earth path running from edge to edge, clear and empty.

No animals of any kind. Same pixel-art style and palette as set up. No text.
```

### P8. Koalas

```text
P8, koalas for a hide-and-seek game. Landscape, 3:2 (1536x1024). Magenta background.

Six separate drawings in one row of the same cute, round, grey koala with big fluffy ears and a large dark nose, each with clear magenta space around it: only the head and two paws peeking up over a clump of grey-green eucalyptus leaves; the same, peeking out sideways from behind the leaves; the whole koala hugging a short piece of branch, seen from the side; the same koala waving one paw, happy; the same koala with its eyes closed and smiling; a clump of eucalyptus leaves on its own, the same as in the first drawing.

Same pixel-art style and palette as set up. No text.
```

### P9. The salon's work places

```text
P9, the work places in a hair salon, for a cooperative game. Landscape, 3:2 (1536x1024). Magenta background.

Five separate objects in one row, all at the same scale, seen from the front at a slight angle from above, each with clear magenta space around it: a white hair-washing basin on a short stand with a curved neck rest; a pink salon chair with scissors and a comb lying on a small tray beside it; a small trolley with a bowl of hair dye, a brush and three coloured bottles; a standing hood hair dryer; a small wooden counter with a cash register and a little bell.

Same pixel-art style and palette as set up. No text, no logos.
```

### P10. Salon customers

```text
P10, customers for a hair salon game. Wide landscape image, plain white background.

Draw them in exactly the style of the attached character sheet: the same proportions, pixel size and coloured outlines, about two thirds as tall as the adults on the sheet.

Six different friendly customers in one row, seen from the side and facing right, the same size, evenly spaced, feet on one straight line: an old lady with a grey bun and a cardigan; a teenager with a messy fringe and a hoodie; a man with a bushy beard and long scruffy hair; a woman with very long straight hair and a summer dress; a small boy with sticking-up hair and a football shirt; a grandpa with a flat cap and a moustache.

Under them, a second row with the same six after their visit, each with a neat new hairdo, and the woman's hair dyed pink.

No shadows, no ground, no text, no labels, nothing cut off at the edges.
```

## The poses I need

All six characters are in the game, cut from the big standing figures (front, three-quarter, side, back). What a standing figure cannot give is movement: for now the game makes two running frames by moving the legs of the side view, and the hockey stick and the bunny are drawn stand-ins.

| Who | Poses | Frames |
|---|---|---|
| Kendrick | running cycle (4), jump, dizzy on the ground, cheer, surf stance, hockey shot (2), drumming (2) | 12 |
| Kellyn | running cycle (4), jump, dizzy on the ground, cheer, surf stance, bunny throw (2), drumming (2) | 12 |
| Mamka | waving for help (2), happy, telling off with a raised finger, running (2) | 6 |
| Alan | waving for help (2), happy, drumming at the kit (2) | 5 |
| Sami | waving for help (2), happy, riding the motorbike (2) | 5 |
| Žofia | waving for help (2), happy jump, blowing a kiss, taking a photo | 5 |

The rules that make them drop straight in:

- **Same size and detail as the big standing figures.** Small poses cannot stand next to them in a scene.
- **Side view, facing right.** I mirror them for left.
- **One row per picture, four to six figures, with clear space between them** and nothing cut off at the edges. Your turnaround rows are exactly the right format.
- **Plain white or cream background, no shadows under the feet.** Please leave the background in: automatic cut-outs also remove the white inside the figures.
- **Attach that character's turnaround row** to each request, so the design stays the same.

The two heroes come first (A1 to A6). The rest can follow.

### A1. Kendrick running

```text
A1, Kendrick running. Wide landscape image, plain white background.

The attached picture shows the character from five sides. Draw exactly this character: the same face, hair, clothes, colours, proportions and pixel size, at the same height as in the attached picture.

Four full-body drawings in one row, seen from the side and facing right, the same size, evenly spaced with clear white space between them, feet on one straight line: one running cycle: right leg stretched forward; both feet off the ground with the legs passing; left leg stretched forward; both feet off the ground with the legs passing.

No shadows, no ground, no text, no labels, nothing cut off at the edges.
```

### A2. Kendrick moving

```text
A2, Kendrick moving. Wide landscape image, plain white background.

The attached picture shows the character from five sides. Draw exactly this character: the same face, hair, clothes, colours, proportions and pixel size, at the same height as in the attached picture.

Four full-body drawings in one row, seen from the side and facing right, the same size, evenly spaced with clear white space between them, feet on one straight line: jumping with his knees tucked up; sitting on the ground looking dizzy; cheering with both arms up; crouched with knees bent and arms out for balance, as if riding a surfboard.
Draw no surfboard: I add it.
No shadows, no ground, no text, no labels, nothing cut off at the edges.
```

### A3. Kendrick with his things

```text
A3, Kendrick with his things. Wide landscape image, plain white background.

The attached picture shows the character from five sides. Draw exactly this character: the same face, hair, clothes, colours, proportions and pixel size, at the same height as in the attached picture.

Four full-body drawings in one row, seen from the side and facing right, the same size, evenly spaced with clear white space between them, feet on one straight line: holding an ice hockey stick swung back behind him, ready to shoot; the hockey stick swung forward and low, just after the shot; holding two drumsticks with the right one raised; holding two drumsticks with the left one raised.
Draw no puck and no drum: I add them.
No shadows, no ground, no text, no labels, nothing cut off at the edges.
```

### A4. Kellyn running

```text
A4, Kellyn running. Wide landscape image, plain white background.

The attached picture shows the character from five sides. Draw exactly this character: the same face, hair, clothes, colours, proportions and pixel size, at the same height as in the attached picture.

Four full-body drawings in one row, seen from the side and facing right, the same size, evenly spaced with clear white space between them, feet on one straight line: one running cycle: right leg stretched forward; both feet off the ground with the legs passing; left leg stretched forward; both feet off the ground with the legs passing.

No shadows, no ground, no text, no labels, nothing cut off at the edges.
```

### A5. Kellyn moving

```text
A5, Kellyn moving. Wide landscape image, plain white background.

The attached picture shows the character from five sides. Draw exactly this character: the same face, hair, clothes, colours, proportions and pixel size, at the same height as in the attached picture.

Four full-body drawings in one row, seen from the side and facing right, the same size, evenly spaced with clear white space between them, feet on one straight line: jumping with her knees tucked up; sitting on the ground looking dizzy; cheering with both arms up; crouched with knees bent and arms out for balance, as if riding a surfboard.
Draw no surfboard: I add it.
No shadows, no ground, no text, no labels, nothing cut off at the edges.
```

### A6. Kellyn with her things

```text
A6, Kellyn with her things. Wide landscape image, plain white background.

The attached picture shows the character from five sides. Draw exactly this character: the same face, hair, clothes, colours, proportions and pixel size, at the same height as in the attached picture.

Four full-body drawings in one row, seen from the side and facing right, the same size, evenly spaced with clear white space between them, feet on one straight line: holding her white toy bunny by the ears behind her head, ready to throw; her throwing arm stretched forward and her hand empty, just after the throw; holding two drumsticks with the right one raised; holding two drumsticks with the left one raised.
Draw no drum: I add it.
No shadows, no ground, no text, no labels, nothing cut off at the edges.
```

### A7. Mamka

```text
A7, Mamka. Wide landscape image, plain white background.

The attached picture shows the character from five sides. Draw exactly this character: the same face, hair, clothes, colours, proportions and pixel size, at the same height as in the attached picture.

Six full-body drawings in one row, seen from the side and facing right, the same size, evenly spaced with clear white space between them, feet on one straight line: waving both arms above her head, calling out; the same wave with the arms swung to the other side; smiling with her arms open wide; telling someone off with one finger raised and the other hand on her hip; running, right leg forward; running, left leg forward.

No shadows, no ground, no text, no labels, nothing cut off at the edges.
```

### A8. Alan

```text
A8, Alan. Wide landscape image, plain white background.

The attached picture shows the character from five sides. Draw exactly this character: the same face, hair, clothes, colours, proportions and pixel size, at the same height as in the attached picture.

Five full-body drawings in one row, seen from the side and facing right, the same size, evenly spaced with clear white space between them, feet on one straight line: waving both arms above his head, calling out; the same wave with the arms swung to the other side; smiling with both arms up, a drumstick in each hand; sitting on a drum stool with the right drumstick raised; sitting on a drum stool with the left drumstick raised.
Draw the stool but no drums: I add the drum kit.
No shadows, no ground, no text, no labels, nothing cut off at the edges.
```

### A9. Sami

```text
A9, Sami. Wide landscape image, plain white background.

The attached picture shows the character from five sides. Draw exactly this character: the same face, hair, clothes, colours, proportions and pixel size, at the same height as in the attached picture.

Five full-body drawings in one row, seen from the side and facing right, the same size, evenly spaced with clear white space between them, feet on one straight line: waving both arms above the head, calling out; the same wave with the arms swung to the other side; smiling with a thumb up; riding a small black motorbike, wearing a black helmet; the same motorbike and rider with the front wheel lifted off the ground.

No shadows, no ground, no text, no labels, nothing cut off at the edges.
```

### A10. Žofia

```text
A10, Žofia. Wide landscape image, plain white background.

The attached picture shows the character from five sides. Draw exactly this character: the same face, hair, clothes, colours, proportions and pixel size, at the same height as in the attached picture.

Five full-body drawings in one row, seen from the side and facing right, the same size, evenly spaced with clear white space between them, feet on one straight line: waving both arms above her head, calling out; the same wave with the arms swung to the other side; jumping for joy with both arms up; blowing a kiss with one hand; holding a camera up to her eye.

No shadows, no ground, no text, no labels, nothing cut off at the edges.
```

## Optional: a villain

Only if you decide the game should have one. This is a suggestion; change anything.

### C11. The Scrambler

```text
C11, the villain of the game, a comic trickster who locks things up with codes. Landscape, 3:2 (1536x1024). Magenta background.

This one is a character, drawn exactly like the characters on the sheet: the same proportions with a large head, the same simple face, the same pixel size and the same coloured outlines.

A funny, harmless-looking inventor, more silly than scary: tall and thin, in a long purple coat with oversized pockets, wearing a helmet shaped like a padlock, round green goggles, and a large wind-up key on the back. A ring of keys hangs from one hand.

Five drawings in one horizontal row. The first four are full body, seen from the side and facing right: standing with hands on hips; laughing with the head thrown back; shaking a fist; running away with the coat flapping. The fifth is a large head-and-shoulders portrait facing forward with a mischievous grin. The four full-body drawings are the same size, evenly spaced, feet on one straight line.

Same pixel-art style and palette as set up. No text, no logos.
```

---

## Checklist

| Code | What | Shape |
|---|---|---|
| S0 | The planet | Landscape |
| S1 | Title screen | Portrait |
| S2 | Praha 5: at home | Portrait |
| S3 | Praha 5: the street | Landscape |
| S4 | Praha 5: the locked door | Portrait |
| S5 | Praha 5: inside the salon | Portrait |
| S10 | Praha 6: up the hill | Landscape |
| S11 | Praha 6: the stadium gate | Portrait |
| S12 | Praha 6: the field | Portrait |
| S13 | Praha 6: the drum room | Portrait |
| S6 | Australia: the beach | Portrait |
| S7 | Australia: the open sea | Landscape |
| S8 | Australia: the outback | Portrait |
| S9 | Australia: the shark reef | Portrait |
| P7 | The heroes' things: stick, puck, bunny | Landscape |
| P1 | Prague objects | Landscape |
| P2 | The tram | Landscape |
| P5 | Strahov objects | Landscape |
| P6 | The drum kit | Landscape |
| P3 | Australia objects | Landscape |
| P4 | Rewards and map markers | Landscape |
| S14 | Praha 6: the concert | Portrait |
| S15 | Australia: the bush forest | Wide landscape |
| P8 | Koalas | Landscape |
| P9 | The salon's work places | Landscape |
| P10 | Salon customers, before and after | Wide rows |
| A1, A2, A3 | Kendrick: running, moving, with his things | Wide row |
| A4, A5, A6 | Kellyn: running, moving, with her things | Wide row |
| A7 to A10 | Mamka, Alan, Sami, Žofia | Wide row |
| C11 | The Scrambler (optional) | Landscape |

## Sending me pictures

- Send files in a normal message or as a zip. Pictures sent while I am in the middle of working do not reach me as files.
- **The characters:** I have the six-card sheet as a compressed copy, 1536 pixels wide. The larger turnaround rows (five figures per character on white) are sharper: send those as files, whole, and check that no figure is cut off at an edge.
- **Please don't remove backgrounds first.** Automatic cut-outs also remove the white inside the figures (Kellyn's leggings, shoe soles), and tight crops cut off hair. I cut them out from the full picture myself.
