// Client-side demo backend. When VITE_DEMO=true (the GitHub Pages build) realapi
// routes every call here instead of fetching the Go API — so markets, betting, all
// four games, balance and profile run fully interactively in a plain browser with no
// server. State lives in memory + localStorage so it survives reloads.
//
// Types are imported type-only from realapi → no runtime import cycle.
import type {
  Market, Me, Bet, TonDepositInfo, Withdrawal, RocketState,
  DiceState, DiceRollResult, DiceRollRow,
  CaseState, CaseSpinResult, CaseSpinRow, CasePrize,
  BasketState, BasketThrowResult, BasketThrowRow, BasketScore,
} from "./realapi";

export const DEMO = import.meta.env.VITE_DEMO === "true";

const NANO = 1_000_000_000;
const LS_KEY = "predict_demo_v1";

// Small fake network delay so the UI exercises its loading states.
const wait = <T>(v: T, ms = 180): Promise<T> =>
  new Promise((r) => setTimeout(() => r(v), ms));
const isoNow = () => new Date().toISOString();
const hex = (n = 32) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");

// ── Markets (static, realistic Polymarket-style) ─────────────────────────────
// Outcome ids are globally unique so placeBet can resolve them.
export const MARKETS: Market[] = [
  {
    id: 1, category: "sports", title: "Will Real Madrid win the 2026 Champions League?",
    close_time: "2026-05-30T20:00:00Z", game_start_time: null,
    description: "Resolves YES if Real Madrid win the 2025/26 UEFA Champions League final.",
    context_description: "Madrid are among the favourites after a strong group stage.",
    outcomes: [{ id: 101, title: "Yes", odds_milli: 4200 }, { id: 102, title: "No", odds_milli: 1250 }],
  },
  {
    id: 2, category: "sports", title: "Lakers vs Celtics — who wins tonight?",
    close_time: "2026-07-02T02:30:00Z", game_start_time: "2026-07-02T00:00:00Z",
    description: "Resolves to the winner of the regular-season game.",
    outcomes: [{ id: 103, title: "Lakers", odds_milli: 1900 }, { id: 104, title: "Celtics", odds_milli: 1950 }],
  },
  {
    id: 3, category: "crypto", title: "Will Bitcoin close above $150,000 in 2026?",
    close_time: "2026-12-31T23:59:00Z", game_start_time: null,
    description: "Resolves YES if BTC/USD closes ≥ $150,000 on any day in 2026 (Coinbase).",
    context_description: "BTC is trading near all-time highs going into H2.",
    outcomes: [{ id: 105, title: "Yes", odds_milli: 2600 }, { id: 106, title: "No", odds_milli: 1530 }],
  },
  {
    id: 4, category: "crypto", title: "Will Ethereum flip $6,000 before October?",
    close_time: "2026-10-01T00:00:00Z", game_start_time: null,
    description: "Resolves YES if ETH/USD trades ≥ $6,000 before 1 Oct 2026.",
    outcomes: [{ id: 107, title: "Yes", odds_milli: 3100 }, { id: 108, title: "No", odds_milli: 1380 }],
  },
  {
    id: 5, category: "politics", title: "Will there be a US government shutdown in Q4 2026?",
    close_time: "2026-12-31T23:59:00Z", game_start_time: null,
    description: "Resolves YES if a federal funding gap causes a shutdown in Oct–Dec 2026.",
    outcomes: [{ id: 109, title: "Yes", odds_milli: 2200 }, { id: 110, title: "No", odds_milli: 1650 }],
  },
  {
    id: 6, category: "politics", title: "Will the EU admit a new member state by 2027?",
    close_time: "2027-01-01T00:00:00Z", game_start_time: null,
    description: "Resolves YES if any country formally joins the EU before 2027.",
    outcomes: [{ id: 111, title: "Yes", odds_milli: 5200 }, { id: 112, title: "No", odds_milli: 1150 }],
  },
  {
    id: 7, category: "economy", title: "Will the Fed cut rates at the next meeting?",
    close_time: "2026-07-29T18:00:00Z", game_start_time: null,
    description: "Resolves to the FOMC decision at the next scheduled meeting.",
    context_description: "Markets price a cut as the more likely outcome.",
    outcomes: [{ id: 113, title: "Cut", odds_milli: 1450 }, { id: 114, title: "Hold", odds_milli: 2750 }],
  },
  {
    id: 8, category: "economy", title: "Will US inflation be under 3% in the next CPI print?",
    close_time: "2026-07-15T12:30:00Z", game_start_time: null,
    description: "Resolves YES if headline YoY CPI < 3.0%.",
    outcomes: [{ id: 115, title: "Yes", odds_milli: 1750 }, { id: 116, title: "No", odds_milli: 2050 }],
  },
  {
    id: 9, category: "other", title: "Will a new Nintendo console be announced this year?",
    close_time: "2026-12-31T23:59:00Z", game_start_time: null,
    description: "Resolves YES on an official announcement of new Nintendo hardware in 2026.",
    outcomes: [{ id: 117, title: "Yes", odds_milli: 1600 }, { id: 118, title: "No", odds_milli: 2300 }],
  },
  {
    id: 10, category: "other", title: "Will this year be the hottest on record?",
    close_time: "2027-01-15T00:00:00Z", game_start_time: null,
    description: "Resolves YES if 2026 is the warmest year in the instrumental record (NASA/NOAA).",
    outcomes: [{ id: 119, title: "Yes", odds_milli: 1700 }, { id: 120, title: "No", odds_milli: 2150 }],
  },
];

