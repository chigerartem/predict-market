import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import type { Bet, Market, Me } from "./types";

const TON = 1_000_000_000;
const fmtTon = (nano: number) =>
  (nano / TON).toLocaleString("en-US", { maximumFractionDigits: 2 });
const fmtOdds = (milli: number) => (milli / 1000).toFixed(2);

type Tab = "markets" | "bets";

export default function App() {
  const [tab, setTab] = useState<Tab>("markets");
  const [me, setMe] = useState<Me | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [bets, setBets] = useState<Bet[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [m, mk] = await Promise.all([api.me(), api.markets()]);
      setMe(m);
      setMarkets(mk);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? `${e.status}: ${e.message}` : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadBets = useCallback(async () => {
    try {
      setBets(await api.myBets());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (tab === "bets") loadBets();
  }, [tab, loadBets]);

  return (
    <div className="flex flex-col" style={{ minHeight: "var(--app-h)" }}>
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/5 bg-bg/90 px-4 py-3 backdrop-blur">
        <span className="text-lg font-semibold">KopiX Predict</span>
        <span className="text-sm font-medium text-emerald-400">
          {me ? `${fmtTon(me.balance_nano)} TON` : "…"}
        </span>
      </header>

      <main className="flex-1 px-4 py-3 pb-20">
        {error && (
          <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
        {loading ? (
          <div className="py-10 text-center text-white/40">Загрузка…</div>
        ) : tab === "markets" ? (
          <MarketsView markets={markets} onBet={refresh} />
        ) : (
          <BetsView bets={bets} markets={markets} />
        )}
      </main>

      <nav className="fixed inset-x-0 bottom-0 grid grid-cols-2 border-t border-white/5 bg-bg">
        {(["markets", "bets"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`py-3 text-sm font-medium ${
              tab === t ? "text-emerald-400" : "text-white/50"
            }`}
          >
            {t === "markets" ? "Рынки" : "Мои ставки"}
          </button>
        ))}
      </nav>
    </div>
  );
}

function MarketsView({ markets, onBet }: { markets: Market[]; onBet: () => void }) {
  if (!markets.length) {
    return <div className="py-10 text-center text-white/40">Пока нет открытых рынков</div>;
  }
  return (
    <div className="space-y-3">
      {markets.map((m) => (
        <MarketCard key={m.id} market={m} onBet={onBet} />
      ))}
    </div>
  );
}

function MarketCard({ market, onBet }: { market: Market; onBet: () => void }) {
  const [sel, setSel] = useState<number | null>(null);
  const [stake, setStake] = useState("10");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const place = async () => {
    if (sel == null) return;
    setBusy(true);
    setMsg(null);
    try {
      const nano = Math.round(parseFloat(stake) * TON);
      await api.placeBet(sel, nano);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
      setMsg("Ставка принята ✓");
      setSel(null);
      onBet();
    } catch (e) {
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error");
      setMsg(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
      <div className="mb-3 font-medium">{market.title}</div>
      <div className="grid grid-cols-2 gap-2">
        {market.outcomes.map((o) => (
          <button
            key={o.id}
            onClick={() => setSel(o.id)}
            className={`rounded-xl border px-3 py-2 text-left ${
              sel === o.id
                ? "border-emerald-400 bg-emerald-400/10"
                : "border-white/10 bg-white/[0.02]"
            }`}
          >
            <div className="text-sm">{o.title}</div>
            <div className="font-semibold text-emerald-400">{fmtOdds(o.odds_milli)}×</div>
          </button>
        ))}
      </div>
      {sel != null && (
        <div className="mt-3 flex items-center gap-2">
          <input
            value={stake}
            onChange={(e) => setStake(e.target.value)}
            inputMode="decimal"
            placeholder="Ставка, TON"
            className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none"
          />
          <button
            disabled={busy}
            onClick={place}
            className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
          >
            {busy ? "…" : "Поставить"}
          </button>
        </div>
      )}
      {msg && <div className="mt-2 text-sm text-white/70">{msg}</div>}
    </div>
  );
}

function BetsView({ bets, markets }: { bets: Bet[]; markets: Market[] }) {
  if (!bets.length) {
    return <div className="py-10 text-center text-white/40">Ставок пока нет</div>;
  }
  const title = (id: number) => markets.find((m) => m.id === id)?.title ?? `Рынок #${id}`;
  const color = (s: string) =>
    s === "WON" ? "text-emerald-400" : s === "LOST" ? "text-red-400" : "text-white/50";
  return (
    <div className="space-y-2">
      {bets.map((b) => (
        <div
          key={b.id}
          className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] p-3"
        >
          <div>
            <div className="text-sm">{title(b.market_id)}</div>
            <div className="text-xs text-white/40">
              {fmtTon(b.stake_nano)} TON @ {fmtOdds(b.odds_milli)}× → {fmtTon(b.payout_nano)} TON
            </div>
          </div>
          <span className={`text-xs font-medium ${color(b.status)}`}>{b.status}</span>
        </div>
      ))}
    </div>
  );
}
