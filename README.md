# Wickets & Runs

A small scoreboard for English cricket darts, the bat-and-bowl pub game. Two sides. One batting innings each. It is not the 15–20 closing game.

The app is a static Progressive Web App: `index.html`, `styles.css`, `app.js`, and `logic.js`. It keeps the match on the tablet, works offline after it has been loaded from a secure address, and is laid out for an 8.7-inch screen in landscape or portrait.

## Run it locally

Open it through a small local server. Opening the file directly will not start the scoreboard, because the browser blocks module scripts on `file://` pages.

```bash
python3 serve.py
```

Then open [http://127.0.0.1:8742](http://127.0.0.1:8742).

`serve.py` uses port 8742 and sends the manifest as `application/manifest+json`. Any other static server is fine if it does the same.

## On an Honor Pad

1. Serve the folder on a computer the tablet can reach, or copy the files onto the tablet and serve them there.
2. Open the address in Chrome.
3. Use the Chrome menu and choose **Install app** or **Add to Home screen**.

Chrome only offers that install on a secure address (`https://`, or `localhost` on the tablet itself). The scoreboard still runs over ordinary `http://` on a home network; it just will not install or cache for offline use until the address is secure. After one successful load from an allowed address, the service worker keeps the files for offline scoring.

## Tests

```bash
node --test
```

The checks cover the 40-run rule, batter bulls, the treble 20 / outer bull / treble 19 visit, bowler misses, excess wickets, the end of an innings, the chase, and undo.

## Scoring, in short

- A visit is three darts. The batter throws first, then the bowler, then the batter.
- The batter scores singles, doubles and triples. Only the points above 40 in that visit are runs. Bulls score 0 and take wickets: outer 1, inner 2.
- The bowler takes wickets only with bulls. Any other number is off target.
- At 0 wickets the innings ends immediately. Leftover darts are not thrown. Runs already on the batter's visit are kept.
- The second innings is played until all out, even if the target has already been passed. The higher total wins. Level scores draw.