const outcomeIndex = new Map<number, { m: Market; oTitle: string; odds: number }>();
for (const m of MARKETS) for (const o of m.outcomes) outcomeIndex.set(o.id, { m, oTitle: o.title, odds: o.odds_milli });

// ── Persistent store ─────────────────────────────────────────────────────────
type Store = {
  balanceNano: number;
  bets: Bet[]; // newest first
  diceRecent: DiceRollRow[];
  caseRecent: CaseSpinRow[];
  basketRecent: BasketThrowRow[];
  seq: number;
  nonce: number;
};

function seedStore(): Store {
  // A couple of settled bets so Profile/My-bets stats aren't empty on first open.
  const bets: Bet[] = [
    {
      id: 9001, market_id: 3, outcome_id: 105, stake_nano: 20 * NANO, odds_milli: 2600,
      payout_nano: 52 * NANO, status: "WON", placed_at: "2026-06-20T10:00:00Z",
      market_title: MARKETS[2].title, outcome_title: "Yes",
    },
    {
      id: 9002, market_id: 7, outcome_id: 114, stake_nano: 15 * NANO, odds_milli: 2750,
      payout_nano: 41 * NANO, status: "LOST", placed_at: "2026-06-22T14:30:00Z",
      market_title: MARKETS[6].title, outcome_title: "Hold",
    },
  ];
  return { balanceNano: 1000 * NANO, bets, diceRecent: [], caseRecent: [], basketRecent: [], seq: 9100, nonce: 1 };
}

function load(): Store {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as Store;
  } catch { /* ignore */ }
  return seedStore();
}

// In the prod (non-demo) build DEMO is a constant false → these branches are dead and
// dropped; seedStore() avoids touching localStorage there.
let store = DEMO ? load() : seedStore();
function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch { /* ignore */ }
}
const nextId = () => ++store.seq;

// ── Markets / balance / bets ───────────────────────────────────────────────
export const dMarkets = (): Promise<Market[]> => wait(MARKETS);

export const dMe = (): Promise<Me> => wait({
  user_id: 1,
  balance_nano: store.balanceNano,
  withdraw_enabled: true,
  min_withdraw_nano: NANO,
  withdraw_fee_nano: NANO / 20,
});

export const dMyBets = (): Promise<Bet[]> => wait([...store.bets]);

export async function dPlaceBet(outcomeId: number, stakeNano: number): Promise<Bet> {
  const hit = outcomeIndex.get(outcomeId);
  if (!hit) throw new Error("outcome not found");
  // Mirror the backend rule: one active bet per market.
  if (store.bets.some((b) => b.market_id === hit.m.id && b.status === "PLACED"))
    throw new Error("already bet on this market");
  if (stakeNano > store.balanceNano) throw new Error("could not place bet (check balance)");
  const payout = Math.floor((stakeNano * hit.odds) / 1000);
  store.balanceNano -= stakeNano;
  const bet: Bet = {
    id: nextId(), market_id: hit.m.id, outcome_id: outcomeId, stake_nano: stakeNano,
    odds_milli: hit.odds, payout_nano: payout, status: "PLACED", placed_at: isoNow(),
    market_title: hit.m.title, outcome_title: hit.oTitle,
    description: hit.m.description, context_description: hit.m.context_description,
    close_time: hit.m.close_time, game_start_time: hit.m.game_start_time,
  };
  store.bets.unshift(bet);
  save();
  return wait(bet);
}

