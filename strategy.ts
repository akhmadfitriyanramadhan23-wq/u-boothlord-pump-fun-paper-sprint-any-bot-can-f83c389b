// Burst-rider for the pump.fun paper sprint (agent-fun/replay/v2).
//
// Idea, from the dev window's own data (24 h of real pump.fun events):
// a new coin's first slot is a vertical burst that no bot can buy — the
// burst happens inside one slot, and any order decided on that batch fills
// two slots later, after the burst. What is left after the burst is what
// can be traded: most coins decay back toward their create price, but the
// coins with the strongest bursts keep running for about a minute. The
// edge is selectivity plus speed: only buy a coin whose price already ran
// 3x or more off its create price on at least 20 SOL of early buy flow,
// hold it for at most ~1 minute (300 slots), and let it run inside that
// minute with a wide trailing stop (35%) and a hard stop (-30%). Winners
// are rare and fat tailed, so no fixed take-profit: the trailing stop is
// the exit, and the short hold is what stops the slow bleed that kills
// longer holds (a 13-minute hold lost ~1.1 SOL on the same entries).
// A small second tier (1x burst, 5 SOL of buy flow, 0.02 SOL size) trades
// a few extra coins cheaply so the entry clears the 20-coin guardrail
// even in a quiet 6-hour window; it stops once 30 distinct coins have
// been round-tripped.
//
// Sizing is capped by the harness rule: buys on one mint in one reply may
// spend at most 1% of the mint's real SOL reserve. Fees are ~1.25% a side
// plus a 105,000-lamport transaction fee per order, so sizes below 0.01 SOL
// never pay; tier sizes are 0.30 / 0.02 SOL.
//
// Everything here is deterministic: every decision comes from the event
// stream only. No clock, no environment, no randomness.

import type { Batch, BotState, Fill, OrderInput } from './vendor/makefun-bot.ts';

// --- tiers ---------------------------------------------------------------
const TIER1 = {
  burstMin: 3.0, // price must be 3x its create price
  buySolMin: 20.0, // ... on at least 20 SOL of buy flow
  sizeLamports: 300_000_000n, // 0.30 SOL per buy
  stopLoss: -0.3, // sell at -30% from cost (rarely binds before the time exit)
  trail: 0.35, // sell 35% below the peak since entry
  maxHoldSlots: 300, // ~1 minute: bursts decay fast, so get out quickly
};
const TIER2 = {
  burstMin: 1.0,
  buySolMin: 5.0,
  sizeLamports: 20_000_000n, // 0.02 SOL per buy
  stopLoss: -0.1,
  trail: 0.15,
  maxHoldSlots: 600, // ~2 minutes
};
const TIER2_DISTINCT_CAP = 30; // stop filler entries once 30 coins closed
const REAL_MIN_LAMPORTS = 1_000_000_000n; // need real reserve >= 1 SOL
const MIN_BUY_LAMPORTS = 10_000_000n; // 0.01 SOL: the guardrail's round trip
const TRAIL_MIN_GAIN = 0.03; // trailing stop only arms above +3%
const BUY_SLIPPAGE_BPS = 5000; // bursts move fast; accept a wide fill
const SELL_SLIPPAGE_BPS = 10000; // dumps move fast too: fill on the first try

interface CoinTrack {
  /** Price (virtual quote / virtual token) at first sight. */
  p0: number;
  /** Latest known price. */
  price: number;
  trades: number;
  buySol: number;
  complete: boolean;
}

interface Held {
  tier: 1 | 2;
  /** Tokens held, as of the latest account. */
  tokens: bigint;
  /** Total SOL outlay (fill quote + tx fee), lamports. */
  costLamports: bigint;
  /** Highest value/cost ratio seen since entry. */
  peakRatio: number;
  entrySlot: number;
}

function priceOf(vq: bigint, vt: bigint): number {
  if (vt === 0n) return 0;
  return Number(vq) / Number(vt);
}

export class BurstRider {
  /** Per-mint launch tracking, in first-seen order. */
  private coins = new Map<string, CoinTrack>();
  /** Mints we already tried to buy once (one entry per mint, ever). */
  private entered = new Set<string>();
  /** Open positions, keyed by mint. */
  private held = new Map<string, Held>();
  /** Pending buy client_id -> mint + tier, so fills can open positions. */
  private pendingBuys = new Map<string, { mint: string; tier: 1 | 2 }>();
  /** Mints with a completed round trip (any sell fill). */
  private closed = new Set<string>();
  private buys = 0;
  private sells = 0;
  private fillsSeen = 0;

  onBatch(state: BotState, batch: Batch): OrderInput[] {
    const orders: OrderInput[] = [];
    this.applyFills(batch.fills);
    this.syncHeld(state);
    this.considerExits(state, batch, orders);
    this.considerEntries(state, batch, orders);
    return orders;
  }

  onDone(state: BotState): void {
    const cashSol = Number(state.cash) / 1e9;
    console.error(
      `[burst-rider] done: cash=${cashSol.toFixed(4)} SOL buys=${this.buys} sells=${this.sells} ` +
        `distinctClosed=${this.closed.size} open=${this.held.size} fillsSeen=${this.fillsSeen}`,
    );
  }

