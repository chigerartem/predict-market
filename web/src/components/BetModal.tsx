import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { placeBet, type Market, type MarketOutcome } from "../realapi";
import { fmtTon } from "../format";
import { useT } from "../i18n";
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

  useBodyScrollLock(open, "#0A0E16");
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

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-full w-full max-w-md overflow-y-auto rounded-t-3xl bg-neutral-900 p-5 pb-8 text-white sm:mb-4 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
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
            <span className="grid h-16 w-16 place-items-center rounded-full bg-emerald-500/15 text-3xl text-emerald-400">
              ✓
            </span>
            <div className="mt-4 text-lg font-semibold">{t("bet.success")}</div>
          </div>
        ) : (
          <>
            <p className="mb-3 text-sm leading-snug text-neutral-300">{market.title}</p>

            <div className="mb-4 flex items-center justify-between rounded-2xl border border-sky-400/40 bg-sky-400/10 p-3.5">
              <span className="text-sm font-semibold text-white">{outcome.title}</span>
              <span className="text-base font-bold tabular-nums text-sky-300">{odds.toFixed(2)}</span>
            </div>

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
              className="w-full rounded-2xl bg-sky-500 py-3.5 text-sm font-semibold text-white transition active:scale-[0.99] enabled:hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? t("bet.placing") : `${t("bet.place")} · ${fmtTon(stakeNum)} TON`}
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
