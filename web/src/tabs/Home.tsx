import { useCallback, useEffect, useMemo, useState } from "react";
import type { MeResponse } from "../api";
import { fetchMarkets, fetchMe, type Market, type MarketOutcome } from "../realapi";
import { fmtTon } from "../format";
import { useT } from "../i18n";
import TonIcon from "../components/TonIcon";
import DepositModal from "../components/DepositModal";
import WithdrawModal from "../components/WithdrawModal";
import BetModal from "../components/BetModal";

type Props = {
  me: MeResponse;
  onReload: () => void;
  onOpenReferral: () => void;
};

// Категории фильтра — совпадают с тем, что проставляет бэкенд (polymarket.categorize).
const FILTERS = [
  { key: "all", label: "Все" },
  { key: "sports", label: "Спорт" },
  { key: "politics", label: "Политика" },
  { key: "crypto", label: "Крипто" },
  { key: "economy", label: "Экономика" },
  { key: "other", label: "Прочее" },
];

const CATEGORY_LABEL: Record<string, string> = {
  sports: "Спорт",
  politics: "Политика",
  crypto: "Крипто",
  economy: "Экономика",
  tech: "Технологии",
  other: "Прочее",
};

// Главная prediction-маркета: компактный голубой герой (реальный баланс в TON +
// Пополнить/Вывести), под ним — лента рынков с фильтром по категории и поиском.
export default function Home(_props: Props) {
  const t = useT();
  const [deposit, setDeposit] = useState(false);
  const [withdraw, setWithdraw] = useState(false);
  const [bet, setBet] = useState<{ market: Market; outcome: MarketOutcome } | null>(null);
  const [cat, setCat] = useState("all");
  const [search, setSearch] = useState("");

  // Реальный баланс из /api/me (наноTON). Обновляется после успешного депозита.
  const [balanceNano, setBalanceNano] = useState<number | null>(null);
  const loadBalance = useCallback(() => {
    fetchMe()
      .then((m) => setBalanceNano(m.balance_nano))
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadBalance();
  }, [loadBalance]);

  const [markets, setMarkets] = useState<Market[] | null>(null);
  useEffect(() => {
    fetchMarkets()
      .then(setMarkets)
      .catch(() => setMarkets([]));
  }, []);

  const balanceTon = (balanceNano ?? 0) / 1_000_000_000;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Поиск ищет конкретное событие по всей ленте (игнорируя выбранную категорию);
    // без поиска — обычный фильтр по категории.
    return (markets ?? []).filter((m) => {
      if (q) return m.title.toLowerCase().includes(q);
      return cat === "all" || (m.category || "other") === cat;
    });
  }, [markets, cat, search]);

  return (
    <div>
      <div className="flex w-full flex-col items-center bg-gradient-to-b from-[#5CCBFF] to-[#2E9BE6] px-6 pb-6 pt-8 text-center text-white">
        <div className="text-[13px] font-medium text-white/85">{t("home.yourBalance")}</div>

        <div className="mt-1.5 flex items-end justify-center gap-2">
          <TonIcon size={30} className="mb-1" />
          <span className="text-[2.5rem] font-semibold leading-none tracking-tight tabular-nums">
            {fmtTon(balanceTon)}
          </span>
          <span className="mb-1 text-sm font-medium text-white/70">TON</span>
        </div>

        <div className="mt-5 flex w-full max-w-xs items-center gap-3">
          <button
            onClick={() => setDeposit(true)}
            className="flex-1 rounded-2xl bg-white py-2.5 text-sm font-semibold text-[#1E9BE6] shadow-sm transition active:scale-[0.98]"
          >
            {t("home.deposit")}
          </button>
          <button
            onClick={() => setWithdraw(true)}
            className="flex-1 rounded-2xl border border-white/60 bg-white/10 py-2.5 text-sm font-semibold text-white transition active:scale-[0.98]"
          >
            {t("home.withdraw")}
          </button>
        </div>
      </div>

      <div className="px-4 pb-28 pt-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => setViewportColor("#0A0E16")}
          onBlur={() => setViewportColor("#5CCBFF")}
          placeholder={t("home.search")}
          className="mb-3 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-neutral-500"
        />

        <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setCat(f.key)}
              className={
                "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition active:scale-95 " +
                (cat === f.key
                  ? "bg-sky-500 text-white"
                  : "bg-white/[0.06] text-neutral-300 hover:bg-white/10")
              }
            >
              {f.label}
            </button>
          ))}
        </div>

        {markets === null ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl bg-white/5" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-neutral-400">
            {markets.length === 0 ? t("home.noEvents") : t("home.noResults")}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((m) => (
              <MarketCard
                key={m.id}
                market={m}
                onPick={(market, outcome) => setBet({ market, outcome })}
              />
            ))}
          </div>
        )}
      </div>

      <DepositModal open={deposit} onClose={() => setDeposit(false)} onSuccess={loadBalance} />
      <WithdrawModal open={withdraw} onClose={() => setWithdraw(false)} balanceTon={String(balanceTon)} />
      <BetModal
        open={!!bet}
        onClose={() => setBet(null)}
        market={bet?.market ?? null}
        outcome={bet?.outcome ?? null}
        balanceTon={balanceTon}
        onSuccess={loadBalance}
      />
    </div>
  );
}

function MarketCard({
  market,
  onPick,
}: {
  market: Market;
  onPick: (market: Market, outcome: MarketOutcome) => void;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#11151C] p-3.5">
      <div className="mb-2.5 flex items-center gap-2 text-[11px] text-neutral-500">
        {market.category && (
          <span className="rounded-md bg-white/5 px-2 py-0.5 font-medium text-neutral-300">
            {CATEGORY_LABEL[market.category] ?? market.category}
          </span>
        )}
        {market.close_time && <span>до {fmtDate(market.close_time)}</span>}
      </div>

      <div className="mb-3 text-sm font-semibold leading-snug text-white">{market.title}</div>

      <div className="flex gap-2">
        {market.outcomes.map((o) => (
          <button
            key={o.id}
            onClick={() => onPick(market, o)}
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left transition active:scale-[0.98] hover:bg-white/[0.08]"
          >
            <div className="truncate text-xs text-neutral-400">{o.title}</div>
            <div className="text-sm font-semibold tabular-nums text-sky-300">
              {(o.odds_milli / 1000).toFixed(2)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

// Красит фон viewport Telegram (виден под полупрозрачной клавиатурой и при
// overscroll). На фокус поиска — тёмный, иначе под клавиатурой проступает голубой
// фон главной; на blur возвращаем голубой (как красит App для вкладки home).
function setViewportColor(color: string) {
  try {
    window.Telegram?.WebApp?.setBackgroundColor?.(color);
  } catch {
    /* старый клиент без setBackgroundColor */
  }
}
