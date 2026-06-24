import { useCallback, useEffect, useState, type SVGProps } from "react";
import { api, ApiError } from "./api";
import { notify } from "./haptics";
import type { Bet, Market, Me } from "./types";

const TON = 1_000_000_000;
const fmtTon = (nano: number) =>
  (nano / TON).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
const fmtOdds = (milli: number) => (milli / 1000).toFixed(2);

type Tab = "markets" | "bets";
type IconFC = (p: SVGProps<SVGSVGElement>) => JSX.Element;

const IconStroke = (props: SVGProps<SVGSVGElement>) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    {...props}
  />
);
const MarketsIcon: IconFC = (p) => (
  <IconStroke {...p}>
    <path d="M3 17l6-6 4 4 8-9" />
    <path d="M14 6h7v7" />
  </IconStroke>
);
const BetsIcon: IconFC = (p) => (
  <IconStroke {...p}>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M14 6v12" strokeDasharray="2 2" />
  </IconStroke>
);

const TABS: { id: Tab; label: string; Icon: IconFC }[] = [
  { id: "markets", label: "Рынки", Icon: MarketsIcon },
  { id: "bets", label: "Мои ставки", Icon: BetsIcon },
];

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
    <div className="flex h-full flex-col">
      <main className="flex-1 overflow-y-scroll overscroll-y-none bg-[#0A0E16]">
        <div className="min-h-[calc(100%+96px)] bg-[#0A0E16]">
          <Hero balanceNano={me?.balance_nano ?? 0} />
          <div className="space-y-3 px-4 pb-32 pt-5">
            {error && (
              <div className="rounded-2xl bg-red-900/40 p-4 text-sm text-red-200">{error}</div>
            )}
            {loading && !me ? (
              <div className="py-10 text-center text-neutral-500">Загрузка…</div>
            ) : tab === "markets" ? (
              <MarketsView markets={markets} onBet={refresh} />
            ) : (
              <BetsView bets={bets} markets={markets} />
            )}
          </div>
        </div>
      </main>
      <BottomNav tab={tab} setTab={setTab} />
    </div>
  );
}

function Hero({ balanceNano }: { balanceNano: number }) {
  const u = window.Telegram?.WebApp?.initDataUnsafe?.user;
  const name = u?.first_name || u?.username || "Гость";
  const handle = u?.username ? `@${u.username}` : "";
  return (
    <div className="flex w-full flex-col bg-gradient-to-b from-[#5CCBFF] to-[#2E9BE6] pb-7 text-white">
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-2.5">
          <span className="grid h-[38px] w-[38px] place-items-center rounded-full bg-white/20 text-sm font-bold">
            {name[0]?.toUpperCase() || "?"}
          </span>
          <div className="text-left leading-tight">
            <div className="text-[11px] text-white/75">Добро пожаловать</div>
            <div className="text-sm font-semibold">{name}</div>
          </div>
        </div>
        {handle && <div className="text-[11px] text-white/70">{handle}</div>}
      </div>
      <div className="px-8 pt-3 text-center">
        <div className="text-sm font-medium text-white/85">Ваш баланс</div>
        <div className="mt-1 text-6xl font-extrabold tracking-tight tabular-nums">
          {fmtTon(balanceNano)}
        </div>
        <div className="mt-2 text-xs text-white/75">TON</div>
      </div>
    </div>
  );
}

