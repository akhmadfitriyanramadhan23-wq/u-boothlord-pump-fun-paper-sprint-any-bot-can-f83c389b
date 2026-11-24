// Burst-rider entrypoint: one program at main.ts on Node 22, stdlib only.
// It speaks agent-fun/replay/v2 through the kit's shim (vendor/) and hands
// every batch to the strategy in strategy.ts, which decides the orders.
//
// The bot paper-trades pump.fun bonding curves on a replay: it watches each
// new coin's launch, buys only the strongest bursts (3x off create on 20+
// SOL of early buy flow, plus a small filler tier for the 20-coin
// guardrail), and exits on a stop loss, a wide trailing stop, or a time
// limit. See strategy.ts for the reasoning and the numbers.
import { runBot } from './vendor/makefun-bot.ts';
import { BurstRider } from './strategy.ts';

const rider = new BurstRider();

await runBot({
  onBatch(state, batch) {
    return rider.onBatch(state, batch);
  },
  onDone(state) {
    rider.onDone(state);
  },
});
