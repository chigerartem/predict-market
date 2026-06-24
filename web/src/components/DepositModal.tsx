import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { useT, type TKey } from "../i18n";
import TonIcon from "./TonIcon";

type Method = "gifts" | "ton" | "stars";
type Props = { open: boolean; onClose: () => void };

const METHODS: { id: Method; emoji: ReactNode; title: TKey; desc: TKey }[] = [
  { id: "gifts", emoji: "🎁", title: "dep.gifts", desc: "dep.giftsDesc" },
  { id: "ton", emoji: <TonIcon size={28} />, title: "dep.ton", desc: "dep.tonDesc" },
  { id: "stars", emoji: "⭐", title: "dep.stars", desc: "dep.starsDesc" },
];

// Пополнение баланса (TON) тремя способами: подарки, TON-кошелёк, Telegram Stars.
// Реальные интеграции (приём подарка, TON Connect, Stars invoice) подключим к Go
// API позже — пока выбор способа показывает каркас-заглушку «скоро».
export default function DepositModal({ open, onClose }: Props) {
  const t = useT();
  const [method, setMethod] = useState<Method | null>(null);
  // Лист тёмный поверх затемнения → красим native-шапку Telegram в тёмный.
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
