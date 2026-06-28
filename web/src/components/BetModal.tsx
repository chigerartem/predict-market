import { useEffect, useState } from "react";
import { placeBet, type Market, type MarketOutcome } from "../realapi";
import { fmtTon } from "../format";
import { useT, type TFunc } from "../i18n";
import BottomSheet from "./BottomSheet";
import TonIcon from "./TonIcon";

// Минимальная ставка — зеркалит betting.MinStakeNano (0.1 TON) на бэке.
const MIN_STAKE_NANO = 100_000_000;
const PRESETS = [1, 5, 10, 50];

type Props = {
  open: boolean;
  onClose: () => void;
  market: Market | null;
  outcome: MarketOutcome | null;
  balanceTon: number;
  onSuccess: () => void;
};

export default function BetModal({ open, onClose, market, outcome, balanceTon, onSuccess }: Props) {
  const t = useT();
  const [stake, setStake] = useState("1");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (open) {
      setStake("1");
      setErr(null);
      setDone(false);
    }
  }, [open]);
  if (!open || !market || !outcome) return null;

  const stakeNum = Number(stake) || 0;
  const stakeNano = Math.round(stakeNum * 1_000_000_000);
  const odds = outcome.odds_milli / 1000;
  const payout = stakeNum * odds;
  const tooSmall = stakeNano < MIN_STAKE_NANO;
  const tooBig = stakeNum > balanceTon;
  const valid = !tooSmall && !tooBig;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await placeBet(outcome.id, stakeNano);
      setDone(true);
      onSuccess();
      window.setTimeout(onClose, 1200);
    } catch (e) {
      setErr(e instanceof Error && e.message ? e.message : t("bet.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div>
        <div className="mb-4 flex items-center justify-between">
          <div className="text-base font-semibold">{t("bet.title")}</div>
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

        {done ? (
          <div className="flex flex-col items-center py-6 text-center">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-green-600 text-3xl text-white shadow-lg shadow-emerald-500/40">
              ✓
            </span>
            <div className="mt-4 text-lg font-bold">{t("bet.success")}</div>
          </div>
        ) : (
          <>
            <p className="mb-3 text-sm leading-snug text-neutral-300">{market.title}</p>

            <div className="mb-4 rounded-2xl border border-sky-400/50 bg-gradient-to-r from-sky-500/25 to-blue-500/20 p-3.5 shadow-md shadow-sky-500/10">
              <span className="text-sm font-bold text-white">{outcome.title}</span>
            </div>

            <MarketInfo market={market} t={t} />

            <label className="mb-1.5 block text-xs font-medium text-neutral-400">{t("bet.amount")}</label>
            <div className="mb-2 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3.5">
              <TonIcon size={18} />
              <input
                inputMode="decimal"
                value={stake}
                onChange={(e) => setStake(e.target.value.replace(/[^\d.]/g, ""))}
                className="min-w-0 flex-1 bg-transparent py-3.5 text-base tabular-nums outline-none placeholder:text-neutral-600"
                placeholder="0.0"
              />
              <span className="text-sm font-medium text-neutral-500">TON</span>
              <button
                onClick={() => setStake(balanceTon > 0 ? String(Math.floor(balanceTon * 100) / 100) : "0")}
                className="rounded-lg bg-white/10 px-2.5 py-1 text-xs font-semibold text-sky-300 transition active:scale-95 hover:bg-white/15"
              >
                {t("wd.max")}
              </button>
            </div>

            <div className="mb-4 grid grid-cols-4 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => setStake(String(p))}
                  className="rounded-xl border border-white/10 bg-white/[0.04] py-2 text-sm font-semibold tabular-nums text-neutral-200 transition active:scale-95 hover:bg-white/[0.08]"
                >
                  {p}
                </button>
              ))}
            </div>

            <div className="mb-4 flex items-center justify-between rounded-2xl bg-white/[0.03] px-3.5 py-3 text-sm">
              <span className="text-neutral-400">{t("bet.payout")}</span>
              <span className="flex items-center gap-1.5 font-semibold tabular-nums text-emerald-400">
                <TonIcon size={16} />
                {fmtTon(payout)} TON
              </span>
            </div>

            <div className="mb-4 flex items-center justify-between px-1 text-xs text-neutral-500">
              <span>{t("bet.available")}</span>
              <span className="tabular-nums">{fmtTon(balanceTon)} TON</span>
            </div>

            {err && <p className="mb-3 text-center text-xs text-red-400">{err}</p>}
            {!err && tooBig && <p className="mb-3 text-center text-xs text-neutral-500">{t("bet.insufficient")}</p>}
            {!err && !tooBig && tooSmall && <p className="mb-3 text-center text-xs text-neutral-500">{t("bet.min")}</p>}

            <button
              onClick={submit}
              disabled={!valid || busy}
              className="w-full rounded-2xl bg-gradient-to-r from-sky-400 to-blue-600 py-3.5 text-sm font-bold text-white shadow-lg shadow-sky-500/30 transition active:scale-[0.99] enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              {busy ? t("bet.placing") : `${t("bet.place")} · ${fmtTon(stakeNum)} TON`}
            </button>
          </>
        )}
      </div>
    </BottomSheet>
  );
}

// Пояснение к рынку на экране ставки: время матча + «как резолвится» (description) +
// «превью» (context_description) — всё с Polymarket. Длинные тексты сворачиваются.
function MarketInfo({ market, t }: { market: Market; t: TFunc }) {
  if (!market.game_start_time && !market.description && !market.context_description) return null;
  return (
    <div className="mb-4 space-y-3">
      {market.game_start_time && (
        <div className="flex items-center gap-1.5 text-xs text-neutral-400">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          {fmtGameStart(market.game_start_time)}
        </div>
      )}
      {market.description && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{t("bet.resolves")}</div>
          <ExpandableText text={market.description} t={t} />
        </div>
      )}
      {market.context_description && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{t("bet.preview")}</div>
          <ExpandableText text={market.context_description} t={t} />
        </div>
      )}
    </div>
  );
}

// Текст с обрезкой до 3 строк и кнопкой «Ещё/Свернуть» (только если он длинный).
function ExpandableText({ text, t }: { text: string; t: TFunc }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 160;
  return (
    <>
      <p className={"whitespace-pre-line text-xs leading-relaxed text-neutral-300 " + (long && !open ? "line-clamp-3" : "")}>
        {text}
      </p>
      {long && (
        <button
          onClick={() => setOpen((o) => !o)}
          className="mt-1 text-[11px] font-semibold text-sky-300 hover:text-sky-200"
        >
          {open ? t("bet.less") : t("bet.more")}
        </button>
      )}
    </>
  );
}

function fmtGameStart(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