// ── Deposit / withdraw ─────────────────────────────────────────────────────
// Demo TON price (~$5) for the Stars→TON estimate; $0.013 credited per star.
export const dStarsQuote = (stars: number): Promise<number> =>
  wait(Math.round((stars * 0.013 / 5) * NANO));
export const dTonDepositInfo = (): Promise<TonDepositInfo> =>
  wait({ address: "EQDemo…TONaddress", memo: "demo", min_nano: NANO / 10 });

// Demo deposit credits the mock balance instantly (no TON Connect / Stars invoice).
export function dDeposit(nano: number) { store.balanceNano += nano; save(); }

export async function dWithdraw(_to: string, amountNano: number): Promise<Withdrawal> {
  if (amountNano < NANO) throw new Error("amount below minimum");
  if (amountNano > store.balanceNano) throw new Error("insufficient balance");
  const fee = NANO / 20;
  store.balanceNano -= amountNano;
  save();
  return wait({ id: nextId(), status: "pending", amount_nano: amountNano, fee_nano: fee, send_nano: amountNano - fee });
}

// ── Dice ───────────────────────────────────────────────────────────────────
const DICE_EXACT: Record<string, number> = (() => {
  const counts: Record<number, number> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
  const t: Record<string, number> = {};
  for (const s of Object.keys(counts)) t[s] = Math.floor((36 / counts[+s]) * 0.9 * 1000); // ~10% edge
  return t;
})();
const DICE_STATE: DiceState = {
  server_seed_hash: hex(), client_seed: "demo", nonce: store.nonce, edge_bp: 1000,
  min_stake_nano: NANO / 10, max_stake_nano: 0,
  mult_low: 2160, mult_high: 2160, mult_exact: DICE_EXACT, recent: [],
};
export const dDiceState = (): Promise<DiceState> => wait({ ...DICE_STATE, nonce: store.nonce, recent: [...store.diceRecent] });

export async function dDiceRoll(betKind: "low" | "high" | "exact", betTarget: number, stakeNano: number): Promise<DiceRollResult> {
  if (stakeNano > store.balanceNano) throw new Error("not enough TON");
  const die1 = 1 + Math.floor(Math.random() * 6);
  const die2 = 1 + Math.floor(Math.random() * 6);
  const sum = die1 + die2;
  let won = false; let mult = 0;
  if (betKind === "low") { won = sum < 7; mult = DICE_STATE.mult_low; }
  else if (betKind === "high") { won = sum > 7; mult = DICE_STATE.mult_high; }
  else { won = sum === betTarget; mult = DICE_EXACT[String(betTarget)] ?? 0; }
  const payout = won ? Math.floor((stakeNano * mult) / 1000) : 0;
  store.balanceNano += payout - stakeNano;
  store.nonce += 1;
  const row: DiceRollRow = {
    id: nextId(), nonce: store.nonce, bet_kind: betKind, bet_target: betTarget, stake_nano: stakeNano,
    die1, die2, sum, won, mult_milli: won ? mult : 0, payout_nano: payout, created_at: isoNow(),
  };
  store.diceRecent = [row, ...store.diceRecent].slice(0, 20);
  save();
  return wait({
    roll_id: row.id, nonce: store.nonce, die1, die2, sum, won,
    mult_milli: won ? mult : 0, payout_nano: payout, balance_nano: store.balanceNano, server_seed_hash: DICE_STATE.server_seed_hash,
  });
}

// ── Case opening ───────────────────────────────────────────────────────────
const CASE_PRIZES: CasePrize[] = [
  { rarity: "grey", mult_milli: 0 },
  { rarity: "blue", mult_milli: 1500 },
  { rarity: "purple", mult_milli: 2000 },
  { rarity: "pink", mult_milli: 5000 },
  { rarity: "red", mult_milli: 20000 },
  { rarity: "gold", mult_milli: 200000 },
];
const CASE_WEIGHTS = [620, 250, 90, 33, 6, 1]; // sums 1000; ~90% RTP-ish
export const dCaseState = (): Promise<CaseState> => wait({
  server_seed_hash: hex(), client_seed: "demo", nonce: store.nonce,
  min_stake_nano: NANO / 10, max_stake_nano: 0, prizes: CASE_PRIZES, recent: [...store.caseRecent],
});

