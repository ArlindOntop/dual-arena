# Duel Arena: public site

Zero dependencies. Needs Node 18+. Run locally: `node server.js`, then open http://localhost:3000 in two tabs.

## Put it on the internet (Render, free)
1. Create a GitHub repo and upload everything in this folder.
2. On render.com choose New > Web Service and connect the repo.
3. Runtime: Node. Build command: leave empty. Start command: `node server.js`.
4. Deploy. You get a public https URL like `https://duel-arena.onrender.com`. WebSockets work automatically.

Railway, Fly.io and any VPS also work: run `node server.js` and set the `PORT` environment variable.
(Free Render services sleep after idle time, so the first visit can take about 30 seconds.)

## How people play
- Anyone opens the URL. No account or invite needed.
- Find online match: public queue, pairs two waiting players.
- Online room: type a code, then send the invite link shown (`https://your-site/#room=CODE`) in an email. Opening it joins that room.

Note: the server only relays state between the two players (it does not judge hits), so a determined cheater could modify their own client.

## Accounts

Players can create a 10-character account code in the menu; progress (coins, purchases, rating, unlocks) auto-saves to the server as small JSON in `data/saves.json` (override the folder with `DATA_DIR`). On Render's free plan the disk is wiped on every deploy or restart, so saves can disappear. For permanent saves, attach a Render Disk and set `DATA_DIR` to its mount path. Players can also keep a "backup code" that works without the server.
