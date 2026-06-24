import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { createStarsInvoice, fetchStarsQuote } from "../realapi";
import { useT, type TKey, type TFunc } from "../i18n";
import TonIcon from "./TonIcon";

type Method = "gifts" | "ton" | "stars";
type Props = { open: boolean; onClose: () => void; onSuccess?: () => void };

const METHODS: { id: Method; emoji: ReactNode; title: TKey; desc: TKey }[] = [
  { id: "gifts", emoji: "🎁", title: "dep.gifts", desc: "dep.giftsDesc" },
  { id: "ton", emoji: <TonIcon size={28} />, title: "dep.ton", desc: "dep.tonDesc" },
  { id: "stars", emoji: "⭐", title: "dep.stars", desc: "dep.starsDesc" },
];

const MIN_STARS = 50;
const PRESETS = [100, 250, 500, 1000];

// Пополнение баланса (TON). Stars — рабочий путь (инвойс → openInvoice → кредит на
// webhook); TON и подарки пока заглушка «скоро».
export default function DepositModal({ open, onClose, onSuccess }: Props) {
  const t = useT();
  const [method, setMethod] = useState<Method | null>(null);
  useBodyScrollLock(open, "#0A0E16");
  useEffect(() => {
    if (open) setMethod(null);
  }, [open]);
  if (!open) return null;

  const active = METHODS.find((m) => m.id === method);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-full w-full max-w-md overflow-y-auto rounded-t-3xl bg-neutral-900 p-5 pb-8 text-white sm:mb-4 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <div className="text-base font-semibold">{t("dep.title")}</div>
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

        {!active ? (
          <>
            <p className="mb-4 text-sm text-neutral-400">{t("dep.subtitle")}</p>
            <div className="space-y-2.5">
              {METHODS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMethod(m.id)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 text-left transition active:scale-[0.99] hover:bg-white/[0.06]"
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/5 text-2xl">
                    {m.emoji}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{t(m.title)}</span>
                    <span className="block text-xs text-neutral-400">{t(m.desc)}</span>
                  </span>
                  <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-neutral-500" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
              ))}
            </div>
          </>
        ) : active.id === "stars" ? (
          <StarsDeposit t={t} onBack={() => setMethod(null)} onClose={onClose} onSuccess={onSuccess} />
        ) : (
          <div className="flex flex-col items-center pb-2 pt-3 text-center">
            <span className="grid h-20 w-20 place-items-center rounded-full bg-white/5 text-4xl">
              {active.emoji}
            </span>
            <div className="mt-4 text-lg font-semibold">{t(active.title)}</div>
            <p className="mt-2 max-w-xs text-sm text-neutral-400">{t("dep.gettingReady")}</p>
            <button
              onClick={() => setMethod(null)}
              className="mt-6 rounded-2xl border border-white/15 bg-white/5 px-6 py-3 text-sm font-semibold transition active:scale-[0.98] hover:bg-white/10"
            >
              {t("common.back")}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function StarsDeposit({
  t,
  onBack,
  onClose,
  onSuccess,
}: {
  t: TFunc;
  onBack: () => void;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const [stars, setStars] = useState(500);
  const [tonNano, setTonNano] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valid = stars >= MIN_STARS;

  // Живой эквивалент в TON с бэка (курс динамический), с debounce на ручной ввод.
  useEffect(() => {
    if (!valid) {
      setTonNano(null);
      return;
    }
    let cancelled = false;
    const id = setTimeout(() => {
      fetchStarsQuote(stars)
        .then((nano) => {
          if (!cancelled) setTonNano(nano);
        })
        .catch(() => {
          if (!cancelled) setTonNano(null);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [stars, valid]);

  const tonEq = tonNano !== null ? (tonNano / 1_000_000_000).toFixed(2) : "…";

  const pay = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const link = await createStarsInvoice(stars);
      const tg = window.Telegram?.WebApp;
      if (tg?.openInvoice) {
        tg.openInvoice(link, (status) => {
          if (status === "paid") {
            onSuccess?.();
            onClose();
          }
        });
      } else {
        // Вне Telegram (или старый клиент) — открываем счёт ссылкой.
        window.open(link, "_blank");
      }
    } catch {
      setErr(t("dep.payError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pt-1">
      <button
        onClick={onBack}
        className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-200"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        {t("common.back")}
      </button>

      <label className="mb-2 block text-xs font-medium text-neutral-400">{t("dep.starsAmount")}</label>
      <div className="mb-3 grid grid-cols-4 gap-2">
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => setStars(p)}
            className={
              "rounded-xl border py-2 text-sm font-semibold tabular-nums transition active:scale-95 " +
              (stars === p
                ? "border-sky-400 bg-sky-400/15 text-sky-300"
                : "border-white/10 bg-white/[0.04] text-neutral-200 hover:bg-white/[0.08]")
            }
          >
            {p}
          </button>
        ))}
      </div>

      <div className="mb-4 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3.5">
        <span className="text-lg">⭐</span>
        <input
          inputMode="numeric"
          value={stars}
          onChange={(e) => setStars(Math.max(0, Math.floor(Number(e.target.value.replace(/\D/g, "")) || 0)))}
          className="min-w-0 flex-1 bg-transparent py-3.5 text-base tabular-nums outline-none placeholder:text-neutral-600"
        />
        <span className="flex items-center gap-1.5 text-sm font-medium text-neutral-400">
          <TonIcon size={16} />≈ {tonEq} TON
        </span>
      </div>

      {err && <p className="mb-3 text-center text-xs text-red-400">{err}</p>}
      {!valid && <p className="mb-3 text-center text-xs text-neutral-500">{t("dep.minStars")}</p>}

      <button
        onClick={pay}
        disabled={!valid || busy}
        className="w-full rounded-2xl bg-sky-500 py-3.5 text-sm font-semibold text-white transition active:scale-[0.99] enabled:hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? t("dep.processing") : `${t("dep.pay")} ${stars} ⭐`}
      </button>
    </div>
  );
}
