import { useState } from "react";
import { type Bet } from "../realapi";
import { fmtTon } from "../format";
import { useT, type TKey, type TFunc } from "../i18n";
import BottomSheet from "./BottomSheet";
import TonIcon from "./TonIcon";

// Статус ставки → ключ перевода + классы бейджа (ярче, чем на карточке).
const STATUS: Record<string, { key: TKey; cls: string }> = {
  PLACED: { key: "bets.statusPlaced", cls: "bg-sky-400/20 text-sky-300" },
  WON: { key: "bets.statusWon", cls: "bg-emerald-400/20 text-emerald-300" },
  LOST: { key: "bets.statusLost", cls: "bg-rose-400/20 text-rose-300" },
  VOID: { key: "bets.statusVoid", cls: "bg-white/10 text-neutral-300" },
};

// Детали ставки: исход, кф, ставка/выигрыш/прибыль, время, «как резолвится» и
// превью события — всё, что есть на экране ставки, но для уже сделанной ставки.
export default function BetDetailModal({ open, onClose, bet }: { open: boolean; onClose: () => void; bet: Bet | null }) {
  const t = useT();
  if (!bet) return null;

  const odds = bet.odds_milli / 1000;
  const profit = (bet.payout_nano - bet.stake_nano) / 1e9;
  const st = STATUS[bet.status] ?? STATUS.PLACED;

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div>
        <div className="mb-4 flex items-center justify-between">
          <div className="text-lg font-bold">{t("bets.detailTitle")}</div>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="grid h-8 w-8 place-items-center rounded-full text-neutral-400 hover:bg-white/5"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {/* Рынок: картинка + тайтл + статус */}
        <div className="mb-4 flex items-start gap-3">
          {bet.image_url && (
            <img
              src={bet.image_url}
              alt=""
              className="h-12 w-12 shrink-0 rounded-xl bg-white/5 object-cover"
              onError={(e) => (e.currentTarget.style.display = "none")}
            />
          )}
          <div className="min-w-0 flex-1">
            <span className={"inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold " + st.cls}>
              {t(st.key)}
            </span>
            <div className="mt-1.5 text-sm font-semibold leading-snug text-white">{bet.market_title}</div>
          </div>
        </div>

        {/* Выбранный исход + кф — ярко */}
        <div className="mb-4 flex items-center justify-between rounded-2xl border border-sky-400/50 bg-gradient-to-r from-sky-500/25 to-blue-500/20 p-3.5 shadow-md shadow-sky-500/10">
          <span className="text-sm font-bold text-white">{bet.outcome_title}</span>
          <span className="tabular-nums text-sm font-bold text-sky-300">×{odds.toFixed(2)}</span>
        </div>

        {/* Цифры: ставка / к выигрышу / прибыль */}
        <div className="mb-4 grid grid-cols-3 gap-2">
          <Stat label={t("bets.stake")} value={`${fmtTon(bet.stake_nano / 1e9)}`} />
          <Stat label={t("bets.toWin")} value={`${fmtTon(bet.payout_nano / 1e9)}`} accent="text-emerald-400" />
          <Stat label={t("bets.profit")} value={`+${fmtTon(profit)}`} accent="text-emerald-400" />
        </div>

        {/* Время: поставлено + начало/закрытие */}
        <div className="mb-4 space-y-1.5 rounded-2xl bg-white/[0.03] px-3.5 py-2.5 text-xs">
          <Row label={t("bets.placedAt")} value={fmtDateTime(bet.placed_at)} />
          {bet.game_start_time ? (
            <Row label={t("bets.starts")} value={fmtDateTime(bet.game_start_time)} />
          ) : (
            bet.close_time && <Row label={t("bets.closes")} value={fmtDateTime(bet.close_time)} />
          )}
        </div>

        {/* Как резолвится + превью события */}
        {bet.description && (
          <div className="mb-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{t("bet.resolves")}</div>
            <ExpandableText text={bet.description} t={t} />
          </div>
        )}
        {bet.context_description && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{t("bet.preview")}</div>
            <ExpandableText text={bet.context_description} t={t} />
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.04] px-2 py-2.5 text-center">
      <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500">{label}</div>
      <div className={"flex items-center justify-center gap-1 text-sm font-bold tabular-nums " + (accent ?? "text-white")}>
        <TonIcon size={13} />
        {value}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-neutral-400">{label}</span>
      <span className="font-medium tabular-nums text-neutral-200">{value}</span>
    </div>
  );
}

// Текст с обрезкой до 3 строк и «Ещё/Свернуть» (только если длинный).
function ExpandableText({ text, t }: { text: string; t: TFunc }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 160;
  return (
    <>
      <p className={"whitespace-pre-line text-xs leading-relaxed text-neutral-300 " + (long && !open ? "line-clamp-3" : "")}>
        {text}
      </p>
      {long && (
        <button onClick={() => setOpen((o) => !o)} className="mt-1 text-[11px] font-semibold text-sky-300 hover:text-sky-200">
          {open ? t("bet.less") : t("bet.more")}
        </button>
      )}
    </>
  );
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
