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
  outcomes: MarketOutcome[];
};

// fetchMarkets returns the open markets. Requires Telegram auth (so it resolves
// inside the Mini App; in a plain browser it 401s and the caller shows empty).
export async function fetchMarkets(): Promise<Market[]> {
  const r = await fetch(`${API_BASE}/api/markets`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`markets ${r.status}`);
  return (await r.json()) as Market[];
}

export type Me = { user_id: number; balance_nano: number };

// fetchMe returns the authenticated user's TON balance (nano-TON).
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
