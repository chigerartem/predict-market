import { useEffect, useState } from "react";
import { fetchMyBets, type Bet } from "../realapi";
import { fmtTon } from "../format";
import { useT, type TKey } from "../i18n";
import BetDetailModal from "../components/BetDetailModal";
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
  const [selected, setSelected] = useState<Bet | null>(null);

  // Грузим при монтировании (вкладка смонтирована сразу при старте → данные готовы
  // ещё до захода) И перезагружаем при каждом открытии — статусы могли измениться
  // (расчёт). Деп [active] даёт фетч на маунте + рефреш при открытии вкладки.
  useEffect(() => {
    let cancelled = false;
    fetchMyBets()
      .then((b) => !cancelled && setBets(b))
      .catch(() => !cancelled && setBets([]));
    return () => {
      cancelled = true;
    };
  }, [active]);

  const stats = computeStats(bets);

  return (
    <div>
      <div className="bg-gradient-to-b from-[#5CCBFF] to-[#2E9BE6] px-5 pb-5 pt-9 text-white">
        <div className="text-center text-lg font-semibold">{t("bets.title")}</div>
        <div className="mt-4 grid grid-cols-3 gap-2.5">
          <StatTile label={t("bets.statActive")} value={stats ? String(stats.active) : "—"} />
          <StatTile label={t("bets.statInPlay")} value={stats ? fmtTon(stats.inPlay) : "—"} ton />
          <StatTile label={t("bets.statPnl")} value={stats ? fmtSigned(stats.pnl) : "—"} ton />
        </div>
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
              <BetRow key={b.id} bet={b} onOpen={() => setSelected(b)} />
            ))}
          </div>
        )}
      </div>

      <BetDetailModal open={!!selected} onClose={() => setSelected(null)} bet={selected} />
    </div>
  );
}

// Сводка по ставкам игрока для шапки. null пока ставки грузятся.
//   active — число активных (PLACED)
//   inPlay — сумма ставок в игре (TON), что сейчас «крутится»
//   pnl    — реализованный P&L (TON): по выигравшим (выплата − ставка),
//            по проигравшим (− ставка); возвраты (VOID) нейтральны
function computeStats(bets: Bet[] | null) {
  if (!bets) return null;
  let active = 0;
  let inPlayNano = 0;
  let pnlNano = 0;
  for (const b of bets) {
    switch (b.status) {
      case "PLACED":
        active++;
        inPlayNano += b.stake_nano;
        break;
      case "WON":
        pnlNano += b.payout_nano - b.stake_nano;
        break;
      case "LOST":
        pnlNano -= b.stake_nano;
        break;
    }
  }
  return { active, inPlay: inPlayNano / 1e9, pnl: pnlNano / 1e9 };
}

function fmtSigned(ton: number): string {
  const s = fmtTon(Math.abs(ton));
  if (ton > 0) return "+" + s;
  if (ton < 0) return "−" + s;
  return s;
}

function StatTile({ label, value, ton }: { label: string; value: string; ton?: boolean }) {
  return (
    <div className="rounded-2xl bg-white/15 px-2 py-2.5 text-center backdrop-blur-sm">
      <div className="flex items-center justify-center gap-1 text-[17px] font-bold leading-none tabular-nums">
        {ton && <TonIcon size={13} />}
        {value}
      </div>
      <div className="mt-1 text-[11px] font-medium text-white/75">{label}</div>
    </div>
  );
}

function BetRow({ bet, onOpen }: { bet: Bet; onOpen: () => void }) {
  const t = useT();
  const st = STATUS[bet.status] ?? STATUS.PLACED;
  const odds = bet.odds_milli / 1000;

  return (
    <button
      onClick={onOpen}
      className="w-full rounded-2xl border border-white/10 bg-[#11151C] p-3.5 text-left transition active:scale-[0.99] hover:border-white/20 hover:bg-[#151a23]"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className={"rounded-md px-2 py-0.5 text-[11px] font-semibold " + st.cls}>
          {t(st.key)}
        </span>
        <span className="flex items-center gap-1 text-[11px] text-neutral-500">
          {fmtDate(bet.placed_at)}
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-neutral-600" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </span>
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
    </button>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}