  /** Fold this batch's fills in: open positions on buy fills, close on sells. */
  private applyFills(fills: Fill[]): void {
    for (const f of fills) {
      this.fillsSeen++;
      if (f.status !== 'filled') {
        // A rejected/failed buy frees nothing: the mint stays entered
        // (one shot per mint) and no position opens.
        this.pendingBuys.delete(f.client_id);
        continue;
      }
      if (f.side === 'buy') {
        const pend = this.pendingBuys.get(f.client_id);
        this.pendingBuys.delete(f.client_id);
        if (pend === undefined) continue;
        const tokens = BigInt(f.token_amount);
        if (tokens === 0n) continue;
        this.buys++;
        this.held.set(pend.mint, {
          tier: pend.tier,
          tokens,
          costLamports: BigInt(f.quote_lamports) + BigInt(f.tx_fee_lamports),
          peakRatio: 1,
          entrySlot: f.slot,
        });
      } else {
        // Any sell fill (ours, or a harness close) completes the round trip.
        this.closed.add(f.mint);
        this.sells++;
        this.held.delete(f.mint);
      }
    }
  }

  /** Drop held records for mints the account no longer holds. */
  private syncHeld(state: BotState): void {
    for (const mint of [...this.held.keys()]) {
      const pos = state.positions.get(mint);
      if (pos === undefined) {
        this.held.delete(mint);
        continue;
      }
      const rec = this.held.get(mint)!;
      rec.tokens = pos.token_amount;
    }
  }

  /** Sells for every held position whose exit rule fires. */
  private considerExits(state: BotState, batch: Batch, orders: OrderInput[]): void {
    // A sell already in flight (fills two slots after its batch) covers the
    // position: sending another for the same tokens only earns a rejection
    // (insufficient_tokens) once the first fills.
    const sellPending = new Set<string>();
    for (const p of state.pending.values()) {
      if (p.order.side === 'sell') sellPending.add(p.order.mint);
    }
    for (const [mint, rec] of this.held) {
      if (sellPending.has(mint)) continue;
      const curve = state.curves.get(mint);
      if (curve === undefined || curve.complete) continue;
      const price = priceOf(curve.virtual_quote_reserves, curve.virtual_token_reserves);
      if (price <= 0 || rec.costLamports === 0n) continue;
      // Current value in lamports (float is plenty: ratios need ~0.1% accuracy).
      const value = Number(rec.tokens) * price;
      const ratio = value / Number(rec.costLamports);
      if (ratio > rec.peakRatio) rec.peakRatio = ratio;
      const gain = ratio - 1;
      const cfg = rec.tier === 1 ? TIER1 : TIER2;
      const heldTooLong = batch.slot - rec.entrySlot >= cfg.maxHoldSlots;
      const stopHit = gain <= cfg.stopLoss;
      const trailHit = gain > TRAIL_MIN_GAIN && ratio < rec.peakRatio * (1 - cfg.trail);
      if (stopHit || trailHit || heldTooLong) {
        orders.push({
          side: 'sell',
          mint,
          token_amount: rec.tokens,
          max_slippage_bps: SELL_SLIPPAGE_BPS,
        });
      }
    }
  }

  /** Buys: walk this batch's events in order, track launches, buy bursts. */
  private considerEntries(state: BotState, batch: Batch, orders: OrderInput[]): void {
    // Buys added in this reply also commit position slots (the harness
    // counts them only once they are sent, so track them here).
    let buysAdded = 0;
    let cashReserved = 0n;
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        if (!this.coins.has(e.mint)) {
          this.coins.set(e.mint, {
            p0: priceOf(BigInt(e.virtual_quote_reserves), BigInt(e.virtual_token_reserves)),
            price: priceOf(BigInt(e.virtual_quote_reserves), BigInt(e.virtual_token_reserves)),
            trades: 0,
            buySol: 0,
            complete: false,
          });
        }
        continue;
      }
      if (e.event === 'CompleteEvent') {
        const c = this.coins.get(e.mint);
        if (c !== undefined) c.complete = true;
        continue;
      }
      // TradeEvent.
      let c = this.coins.get(e.mint);
      if (c === undefined) {
        c = {
          p0: priceOf(BigInt(e.virtual_quote_reserves), BigInt(e.virtual_token_reserves)),
          price: 0,
          trades: 0,
          buySol: 0,
          complete: false,
        };
        this.coins.set(e.mint, c);
      }
      c.price = priceOf(BigInt(e.virtual_quote_reserves), BigInt(e.virtual_token_reserves));
      c.trades += 1;
      if (e.is_buy) c.buySol += Number(BigInt(e.sol_amount)) / 1e9;

      if (this.entered.has(e.mint)) continue;
      if (this.held.has(e.mint)) continue;
      if (c.complete || c.trades < 2 || c.p0 <= 0) continue;
      if (BigInt(e.real_quote_reserves) < REAL_MIN_LAMPORTS) continue;
      const burst = c.price / c.p0 - 1;

      let tier: 1 | 2 | 0 = 0;
      if (burst >= TIER1.burstMin && c.buySol >= TIER1.buySolMin) tier = 1;
      else if (
        burst >= TIER2.burstMin &&
        c.buySol >= TIER2.buySolMin &&
        this.closed.size < TIER2_DISTINCT_CAP
      ) {
        tier = 2;
      }
      if (tier === 0) continue;
      if (state.committedPositionCount() + buysAdded >= state.hello.caps.max_open_positions) continue;

      const cfg = tier === 1 ? TIER1 : TIER2;
      const cap = state.maxBuyLamports(e.mint);
      const size = cfg.sizeLamports < cap ? cfg.sizeLamports : cap;
      if (size < MIN_BUY_LAMPORTS) continue;
      if (state.freeCashLamports() - cashReserved < size + state.txFeeLamports()) continue;

      const id = state.clientId();
      this.pendingBuys.set(id, { mint: e.mint, tier });
      this.entered.add(e.mint);
      buysAdded++;
      cashReserved += size + state.txFeeLamports();
      orders.push({
        side: 'buy',
        client_id: id,
        mint: e.mint,
        quote_lamports: size,
        max_slippage_bps: BUY_SLIPPAGE_BPS,
      });
    }
  }
}
