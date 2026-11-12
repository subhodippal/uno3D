# Color Card 3D

A mobile-first 3D shedding card game (the Crazy Eights family) with a classic look: white cards in red, yellow, green and blue, played on a sunny meadow with trees, that runs in the browser and installs as a PWA.
It's built with [three.js](https://threejs.org/) and is a static site with no build step, so it can be hosted on GitHub Pages as-is.

## Features

Three ways to play, straight from the menu:

- **Single play:** you against 1–3 bots (Easy / Normal / Hard). Name yourself and the bots on the setup screen.
- **Group:** create a private room for **2 to 8 players** and share the 5-letter code or link, or join a friend's room with their code.
- **Online:** pick a table size (2, 3 or 4) and tap **Find players**. Everyone searching for the same table size is grouped into one room. The game starts by itself 3 seconds after the table fills, or 30 seconds after a second player joins (bots take the empty seats). The first player at a table can also tap **Play now** at any time.

Group and Online use WebRTC (PeerJS), so you don't need a server of your own. Every player only receives their own cards.

**Staying connected:**
- **Reload or refresh** and you're put straight back into your room and your seat, for both the host and the guests. The host's room reopens under the same code, and guests reconnect by themselves.
- **Weak signal:** a heartbeat notices a dead connection, and the game keeps trying to reconnect for 2 minutes.
- **While someone is away**, their seat shows "Reconnecting…". On their turn the game waits 15 seconds, then a bot plays that one turn for them. After 3 minutes a bot takes the seat, but they still get it back if they return.
- **Leaving from the menu** tells the others straight away: a guest's seat goes to a bot, and if the host leaves the room closes.
- Your **name** is remembered on this device.

