import { useEffect, useState } from "react";
import type { MeResponse } from "../api";
import { fetchMarkets, type Market } from "../realapi";
import { fmtTon } from "../format";
import { useT } from "../i18n";
import TonIcon from "../components/TonIcon";
import DepositModal from "../components/DepositModal";
import WithdrawModal from "../components/WithdrawModal";

type Props = {
  me: MeResponse;
  onReload: () => void;
  onOpenReferral: () => void;
};

// Главная prediction-маркета: компактный голубой герой (баланс в TON +
// Пополнить/Вывести), под ним — лента рынков (событий).
export default function Home({ me }: Props) {
  const t = useT();
  const [deposit, setDeposit] = useState(false);
  const [withdraw, setWithdraw] = useState(false);
  const balance = me.ton_balance ?? "0";

  const [markets, setMarkets] = useState<Market[] | null>(null);
  useEffect(() => {
    fetchMarkets()
      .then(setMarkets)
      .catch(() => setMarkets([]));
  }, []);

  return (
    <div>
      <div className="flex w-full flex-col items-center bg-gradient-to-b from-[#5CCBFF] to-[#2E9BE6] px-6 pb-6 pt-8 text-center text-white">
        <div className="text-[13px] font-medium text-white/85">{t("home.yourBalance")}</div>

        <div className="mt-1.5 flex items-end justify-center gap-2">
          <TonIcon size={30} className="mb-1" />
          <span className="text-[2.5rem] font-semibold leading-none tracking-tight tabular-nums">
            {fmtTon(balance)}
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
        <div className="mb-3 px-1 text-sm font-semibold text-neutral-300">{t("home.events")}</div>
        {markets === null ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl bg-white/5" />
            ))}
          </div>
        ) : markets.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-neutral-400">
            {t("home.noEvents")}
          </div>
        ) : (
          <div className="space-y-3">
            {markets.map((m) => (
              <MarketCard key={m.id} market={m} />
            ))}
          </div>
        )}
      </div>

      <DepositModal open={deposit} onClose={() => setDeposit(false)} />
      <WithdrawModal open={withdraw} onClose={() => setWithdraw(false)} balanceTon={balance} />
    </div>
  );
}

const CATEGORY_LABEL: Record<string, string> = {
  sports: "Спорт",
  crypto: "Крипто",
  tech: "Технологии",
};

function MarketCard({ market }: { market: Market }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#11151C] p-3.5">
      <div className="mb-2.5 flex items-center gap-2 text-[11px] text-neutral-500">
        <span className="rounded-md bg-white/5 px-2 py-0.5 font-medium text-neutral-300">
          {CATEGORY_LABEL[market.category] ?? market.category}
        </span>
        {market.close_time && <span>· до {fmtDate(market.close_time)}</span>}
      </div>

      <div className="mb-3 text-sm font-semibold leading-snug text-white">{market.title}</div>

      <div className="flex gap-2">
        {market.outcomes.map((o) => (
          <button
            key={o.id}
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
