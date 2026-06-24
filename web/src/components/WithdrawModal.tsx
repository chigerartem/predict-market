import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { fmtTon } from "../format";
import { useT } from "../i18n";
import TonIcon from "./TonIcon";

type Props = { open: boolean; onClose: () => void; balanceTon: string };

// Вывод баланса в TON. Реальная выплата (подпись/отправка транзакции) — на Go API
// позже; пока поля рабочие, но сабмит показывает превью-пометку «скоро».
export default function WithdrawModal({ open, onClose, balanceTon }: Props) {
  const t = useT();
  const [amount, setAmount] = useState("");
  const [address, setAddress] = useState("");
  useBodyScrollLock(open, "#0A0E16");
  useEffect(() => {
    if (open) {
      setAmount("");
      setAddress("");
    }
  }, [open]);
  if (!open) return null;

  const max = Number(balanceTon ?? 0);
  const amountNum = Number(amount);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0 && amountNum <= max;
  const canSubmit = amountValid && address.trim().length > 0;

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
          <div className="text-base font-semibold">{t("wd.title")}</div>
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

        {/* Доступно к выводу */}
        <div className="mb-4 flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
          <span className="text-sm text-neutral-400">{t("wd.available")}</span>
          <span className="flex items-center gap-1.5 text-sm font-semibold tabular-nums">
            <TonIcon size={18} />
            {fmtTon(balanceTon)} TON
          </span>
        </div>

        {/* Сумма */}
        <label className="mb-1.5 block text-xs font-medium text-neutral-400">{t("wd.amount")}</label>
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3.5">
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="0.00"
            className="min-w-0 flex-1 bg-transparent py-3.5 text-base tabular-nums outline-none placeholder:text-neutral-600"
          />
          <span className="text-sm font-medium text-neutral-500">TON</span>
          <button
            onClick={() => setAmount(max > 0 ? String(max) : "")}
            className="rounded-lg bg-white/10 px-2.5 py-1 text-xs font-semibold text-sky-300 transition active:scale-95 hover:bg-white/15"
          >
            {t("wd.max")}
          </button>
        </div>

        {/* Адрес */}
        <label className="mb-1.5 block text-xs font-medium text-neutral-400">{t("wd.address")}</label>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder={t("wd.addressPlaceholder")}
          className="mb-5 w-full rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-3.5 text-sm outline-none placeholder:text-neutral-600"
        />

        <button
          disabled={!canSubmit}
          className="w-full rounded-2xl bg-sky-500 py-3.5 text-sm font-semibold text-white transition active:scale-[0.99] enabled:hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("wd.submit")}
        </button>
        <p className="mt-3 text-center text-xs text-neutral-500">{t("wd.soon")}</p>
      </div>
    </div>,
    document.body,
  );
}