- **Whose turn:** a bouncing ▼ marker and a glow on the player whose turn it is, and a pulsing **YOUR TURN** above your hand.
- **Two games:** **Color Card** (classic) and **Color Card Flip** (double-sided cards with a light and a dark side, see below). Switch between them with the tabs at the top of the main menu; the choice is used for Single play, Group rooms and Online quick match (Flip players are only matched with Flip players).
- **Setup options:** 2/3/4 players, 5/7/10 starting cards, match to 100/250/500 points or free play, and house rules (stacking draw cards, draw until playable, must call “Last card!”).
- **Special cards after a shuffle** (Settings → Low / Medium / High): how likely Skip, Reverse, Pick 2/4, colour cards (and in Flip: Flip, Pick 1/5, Skip Everyone, Draw Colour) are to come up. Low is a normal shuffle (about 30% special cards in a classic hand), Medium makes them 2.5× as likely (about 50%), High 5× (about 65%).
- **3D meadow:** lime grass, low-poly trees, bushes and flowers, and soft sun shadows under the cards.
- **2D / 3D and Portrait / Landscape:** buttons at the top of the menu and the game (also in Settings). 2D looks straight down on the table. On phones you can force portrait or landscape: Android goes fullscreen and locks the rotation; on iPhone (which can't lock it) the game turns itself sideways.
- **Direction circle:** a white energy ring around the piles with lightning streaks racing clockwise or anticlockwise in the current colour (they turn red when someone picks red on a wild). A Reverse flashes the ring, throws sparks off it and whips the lightning round the other way. The badge at the top shows the colour and the direction too.
- **Male voice call-outs** (recorded clips, so every phone sounds the same): “Last card!”, “Skipped!”, “Reverse!”, “Pick two!”, “Pick four!”, “Color card!” plus the chosen colour (“Red!”, “Green!”, “Yellow!”, “Blue!”), “Draw card!”, “Pass.”, “Your turn!”, “You win!” / “Winner!”. Action cards also flash big text.
- **Music:** a light looping tune made with Web Audio. Sound effects, voice and music each have their own switch in Settings; the speaker button in the game mutes everything.
- **Your hand is held like real cards:** a curved fan along the bottom of the screen. Cards you can play are raised; the rest are dimmed.
- **Throw a card by tapping it or swiping it up.** Slide a finger along your hand (or hover with the mouse) and the card under it rises out of the fan so you can see all of it. Press and hold a card to look at it up close (keep holding and slide to flip through your hand at full size), and tap the discard pile to see its top card. Cards you draw pop up in front of you so you can see them before they go into your hand.
- **Celebrations:** firecracker volleys with booms, 3D fireworks and confetti for wins, screen-shake punches for action cards, and sounds for throwing, landing, drawing and flipping cards. Sound effects are generated with Web Audio. Phones also vibrate on some events.
- **PWA:** installable and works offline (except online play). Local games auto-save and can be continued.

## Rules

- Match the top card by **colour** or by **number / symbol**. Wilds can be played on anything.
- **Skip:** the next player misses a turn. **Reverse:** changes direction (acts as Skip with 2 players).
- **+2 / Wild +4:** the next player draws and misses their turn. With stacking on, they can pass it on with their own +2 / +4 instead.
- Can't play? Draw one card (or keep drawing, with "draw until playable"). If the drawn card fits, you can play it right away or pass.
- With two cards left, tap the big **Last card!** button before you play — a male voice shouts “Last card!” for everyone. Forget, and you draw 2.
- The round winner scores the cards left in the other hands: numbers count face value, action cards 20 and wilds 50.

### Color Card Flip

Every card has a **light side** (red, yellow, green, blue) and a **dark side** (pink, teal, orange, purple). The game starts on the light side. You can see the other side of your opponents' cards and of the top card of the draw pile.

| Light side | Dark side |
|---|---|
| Numbers 1–9 | Numbers 1–9 |
| **Pick 1**: next player draws 1 and misses a turn | **Pick 5**: next player draws 5 and misses a turn |
| Reverse, Skip | Reverse, **Skip Everyone** (you play again) |
| **Flip** | **Flip** |
| Colour card, **Wild Pick 2** | Colour card, **Wild Draw Colour** (next player draws until they get the colour you name, and misses a turn) |

**Flip** turns everything over: every hand, the draw pile and the discard pile (as stacks, like the real cards). The card that ends up on top of the discard pile sets the colour; if it is a colour card, the player who flipped picks the colour. The table turns to dusk while the dark side is in play.

Scoring: numbers count face value; Pick 1 is 10; Reverse, Skip, Flip and Pick 5 are 20; Skip Everyone 30; colour cards 40; Wild Pick 2 50; Wild Draw Colour 60.

**Controls:** tap a raised card or swipe it up to throw it, press and hold to look at a card, and tap the deck or **Draw** if nothing fits. On a keyboard, Space draws or passes, 1–9 plays your playable cards in order, C or L calls Last card!, and Esc opens the menu.

## Run locally

```bash
node server.js            # http://localhost:8080 (no npm install needed)
PORT=3000 node server.js
```

## Deploy to GitHub Pages

```bash
git add . && git commit -m "Color Card 3D"
git remote add origin https://github.com/<you>/uno3D.git
git push -u origin main
```

Then go to **Settings → Pages → Source: Deploy from a branch**, choose `main` / `(root)` and save.
All paths are relative, so any repo name works. **After each deploy, bump `VERSION` in `sw.js`** so installed copies update.

## Project layout

```
index.html            UI shell (menus, HUD, setup with seat rows)
css/style.css         Mobile-first light theme styles
js/rules.js           Pure rules engine (classic and flip decks, actions, scoring, per-player views)
js/ai.js              Computer opponents
js/scene.js           three.js meadow, card art (canvas textures), held hand, gestures, animations
js/main.js            Controller: modes, turns, pass & play, online sync, effects
js/audio.js           Procedural Web Audio sound effects
js/net.js             PeerJS host/client wrappers
js/view.js            Screen size / pointer helper for the forced-orientation mode
js/bgfx.js, fx3d.js   Background fireworks and 3D particle effects
js/anim.js            Tween helper
vendor/               three.js, PeerJS (MIT)
fonts/                Fredoka (SIL Open Font License)
audio/voice/          Voice clips (Piper TTS, en_US “john” voice, trained on public-domain LibriVox audio)
sw.js, manifest.webmanifest, icons/   PWA
```

## How quick match works (no server needed)

Quick match runs entirely on the free public PeerJS broker:

1. For each table size there are 12 well-known "beacon" IDs (`colorcard-mm-v1-4p-0` … `-11`).
2. A searcher asks each beacon in turn. A waiting table answers with its room code (join it) or "full" (try the next one).
3. If a beacon ID is free, the searcher claims it and becomes the host of a new table. Only one peer can hold an ID, so two people racing for the same free slot sort themselves out.
4. A host waiting alone at a higher-numbered table checks the lower ones every few seconds. If someone is waiting there, it closes its table and joins theirs, so players who searched at the same moment still end up together.
5. When a game starts, the host releases its beacon so the slot can be reused.

If you change the rules or the online message format, bump the `v1` in `MM_PREFIX` (and `PREFIX`) in `js/net.js`, so old and new versions don't get matched together.
