# Color Card 3D

A mobile-first 3D shedding card game (the Crazy Eights family) with a classic look: white cards in red, yellow, green and blue, played on a sunny meadow with trees, that runs in the browser and installs as a PWA.
It's built with [three.js](https://threejs.org/) and is a static site with no build step, so it can be hosted on GitHub Pages as-is.

## Features

Two ways to play:

- **Play with Bots:** you against 1–3 bots (Easy / Normal / Hard). Name yourself and the bots on the setup screen.
- **Play Online:** create a room and share the 5-letter code or link, or join a friend's room. Uses WebRTC (PeerJS), so you don't need a server of your own. Every player only receives their own cards. Empty seats are filled by bots, and if someone drops out a bot takes over.
- **Setup options:** 2/3/4 players, 5/7/10 starting cards, match to 100/250/500 points or free play, and house rules (stacking +2/+4, draw until playable, must call “Color Card!”).
- **3D meadow:** lime grass, low-poly trees, bushes and flowers, soft sun shadows under the cards, and arrows on the grass that walk the way play is going.
- **Your hand is held like real cards:** a curved fan along the bottom of the screen. Cards you can play are raised; the rest are dimmed.
- **Throw a card by tapping it or swiping it up.** Press and hold a card to look at it up close, and tap the discard pile to see its top card. Cards you draw pop up in front of you so you can see them before they go into your hand.
- **Celebrations:** firecracker volleys with booms, 3D fireworks and confetti for wins, screen-shake punches for action cards, and sounds for throwing, landing, drawing and flipping cards. All sounds are generated with Web Audio (no audio files). Phones also vibrate on some events.
- **PWA:** installable and works offline (except online play). Local games auto-save and can be continued.

## Rules

- Match the top card by **colour** or by **number / symbol**. Wilds can be played on anything.
- **Skip:** the next player misses a turn. **Reverse:** changes direction (acts as Skip with 2 players).
- **+2 / Wild +4:** the next player draws and misses their turn. With stacking on, they can pass it on with their own +2 / +4 instead.
- Can't play? Draw one card (or keep drawing, with "draw until playable"). If the drawn card fits, you can play it right away or pass.
- With two cards left, tap **Color Card!** before you play — the game shouts it out loud for everyone. Forget, and you draw 2.
- The round winner scores the cards left in the other hands: numbers count face value, action cards 20 and wilds 50.

**Controls:** tap a raised card or swipe it up to throw it, press and hold to look at a card, and tap the deck or **Draw** if nothing fits. On a keyboard, Space draws or passes, 1–9 plays your playable cards in order, C calls Color Card!, and Esc opens the menu.

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
js/rules.js           Pure rules engine (deck, actions, scoring, per-player views)
js/ai.js              Computer opponents
js/scene.js           three.js meadow, card art (canvas textures), held hand, gestures, animations
js/main.js            Controller: modes, turns, pass & play, online sync, effects
js/audio.js           Procedural Web Audio sound effects
js/net.js             PeerJS host/client wrappers
js/bgfx.js, fx3d.js   Background fireworks and 3D particle effects
js/anim.js            Tween helper
vendor/               three.js, PeerJS (MIT)
fonts/                Fredoka (SIL Open Font License)
sw.js, manifest.webmanifest, icons/   PWA
```
