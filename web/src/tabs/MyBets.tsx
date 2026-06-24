import { useEffect, useState } from "react";
import { fetchMyBets, type Bet } from "../realapi";
import { fmtTon } from "../format";
import { useT, type TKey } from "../i18n";
import TonIcon from "../components/TonIcon";

// Статус ставки → ключ перевода + классы бейджа.
const STATUS: Record<string, { key: TKey; cls: string }> = {
  PLACED: { key: "bets.statusPlaced", cls: "bg-sky-400/15 text-sky-300" },
  WON: { key: "bets.statusWon", cls: "bg-emerald-400/15 text-emerald-400" },
  LOST: { key: "bets.statusLost", cls: "bg-red-400/15 text-red-400" },
  VOID: { key: "bets.statusVoid", cls: "bg-white/10 text-neutral-400" },
};

// Раздел «Мои ставки»: ставки юзера (любого статуса), в т.ч. на рынках, ушедших из
// общей ленты по объёму — здесь участник всё равно видит своё событие до резолва.
export default function MyBets({ active }: { active: boolean }) {
  const t = useT();
  const [bets, setBets] = useState<Bet[] | null>(null);

  // Перезагружаем при каждом открытии вкладки — статусы могли измениться (расчёт).
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetchMyBets()
      .then((b) => !cancelled && setBets(b))
      .catch(() => !cancelled && setBets([]));
    return () => {
      cancelled = true;
    };
  }, [active]);

  return (
    <div>
      <div className="bg-gradient-to-b from-[#5CCBFF] to-[#2E9BE6] px-5 pb-6 pt-9 text-center text-white">
        <div className="text-lg font-semibold">{t("bets.title")}</div>
      </div>

      <div className="px-4 pb-28 pt-4">
        {bets === null ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-white/5" />
            ))}
          </div>
        ) : bets.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
            <div className="text-sm font-medium text-neutral-300">{t("bets.empty")}</div>
            <div className="mt-1 text-xs text-neutral-500">{t("bets.emptyHint")}</div>
          </div>
        ) : (
          <div className="space-y-3">
            {bets.map((b) => (
              <BetRow key={b.id} bet={b} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BetRow({ bet }: { bet: Bet }) {
  const t = useT();
  const st = STATUS[bet.status] ?? STATUS.PLACED;
  const odds = bet.odds_milli / 1000;

  return (
    <div className="rounded-2xl border border-white/10 bg-[#11151C] p-3.5">
      <div className="mb-2 flex items-center justify-between">
        <span className={"rounded-md px-2 py-0.5 text-[11px] font-semibold " + st.cls}>
          {t(st.key)}
        </span>
        <span className="text-[11px] text-neutral-500">{fmtDate(bet.placed_at)}</span>
      </div>

      <div className="mb-1 text-sm font-semibold leading-snug text-white">{bet.market_title}</div>
      <div className="mb-3 text-xs text-neutral-400">
        {bet.outcome_title} · <span className="tabular-nums text-sky-300">{odds.toFixed(2)}</span>
      </div>

      <div className="flex items-center justify-between border-t border-white/5 pt-2.5 text-xs">
        <span className="text-neutral-400">
          {t("bets.stake")}:{" "}
          <span className="font-medium tabular-nums text-neutral-200">{fmtTon(bet.stake_nano / 1e9)} TON</span>
        </span>
        <span className="flex items-center gap-1 text-neutral-400">
          {t("bets.toWin")}:{" "}
          <span className="flex items-center gap-1 font-semibold tabular-nums text-emerald-400">
            <TonIcon size={13} />
            {fmtTon(bet.payout_nano / 1e9)}
          </span>
        </span>
      </div>
    </div>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}
