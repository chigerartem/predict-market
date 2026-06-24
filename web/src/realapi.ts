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
