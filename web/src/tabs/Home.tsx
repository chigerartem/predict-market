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
};

// Категории фильтра — совпадают с тем, что проставляет бэкенд (polymarket.categorize).
// Лента делится по категориям, сводной вкладки «Все» нет (решение Артёма): всё,
// что не попало в спорт/политику/крипто/экономику, живёт в «Прочее». Дефолт — Спорт.
const FILTERS = [
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

// Цветной пилл категории — чтобы лента не была серой (casino-вайб): свой цвет на
// категорию.
const CATEGORY_PILL: Record<string, string> = {
  sports: "bg-emerald-500/20 text-emerald-300",
  politics: "bg-rose-500/20 text-rose-300",
  crypto: "bg-amber-500/20 text-amber-300",
  economy: "bg-sky-500/20 text-sky-300",
  tech: "bg-violet-500/20 text-violet-300",
  other: "bg-white/10 text-neutral-300",
};

// Кэш ленты рынков в localStorage: при переоткрытии Mini App (а он часто
// перезагружается — например после возврата из TON Connect) показываем прошлую
// ленту мгновенно, затем тихо обновляем свежими данными. Лента небольшая (~60
// рынков) и запрос быстрый — кэш нужен ради мгновенного первого кадра.
const MARKETS_CACHE_KEY = "predict_markets_v1";
function loadCachedMarkets(): Market[] | null {
  try {
    const raw = localStorage.getItem(MARKETS_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Market[]) : null;
  } catch {
    return null;
  }
}

// Главная prediction-маркета: компактный голубой герой (реальный баланс в TON +
// Пополнить/Вывести), под ним — лента рынков с фильтром по категории и поиском.
export default function Home(_props: Props) {
  const t = useT();
  const [deposit, setDeposit] = useState(false);
  const [withdraw, setWithdraw] = useState(false);
  const [bet, setBet] = useState<{ market: Market; outcome: MarketOutcome } | null>(null);
  const [cat, setCat] = useState("sports");
  const [search, setSearch] = useState("");

  // Реальный баланс из /api/me (наноTON) + конфиг вывода (мин/комиссия/доступность).
  // Обновляется после успешного депозита и после вывода (баланс уже задебечен).
  const [balanceNano, setBalanceNano] = useState<number | null>(null);
  const [wd, setWd] = useState({ enabled: false, minNano: 0, feeNano: 0 });
  const loadBalance = useCallback(() => {
    fetchMe()
      .then((m) => {
        setBalanceNano(m.balance_nano);
        setWd({ enabled: m.withdraw_enabled, minNano: m.min_withdraw_nano, feeNano: m.withdraw_fee_nano });
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadBalance();
  }, [loadBalance]);

  // Старт из кэша → лента видна сразу; затем тихо обновляем (stale-while-revalidate).
  const [markets, setMarkets] = useState<Market[] | null>(() => loadCachedMarkets());
  useEffect(() => {
    fetchMarkets()
      .then((ms) => {
        setMarkets(ms);
        try {
          localStorage.setItem(MARKETS_CACHE_KEY, JSON.stringify(ms));
        } catch {
          /* localStorage недоступен/переполнен — некритично */
        }
      })
      // Сбой обновления не стираем кэш: если данных не было вовсе — показываем пусто.
      .catch(() => setMarkets((prev) => prev ?? []));
  }, []);

  const balanceTon = (balanceNano ?? 0) / 1_000_000_000;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Поиск ищет конкретное событие по всей ленте (игнорируя выбранную категорию);
    // без поиска — фильтр по выбранной категории.
    return (markets ?? []).filter((m) =>
      q ? m.title.toLowerCase().includes(q) : (m.category || "other") === cat,
    );
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
                  ? "bg-gradient-to-r from-sky-400 to-blue-600 text-white shadow-md shadow-sky-500/30"
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
      <WithdrawModal
        open={withdraw}
        onClose={() => setWithdraw(false)}
        balanceNano={balanceNano ?? 0}
        minNano={wd.minNano}
        feeNano={wd.feeNano}
        enabled={wd.enabled}
        onSuccess={loadBalance}
      />
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
      <div className="mb-3 flex items-start gap-3">
        {market.image_url && (
          <img
            src={market.image_url}
            alt=""
            loading="lazy"
            className="h-11 w-11 shrink-0 rounded-lg bg-white/5 object-cover"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-2 text-[11px] text-neutral-500">
            {market.category && (
              <span className={"rounded-md px-2 py-0.5 font-semibold " + (CATEGORY_PILL[market.category] ?? "bg-white/10 text-neutral-300")}>
                {CATEGORY_LABEL[market.category] ?? market.category}
              </span>
            )}
            {market.game_start_time ? (
              <span>{fmtDateTime(market.game_start_time)}</span>
            ) : (
              market.close_time && <span>до {fmtDate(market.close_time)}</span>
            )}
          </div>
          <div className="text-sm font-semibold leading-snug text-white">{market.title}</div>
        </div>
      </div>

      <div className="flex gap-2">
        {market.outcomes.map((o) => (
          <button
            key={o.id}
            onClick={() => onPick(market, o)}
            className="min-w-0 flex-1 rounded-xl border border-sky-400/25 bg-sky-500/[0.07] px-3 py-2.5 text-left transition active:scale-[0.97] hover:border-sky-400/50 hover:bg-sky-500/[0.14]"
          >
            <div className="truncate text-xs text-neutral-300">{o.title}</div>
            <div className="text-base font-bold tabular-nums text-sky-300">
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

// Дата + время — для времени начала матча (game_start_time) на карточке.
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

