# Poker Chips Manager

Play poker with nothing but a deck of cards. This free, no-sign-up web app tracks every stack, bet, blind and pot at the kitchen table.

## Features

- Set up 2–10 players with names, starting chips and a bet unit.
- Optional blinds (small and big), with an optional automatic raise every N hands.
- Real betting streets: pre-flop → flop → turn → river, with community cards dealt at each street.
- Enforced turn order and legal actions per seat: Fold, Check, Call, Raise (with a minimum), All-in.
- Showdown: pick one or more winners and the pot is paid out (odd chips go to the first winner).
- A bet no one called comes back to the raiser when the hand ends early.
- Dealer rotation (skip only eliminated players) and blind posting each new hand.
- The game is saved in your browser, so a reload keeps your place — even mid-hand.

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
