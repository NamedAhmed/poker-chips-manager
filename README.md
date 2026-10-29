# Poker Chips Manager

Play poker with nothing but a deck of cards. This free, no-sign-up web app tracks every stack, bet, blind and pot at the kitchen table.

## Features

- Set up 2–10 players with names, starting chips and a bet unit.
- Optional blinds (small and big), with an optional automatic raise every N hands.
- Per-player bet, win and manual stack adjustments.
- Pot tracking, with the pot awarded to one or more winners (odd chips go to the first winner).
- Dealer rotation and blind posting on each new hand.
- The game is saved in your browser, so a reload keeps your place.

## Run locally

No build step or dependencies are needed. Serve the folder with any static server, for example:

```bash
npx serve .
```

Then open the printed URL. Opening `index.html` directly also works for most features.

## Deploy

The app is plain static files (`index.html`, `styles.css`, `app.js`), so it deploys to Vercel with no build settings. Use the default "Other" preset, no build command, and output directory `.`.

## Files

- `index.html`: the page structure for setup and game screens.
- `styles.css`: mobile-first styles with safe-area padding.
- `app.js`: game state, betting, blinds, pot and saving.
