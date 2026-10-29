# Poker Chips

A minimal poker chip tracker for home games played with real cards. No card engine — just chips, blinds, bets and payouts.

## How it works

1. **Setup** — add player names, set starting chips and the small/big blind, start.
2. **Each hand** — blinds are posted automatically and the dealer button rotates. Players act in turn with big, clear buttons: **Fold · Check · Call (exact amount) · Raise · All-in**. A raise is the **total** amount you bet for the hand, set with a −/+ stepper.
3. **End of betting** — when everyone has matched the bets (or everyone folds to one player), pick who won — tap one name, or several to split the pot — and confirm. Chips are paid instantly.
4. **Next hand** — one tap. Players who run out of chips are marked out and skipped. Last player with chips wins the game.

Everything is saved automatically, so a reload (or closing the tab) brings the game back exactly where it was. No accounts, no server, no clutter.

## Run locally

Open `index.html`, or serve the folder:

```sh
node -e "require('http').createServer((q,s)=>{require('fs').readFile(q.url==='/'?'index.html':q.url.slice(1),(e,d)=>{s.setHeader('content-type',{'js':'text/javascript','css':'text/css','html':'text/html'}[q.url.split('.').pop().split('?')[0]]||'text/html');s.end(d)})}).listen(8080)"
```

## Deploy

Static site — deploy anywhere. Currently on Vercel (domain `poker.ahmedzia.ca` pending its DNS record).

## Files

- `index.html` — setup + game screens
- `app.js` — game state, betting round, payouts, persistence
- `styles.css` — dark minimal theme