export async function dCaseOpen(stakeNano: number): Promise<CaseSpinResult> {
  if (stakeNano > store.balanceNano) throw new Error("not enough TON");
  const total = CASE_WEIGHTS.reduce((a, b) => a + b, 0);
  let r = Math.random() * total; let idx = 0;
  for (let i = 0; i < CASE_WEIGHTS.length; i++) { r -= CASE_WEIGHTS[i]; if (r <= 0) { idx = i; break; } }
  const prize = CASE_PRIZES[idx];
  const payout = Math.floor((stakeNano * prize.mult_milli) / 1000);
  store.balanceNano += payout - stakeNano;
  store.nonce += 1;
  const row: CaseSpinRow = {
    id: nextId(), nonce: store.nonce, stake_nano: stakeNano, prize_index: idx,
    rarity: prize.rarity, mult_milli: prize.mult_milli, payout_nano: payout, created_at: isoNow(),
  };
  store.caseRecent = [row, ...store.caseRecent].slice(0, 20);
  save();
  return wait({
    spin_id: row.id, nonce: store.nonce, prize_index: idx, rarity: prize.rarity,
    mult_milli: prize.mult_milli, stake_nano: stakeNano, payout_nano: payout,
    balance_nano: store.balanceNano, server_seed_hash: hex(),
  });
}

// ── Basketball ─────────────────────────────────────────────────────────────
const BASKET_SCORES: BasketScore[] = [
  { mult_milli: 1500, chance_bp: 3334 }, // 33.34% → 1.5×
  { mult_milli: 4000, chance_bp: 1666 }, // 16.66% → 4×
];
const BASKET_HIT_BP = 5000; // 50% total
export const dBasketState = (): Promise<BasketState> => wait({
  server_seed_hash: hex(), client_seed: "demo", nonce: store.nonce, hit_prob_bp: BASKET_HIT_BP,
  scores: BASKET_SCORES, min_stake_nano: NANO / 10, max_stake_nano: 0, recent: [...store.basketRecent],
});

export async function dBasketThrow(stakeNano: number): Promise<BasketThrowResult> {
  if (stakeNano > store.balanceNano) throw new Error("not enough TON");
  const roll = Math.floor(Math.random() * 10000); // 0..9999
  const hit = roll < BASKET_HIT_BP;
  let mult = 0; let outcomeIdx: number; let anim: string;
  if (hit) {
    // Pick a score tier by its chance within the hit space.
    const tierRoll = Math.random() * BASKET_SCORES.reduce((a, s) => a + s.chance_bp, 0);
    let acc = 0; let ti = 0;
    for (let i = 0; i < BASKET_SCORES.length; i++) { acc += BASKET_SCORES[i].chance_bp; if (tierRoll <= acc) { ti = i; break; } }
    mult = BASKET_SCORES[ti].mult_milli;
    outcomeIdx = ti; // 0..n-1 winning tiers
    anim = ti === BASKET_SCORES.length - 1 ? "basket-hit-2" : "basket-hit-1";
  } else {
    outcomeIdx = BASKET_SCORES.length + Math.floor(Math.random() * 3); // a miss bucket
    anim = `basket-miss-${1 + Math.floor(Math.random() * 3)}`;
  }
  const payout = hit ? Math.floor((stakeNano * mult) / 1000) : 0;
  store.balanceNano += payout - stakeNano;
  store.nonce += 1;
  const row: BasketThrowRow = {
    id: nextId(), nonce: store.nonce, stake_nano: stakeNano, roll, hit,
    mult_milli: hit ? mult : 0, payout_nano: payout, created_at: isoNow(),
  };
  store.basketRecent = [row, ...store.basketRecent].slice(0, 20);
  save();
  return wait({
    throw_id: row.id, nonce: store.nonce, roll, outcome_index: outcomeIdx, anim, hit,
    mult_milli: hit ? mult : 0, stake_nano: stakeNano, payout_nano: payout,
    balance_nano: store.balanceNano, server_seed_hash: hex(),
  });
}

