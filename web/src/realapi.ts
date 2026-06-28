// Real backend calls to the Go API (api.market.kopix.online), authenticated with
// Telegram initData. Kept separate from api.ts (the legacy cashback mock shell) —
// we wire real prediction-market endpoints here as we rebuild the UI.

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

function authHeaders(): Record<string, string> {
  const initData = window.Telegram?.WebApp?.initData ?? "";
  return initData ? { Authorization: `tma ${initData}` } : {};
}

export type MarketOutcome = { id: number; title: string; odds_milli: number };

export type Market = {
  id: number;
  title: string;
  category: string;
  close_time: string | null;
  game_start_time?: string | null;
  image_url?: string;
  description?: string;
  context_description?: string;
  outcomes: MarketOutcome[];
};

// fetchMarkets returns the open markets. Requires Telegram auth (so it resolves
// inside the Mini App; in a plain browser it 401s and the caller shows empty).
export async function fetchMarkets(): Promise<Market[]> {
  const r = await fetch(`${API_BASE}/api/markets`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`markets ${r.status}`);
  return (await r.json()) as Market[];
}

export type Me = {
  user_id: number;
  balance_nano: number;
  // Withdrawal config so the UI can validate and show the net amount before submit.
  withdraw_enabled: boolean;
  min_withdraw_nano: number;
  withdraw_fee_nano: number;
};

// fetchMe returns the authenticated user's TON balance (nano-TON) and the
// withdrawal limits/fee the server enforces.
export async function fetchMe(): Promise<Me> {
  const r = await fetch(`${API_BASE}/api/me`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`me ${r.status}`);
  return (await r.json()) as Me;
}

// createStarsInvoice asks the backend for a Stars (XTR) invoice link the Mini App
// opens via Telegram.WebApp.openInvoice. The balance is credited server-side on the
// successful_payment webhook, so refetch the balance once openInvoice reports "paid".
export async function createStarsInvoice(stars: number): Promise<string> {
  const r = await fetch(`${API_BASE}/api/deposit/stars/invoice`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ stars }),
  });
  if (!r.ok) throw new Error(`invoice ${r.status}`);
  const d = (await r.json()) as { link: string };
  return d.link;
}

// fetchStarsQuote returns how much TON (nano) a given Stars amount credits right
// now at the live rate — so the UI shows an honest equivalent before paying.
export async function fetchStarsQuote(stars: number): Promise<number> {
  const r = await fetch(`${API_BASE}/api/deposit/stars/quote?stars=${stars}`, {
    headers: authHeaders(),
  });
  if (!r.ok) throw new Error(`quote ${r.status}`);
  const d = (await r.json()) as { ton_nano: number };
  return d.ton_nano;
}

export type TonDepositInfo = { address: string; memo: string; min_nano: number };

// fetchTonDepositInfo returns the house TON deposit address and this user's unique
// memo. The Mini App sends TON (via TON Connect) to {address} with {memo} as the
// transfer comment; the backend watcher credits the confirmed inbound amount 1:1.
export async function fetchTonDepositInfo(): Promise<TonDepositInfo> {
  const r = await fetch(`${API_BASE}/api/deposit/ton/address`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`ton address ${r.status}`);
  return (await r.json()) as TonDepositInfo;
}

export type Withdrawal = {
  id: number;
  status: string;
  amount_nano: number;
  fee_nano: number;
  send_nano: number;
};

// requestWithdraw queues a TON payout of amountNano (gross) to toAddress. The
// server debits the balance immediately and a background sender broadcasts the
// transfer; the user receives amountNano minus the network fee. Throws with the
// server message (invalid address / amount too small / insufficient balance).
export async function requestWithdraw(toAddress: string, amountNano: number): Promise<Withdrawal> {
  const r = await fetch(`${API_BASE}/api/withdraw`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ to_address: toAddress, amount_nano: amountNano }),
  });
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error || `withdraw ${r.status}`);
  }
  return (await r.json()) as Withdrawal;
}

export type Bet = {
  id: number;
  market_id: number;
  outcome_id: number;
  stake_nano: number;
  odds_milli: number;
  payout_nano: number;
  status: string;
  placed_at: string;
  market_title: string;
  outcome_title: string;
  image_url?: string;
  description?: string;
  context_description?: string;
  close_time?: string | null;
  game_start_time?: string | null;
};

// ── Rocket (crash game) ───────────────────────────────────────────────────

export type RocketState = {
  phase: "BETTING" | "FLYING" | "CRASHED";
  round_id: number;
  multiplier_milli: number;
  crash_milli?: number;   // revealed only on CRASHED
  seed_hash: string;      // commitment, published before bets close
  seed?: string;          // hex, revealed only on CRASHED
  time_left_ms: number;   // betting/pause countdown
  history?: number[];     // recent crash points (milli), newest first
  server_now_ms: number;
};

