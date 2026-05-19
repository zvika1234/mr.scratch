# Mr.Scratch

A real-time multiplayer party game — a mix of **Among Us** and **Pictionary**.

3 to 5 players share a private room. One is secretly the **Impostor** (`מתחזה` in Hebrew). Normal players see the secret word; the Impostor only sees the category. Everyone takes turns drawing on a shared canvas for 10 seconds (or until one mouse-lift). After 3 rounds, everyone votes on who the Impostor is, and the Impostor gets one last chance to guess the word for a bonus point. First to **6 points wins the match**.

## Features

- **Online multiplayer rooms** with 4-char share codes
- **Bots** to fill empty slots (3–5 players total per room)
- **Real-time canvas sync** stroke-by-stroke via Socket.io
- **5 categories** in EN/HE: Food, Animals, Transportation, Clothing, Fitness
- **Bilingual UI** (English / Hebrew) with full RTL support
- **Responsive** — works great on mobile and desktop

## Run it

```bash
npm install
npm start
```

Then open `http://localhost:3000` in two or more browser tabs (use incognito for the second player so they get a separate socket).

- Tab 1: enter a name → "Create Private Room" → share the code.
- Tab 2+: enter the code → "Join Room".
- Host: optionally "+ Add Bot" until you have at least 3 players, pick a category, click "Start Game".

## Architecture

```
server.js              Express + Socket.io entry point
src/
  rooms.js             In-memory room store
  game.js              State machine: lobby → drawing → voting → guess → results
  bots.js              Random scribble drawing + random voting
  words.js             Categories and words (EN + HE) — server-only
public/
  index.html           All 5 screens (home, lobby, game, vote, guess, results)
  styles.css           Playful theme, RTL-ready, responsive
  app.js               Socket client + screen routing + dynamic rendering
  canvas.js            Drawing + normalized-coordinate stroke sync
  i18n.js              EN/HE translations + RTL flip
```

The word list lives only on the server — the Impostor cannot inspect their browser to learn the secret word.