// ── Rocket (crash) — simulated round engine + SSE-compatible source ─────────
// Matches RocketGame's local curve (1000·e^{0.15·t}) so frames track without resync.
const ROCKET_K = 0.15;
const rocket = {
  phase: "BETTING" as RocketState["phase"],
  roundId: 1,
  crashMilli: 2000,
  flyStart: 0,
  phaseEnd: 0, // performance.now() deadline for BETTING/CRASHED
  multMilli: 1000,
  history: [1820, 1050, 4730, 1260, 9210, 1500, 2340] as number[],
  betNano: 0,
  cashedMilli: 0,
  seedHash: hex(),
};

function rocketPickCrash(): number {
  // Heavy-tail: most rounds low, occasional high. ~3% instant-ish, cap 50×.
  const r = Math.random();
  const m = Math.max(1000, Math.floor(1000 / (1 - r * 0.97)));
  return Math.min(50000, m);
}
function rocketAdvance(now: number) {
  if (rocket.phase === "BETTING") {
    if (now >= rocket.phaseEnd) {
      rocket.phase = "FLYING"; rocket.flyStart = now; rocket.multMilli = 1000;
    }
  } else if (rocket.phase === "FLYING") {
    const m = Math.floor(1000 * Math.exp(ROCKET_K * ((now - rocket.flyStart) / 1000)));
    rocket.multMilli = Math.min(m, rocket.crashMilli);
    if (m >= rocket.crashMilli) {
      rocket.phase = "CRASHED"; rocket.multMilli = rocket.crashMilli;
      rocket.history = [rocket.crashMilli, ...rocket.history].slice(0, 12);
      rocket.phaseEnd = now + 3000;
    }
  } else if (rocket.phase === "CRASHED") {
    if (now >= rocket.phaseEnd) {
      rocket.roundId += 1; rocket.phase = "BETTING"; rocket.multMilli = 1000;
      rocket.crashMilli = rocketPickCrash(); rocket.betNano = 0; rocket.cashedMilli = 0;
      rocket.seedHash = hex(); rocket.phaseEnd = now + 6000;
    }
  }
}
function rocketFrame(now: number): RocketState {
  const timeLeft = rocket.phase === "BETTING" ? Math.max(0, rocket.phaseEnd - now) : 0;
  return {
    phase: rocket.phase, round_id: rocket.roundId, multiplier_milli: rocket.multMilli,
    crash_milli: rocket.phase === "CRASHED" ? rocket.crashMilli : undefined,
    seed_hash: rocket.seedHash, time_left_ms: Math.round(timeLeft),
    history: [...rocket.history], server_now_ms: Date.now(),
  };
}

// Minimal EventSource-compatible stub RocketGame can use unchanged (onmessage/onerror/close).
class DemoRocketSource {
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  private timer: number;
  constructor() {
    if (rocket.phaseEnd === 0) rocket.phaseEnd = performance.now() + 6000; // first BETTING window
    this.timer = window.setInterval(() => {
      const now = performance.now();
      rocketAdvance(now);
      this.onmessage?.({ data: JSON.stringify(rocketFrame(now)) });
    }, 120);
  }
  close() { window.clearInterval(this.timer); }
}
export const createDemoRocketSource = () => new DemoRocketSource() as unknown as EventSource;

export async function dRocketBet(stakeNano: number): Promise<{ round_id: number; bet_id: number }> {
  if (rocket.phase !== "BETTING") throw new Error("betting is closed");
  if (stakeNano > store.balanceNano) throw new Error("not enough TON");
  store.balanceNano -= stakeNano; rocket.betNano = stakeNano; rocket.cashedMilli = 0; save();
  return wait({ round_id: rocket.roundId, bet_id: nextId() }, 60);
}
export async function dRocketCashout(): Promise<{ multiplier_milli: number; payout_nano: number }> {
  if (rocket.phase !== "FLYING" || rocket.betNano <= 0 || rocket.cashedMilli > 0) throw new Error("no active bet");
  const mult = rocket.multMilli;
  const payout = Math.floor((rocket.betNano * mult) / 1000);
  store.balanceNano += payout; rocket.cashedMilli = mult; save();
  return wait({ multiplier_milli: mult, payout_nano: payout }, 60);
}
