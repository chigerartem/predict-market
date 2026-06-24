import type { Me, Market, Bet } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE || "";

function authHeader(): HeadersInit {
  const initData = window.Telegram?.WebApp?.initData ?? "";
  return initData ? { Authorization: `tma ${initData}` } : {};
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    ...init,
    cache: "no-store", // Telegram WKWebView caches aggressively
    headers: {
      ...(init?.headers || {}),
      ...authHeader(),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!r.ok) {
    const detail = await r
      .json()
      .then((d) => d.detail || d.error)
      .catch(() => null);
    throw new ApiError(r.status, detail || r.statusText);
  }
  return r.json() as Promise<T>;
}

export const api = {
  me: () => jsonFetch<Me>("/api/me"),
  markets: () => jsonFetch<Market[]>("/api/markets"),
  myBets: () => jsonFetch<Bet[]>("/api/bets"),
  placeBet: (outcomeId: number, stakeNano: number) =>
    jsonFetch<Bet>("/api/bets", {
      method: "POST",
      body: JSON.stringify({ outcome_id: outcomeId, stake_nano: stakeNano }),
    }),
};