function MarketsView({ markets, onBet }: { markets: Market[]; onBet: () => void }) {
  if (!markets.length) {
    return <div className="py-10 text-center text-neutral-500">Пока нет открытых рынков</div>;
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
      await api.placeBet(sel, Math.round(parseFloat(stake) * TON));
      notify("success");
      setMsg("Ставка принята ✓");
      setSel(null);
      onBet();
    } catch (e) {
      notify("error");
      setMsg(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] p-5">
      <div className="mb-3 text-base font-semibold">{market.title}</div>
      <div className="grid grid-cols-2 gap-2">
        {market.outcomes.map((o) => {
          const active = sel === o.id;
          return (
            <button
              key={o.id}
              onClick={() => setSel(active ? null : o.id)}
              className={
                "rounded-2xl px-3 py-2.5 text-left ring-inset transition " +
                (active
                  ? "bg-[#5CCBFF]/10 ring-2 ring-[#5CCBFF]"
                  : "bg-white/[0.03] ring-1 ring-white/[0.06]")
              }
            >
              <div className="text-sm text-neutral-200">{o.title}</div>
              <div className="font-semibold tabular-nums text-sky-300">{fmtOdds(o.odds_milli)}×</div>
            </button>
          );
        })}
      </div>
      {sel != null && (
        <div className="mt-3 flex items-center gap-2">
          <input
            value={stake}
            onChange={(e) => setStake(e.target.value)}
            inputMode="decimal"
            placeholder="Ставка, TON"
            className="flex-1 rounded-xl bg-white/[0.04] px-3 py-2.5 text-sm text-white outline-none ring-1 ring-inset ring-white/10 placeholder:text-neutral-500"
          />
          <button
            disabled={busy}
            onClick={place}
            className="rounded-xl bg-[#5CCBFF] px-4 py-2.5 text-sm font-semibold text-[#04243b] active:scale-95 disabled:opacity-50"
          >
            {busy ? "…" : "Поставить"}
          </button>
        </div>
      )}
      {msg && <div className="mt-2 text-sm text-neutral-300">{msg}</div>}
    </div>
  );
}

function BetsView({ bets, markets }: { bets: Bet[]; markets: Market[] }) {
  if (!bets.length) {
    return <div className="py-10 text-center text-neutral-500">Ставок пока нет</div>;
  }
  const title = (id: number) => markets.find((m) => m.id === id)?.title ?? `Рынок #${id}`;
  const cls = (s: string) =>
    s === "WON" ? "text-sky-300" : s === "LOST" ? "text-rose-400" : "text-neutral-400";
  return (
    <div className="space-y-2">
      {bets.map((b) => (
        <div
          key={b.id}
          className="flex items-center justify-between rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3.5"
        >
          <div className="min-w-0 pr-3">
            <div className="truncate text-sm">{title(b.market_id)}</div>
            <div className="mt-0.5 text-[11px] tabular-nums text-neutral-500">
              {fmtTon(b.stake_nano)} TON @ {fmtOdds(b.odds_milli)}× → {fmtTon(b.payout_nano)} TON
            </div>
          </div>
          <span className={"shrink-0 text-[11px] font-semibold " + cls(b.status)}>{b.status}</span>
        </div>
      ))}
    </div>
  );
}

function BottomNav({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const idx = TABS.findIndex((x) => x.id === tab);
  return (
    <nav
      className="fixed inset-x-0 z-40 flex justify-center px-5"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 10px)" }}
    >
      <div className="relative flex w-full max-w-sm rounded-[26px] border border-white/10 bg-[#11151C]/85 p-1.5 shadow-[0_12px_40px_-10px_rgba(0,0,0,0.8)] backdrop-blur-2xl">
        <span
          aria-hidden
          className="absolute bottom-1.5 left-1.5 top-1.5 rounded-[20px] bg-sky-400/15 transition-transform duration-300 ease-[cubic-bezier(0.34,1.4,0.64,1)]"
          style={{
            width: "calc((100% - 12px) / 2)",
            transform: `translateX(${idx * 100}%)`,
          }}
        />
        {TABS.map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className="relative z-10 flex flex-1 flex-col items-center gap-1 py-1.5"
            >
              <item.Icon
                className={
                  "h-[22px] w-[22px] transition-all duration-300 " +
                  (active ? "scale-110 text-sky-300" : "scale-100 text-neutral-500")
                }
              />
              <span
                className={
                  "text-[10px] font-medium tracking-wide transition-colors duration-300 " +
                  (active ? "text-sky-300" : "text-neutral-500")
                }
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