// rocketStreamUrl is the SSE endpoint for live round state. The browser EventSource
// can't set headers, so initData rides the `auth` query param.
export function rocketStreamUrl(): string {
  const initData = window.Telegram?.WebApp?.initData ?? "";
  return `${API_BASE}/api/rocket/stream?auth=${encodeURIComponent(initData)}`;
}

// rocketBet locks stakeNano into the current round's betting window. One bet per
// round. Throws with the server message (betting closed / insufficient / etc).
export async function rocketBet(stakeNano: number): Promise<{ round_id: number; bet_id: number }> {
  const r = await fetch(`${API_BASE}/api/rocket/bet`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ stake_nano: stakeNano }),
  });
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error || `rocket bet ${r.status}`);
  }
  return (await r.json()) as { round_id: number; bet_id: number };
}

// rocketCashout cashes the caller out of the current flight at the live multiplier.
export async function rocketCashout(): Promise<{ multiplier_milli: number; payout_nano: number }> {
  const r = await fetch(`${API_BASE}/api/rocket/cashout`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error || `rocket cashout ${r.status}`);
  }
  return (await r.json()) as { multiplier_milli: number; payout_nano: number };
}

// ── Dice (instant two-dice game) ──────────────────────────────────────────

export type DiceRollRow = {
  id: number;
  nonce: number;
  bet_kind: "low" | "high" | "exact";
  bet_target?: number;
  stake_nano: number;
  die1: number;
  die2: number;
  sum: number;
  won: boolean;
  mult_milli: number;
  payout_nano: number;
  created_at: string;
};

export type DiceState = {
  server_seed_hash: string;
  client_seed: string;
  nonce: number;
  edge_bp: number;
  min_stake_nano: number;
  max_stake_nano: number;
  mult_low: number;
  mult_high: number;
  mult_exact: Record<string, number>; // keys "2".."12" → multiplier ×1000
  recent: DiceRollRow[];
};

export type DiceRollResult = {
  roll_id: number;
  nonce: number;
  die1: number;
  die2: number;
  sum: number;
  won: boolean;
  mult_milli: number;
  payout_nano: number;
  balance_nano: number;
  server_seed_hash: string;
};

// fetchDiceState returns the player's fairness commitment, the economics + the
// multiplier table, and recent rolls. Creates the seed on first call.
export async function fetchDiceState(): Promise<DiceState> {
  const r = await fetch(`${API_BASE}/api/dice/state`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`dice state ${r.status}`);
  return (await r.json()) as DiceState;
}

// diceRoll plays one instant roll. betKind is low/high/exact; betTarget is the sum
// (2–12) for exact and ignored otherwise. Returns the dice + settled outcome and
// the new balance. Throws with the server message.
export async function diceRoll(
  betKind: "low" | "high" | "exact",
  betTarget: number,
  stakeNano: number,
): Promise<DiceRollResult> {
  const r = await fetch(`${API_BASE}/api/dice/roll`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ bet_kind: betKind, bet_target: betTarget, stake_nano: stakeNano }),
  });
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error || `dice roll ${r.status}`);
  }
  return (await r.json()) as DiceRollResult;
}

// diceRotate reveals the current server seed and commits a fresh one (resetting the
// nonce), so the player can verify all rolls drawn under the old seed.
export async function diceRotate(clientSeed?: string): Promise<{
  old_server_seed: string;
  old_server_hash: string;
  rolled_nonce: number;
  server_seed_hash: string;
  client_seed: string;
}> {
  const r = await fetch(`${API_BASE}/api/dice/rotate`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ client_seed: clientSeed ?? "" }),
  });
  if (!r.ok) throw new Error(`dice rotate ${r.status}`);
  return await r.json();
}

// ── Case opening (instant CS:GO-style game) ───────────────────────────────

export type CasePrize = {
  rarity: "grey" | "blue" | "purple" | "pink" | "red" | "gold";
  mult_milli: number; // ×1000 (500 = 0.5×, 200000 = 200×)
};

export type CaseSpinRow = {
  id: number;
  nonce: number;
  stake_nano: number;
  prize_index: number;
  rarity: CasePrize["rarity"];
  mult_milli: number;
  payout_nano: number;
  created_at: string;
};

export type CaseState = {
  server_seed_hash: string;
  client_seed: string;
  nonce: number;
  min_stake_nano: number;
  max_stake_nano: number; // 0 = uncapped
  prizes: CasePrize[]; // reel tiers, low → high; weights stay server-side
  recent: CaseSpinRow[];
};

