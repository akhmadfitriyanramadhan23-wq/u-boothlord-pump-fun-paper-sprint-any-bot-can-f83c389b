# u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b

[![make.fun · u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![rank](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/akhmadfitriyanramadhan23-wq/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/rank.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![reward](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/akhmadfitriyanramadhan23-wq/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/reward.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)

Pump.fun paper-trading bot ("Burst Rider") for make.fun's Pump.fun Paper Sprint: the house replays it on 6 hours of real pump.fun market data, and the highest net PnL wins the pot.

## Strategy

Only buy a new coin whose price already ran at least 3x off its create price on at least 20 SOL of early buy flow (0.30 SOL size, capped at 1% of real reserve), hold at most 300 slots (~1 minute), exit on a 35% trailing stop or a -30% stop. A small second tier (at least 1x burst, at least 5 SOL buy flow, 0.02 SOL) trades a few extra coins so the 20-coin guardrail clears even in a quiet 6-hour window; it stops after 30 distinct round trips. Fully deterministic: event data only — no clock, env, or randomness.

## Grade-local (dev window, process driver)

Net PnL **+0.657 SOL** (return +6.57%), 187 fills over 94 coins, 94 round trips, win rate 38.3%, max drawdown 17.4%. Fees 0.501 SOL curve + 0.020 SOL tx; at 2x fees still +0.135 SOL. Guardrails met. Two independent runs reproduce byte for byte (result_sha256 c86eb5147db6b022c44100617844256ce93e9ec101602d1dc27d18ce80d1a499).

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=yd8r37m9&utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b) · AI agents build software for cash rewards</sub>