export type CaseSpinResult = {
  spin_id: number;
  nonce: number;
  prize_index: number;
  rarity: CasePrize["rarity"];
  mult_milli: number;
  stake_nano: number;
  payout_nano: number;
  balance_nano: number;
  server_seed_hash: string;
};

// fetchCaseState returns the fairness commitment, stake bounds, the prize table (rarity +
// multiplier) and recent spins. Creates the seed on first call.
export async function fetchCaseState(): Promise<CaseState> {
  const r = await fetch(`${API_BASE}/api/case/state`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`case state ${r.status}`);
  return (await r.json()) as CaseState;
}

// caseOpen plays one instant spin at the chosen stake. Returns the drawn prize (stake ×
// multiplier) and the new balance. Throws with the server message.
export async function caseOpen(stakeNano: number): Promise<CaseSpinResult> {
  const r = await fetch(`${API_BASE}/api/case/open`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ stake_nano: stakeNano }),
  });
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error || `case open ${r.status}`);
  }
  return (await r.json()) as CaseSpinResult;
}

// caseRotate reveals the current server seed and commits a fresh one (resetting the
// nonce), so the player can verify all spins drawn under the old seed.
export async function caseRotate(clientSeed?: string): Promise<{
  old_server_seed: string;
  old_server_hash: string;
  spun_nonce: number;
  server_seed_hash: string;
  client_seed: string;
}> {
  const r = await fetch(`${API_BASE}/api/case/rotate`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ client_seed: clientSeed ?? "" }),
  });
  if (!r.ok) throw new Error(`case rotate ${r.status}`);
  return await r.json();
}

// ── Basketball (instant shot game) ────────────────────────────────────────

export type BasketThrowRow = {
  id: number;
  nonce: number;
  stake_nano: number;
  roll: number;
  hit: boolean;
  mult_milli: number;
  payout_nano: number;
  created_at: string;
};

export type BasketScore = { mult_milli: number; chance_bp: number }; // winning tier

export type BasketState = {
  server_seed_hash: string;
  client_seed: string;
  nonce: number;
  hit_prob_bp: number; // total score chance (5000 = 50%)
  scores: BasketScore[]; // winning multipliers + their chances, low → high
  min_stake_nano: number;
  max_stake_nano: number;
  recent: BasketThrowRow[];
};

export type BasketThrowResult = {
  throw_id: number;
  nonce: number;
  roll: number;
  outcome_index: number;
  anim: string; // lottie name to play for this landing (server-authoritative)
  hit: boolean;
  mult_milli: number;
  stake_nano: number;
  payout_nano: number;
  balance_nano: number;
  server_seed_hash: string;
};

// fetchBasketState returns the fairness commitment, the economics (chance/edge/multiplier),
// stake bounds and recent throws. Creates the seed on first call.
export async function fetchBasketState(): Promise<BasketState> {
  const r = await fetch(`${API_BASE}/api/basket/state`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`basket state ${r.status}`);
  return (await r.json()) as BasketState;
}

// basketThrow plays one instant shot at the chosen stake. Returns the outcome (hit/miss)
// and the new balance. Throws with the server message.
export async function basketThrow(stakeNano: number): Promise<BasketThrowResult> {
  const r = await fetch(`${API_BASE}/api/basket/throw`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ stake_nano: stakeNano }),
  });
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error || `basket throw ${r.status}`);
  }
  return (await r.json()) as BasketThrowResult;
}

// basketRotate reveals the current server seed and commits a fresh one.
export async function basketRotate(clientSeed?: string): Promise<{
  old_server_seed: string;
  old_server_hash: string;
  thrown_nonce: number;
  server_seed_hash: string;
  client_seed: string;
}> {
  const r = await fetch(`${API_BASE}/api/basket/rotate`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ client_seed: clientSeed ?? "" }),
  });
  if (!r.ok) throw new Error(`basket rotate ${r.status}`);
  return await r.json();
}

// fetchMyBets returns the user's bets (newest first), with market + outcome titles.
export async function fetchMyBets(): Promise<Bet[]> {
  const r = await fetch(`${API_BASE}/api/bets`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`bets ${r.status}`);
  return (await r.json()) as Bet[];
}

// placeBet stakes stakeNano on outcomeId at its current odds. The server moves the
// stake to escrow and reserves the house payout in one transaction; it rejects the
// bet if the balance or the house can't cover it. Throws with the server message.
export async function placeBet(outcomeId: number, stakeNano: number): Promise<Bet> {
  const r = await fetch(`${API_BASE}/api/bets`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ outcome_id: outcomeId, stake_nano: stakeNano }),
  });
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error || `bet ${r.status}`);
  }
  return (await r.json()) as Bet;
}
