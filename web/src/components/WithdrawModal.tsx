import { useEffect, useMemo, useState, type ReactNode } from "react";
import { fmtTon } from "../format";
import { useT, type TKey, type TFunc } from "../i18n";
import { requestWithdraw } from "../realapi";
import BottomSheet from "./BottomSheet";
import Lottie from "./Lottie";
import TonIcon from "./TonIcon";

type Props = {
  open: boolean;
  onClose: () => void;
  balanceNano: number;
  minNano: number;
  feeNano: number;
  enabled: boolean;
  onSuccess: () => void;
};

const NANO = 1_000_000_000;

type WMethod = "ton" | "gifts";

// Способы вывода — цветные карточки, как методы на депозите. TON работает (перевод
// на кошелёк); «Подарок» — обмен TON на выбранный подарок (каталог на бэке, пока
// «скоро»). Звёзды отдельным способом нельзя: Bot API не умеет начислять звёзды
// юзеру — это тот же подарочный путь.
const METHODS: { id: WMethod; emoji: ReactNode; title: TKey; desc: TKey; tint: string }[] = [
  {
    id: "ton",
    emoji: <TonIcon size={34} />,
    title: "wd.methTon",
    desc: "wd.methTonDesc",
    tint: "bg-gradient-to-br from-[#41b6ff] to-[#1a6bf0] shadow-sky-600/40",
  },
  {
    id: "gifts",
    emoji: <Lottie src="/lottie/gift.json" className="h-full w-full" />,
    title: "wd.methGifts",
    desc: "wd.methGiftsDesc",
    tint: "bg-gradient-to-br from-[#ff4d94] to-[#b521d6] shadow-pink-600/40",
  },
];

export default function WithdrawModal({ open, onClose, balanceNano, minNano, feeNano, enabled, onSuccess }: Props) {
  const t = useT();
  const [method, setMethod] = useState<WMethod | null>(null);
  useEffect(() => {
    if (open) setMethod(null);
  }, [open]);

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div>
        <div className="mb-4 flex items-center justify-between">
          <div className="text-lg font-bold">{t("wd.title")}</div>
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

        {method === null ? (
          <>
            <p className="mb-4 text-sm text-neutral-300">{t("wd.subtitle")}</p>
            <div className="space-y-3">
              {METHODS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMethod(m.id)}
                  className={
                    "flex w-full items-center gap-3 rounded-2xl p-4 text-left text-white shadow-lg transition active:scale-[0.98] " +
                    m.tint
                  }
                >
                  <span className="grid h-12 w-12 shrink-0 place-items-center text-3xl drop-shadow-md">{m.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-bold drop-shadow-sm">{t(m.title)}</span>
                    <span className="block text-xs font-medium text-white/85">{t(m.desc)}</span>
                  </span>
                  <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-white/80" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
              ))}
            </div>
          </>
        ) : method === "ton" ? (
          <TonWithdraw
            t={t}
            onBack={() => setMethod(null)}
            onClose={onClose}
            balanceNano={balanceNano}
            minNano={minNano}
            feeNano={feeNano}
            enabled={enabled}
            onSuccess={onSuccess}
          />
        ) : (
          <ComingSoon t={t} title="wd.methGifts" onBack={() => setMethod(null)} />
        )}
      </div>
    </BottomSheet>
  );
}

// Кнопка «назад» к выбору способа — общая для под-экранов.
function BackButton({ t, onBack }: { t: TFunc; onBack: () => void }) {
  return (
    <button
      onClick={onBack}
      className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-200"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 6l-6 6 6 6" />
      </svg>
      {t("common.back")}
    </button>
  );
}

// Заглушка «скоро» для способов без готового бэка (подарки/каталог).
function ComingSoon({ t, title, onBack }: { t: TFunc; title: TKey; onBack: () => void }) {
  return (
    <div>
      <BackButton t={t} onBack={onBack} />
      <div className="flex flex-col items-center pb-2 pt-3 text-center">
        <Lottie src="/lottie/gift.json" className="h-24 w-24" />
        <div className="mt-2 text-lg font-bold">{t(title)}</div>
        <p className="mt-2 max-w-xs text-sm text-neutral-400">{t("wd.comingSoon")}</p>
      </div>
    </div>
  );
}

// Вывод в TON: сумма (нано-TON) + адрес. Сабмит дебетует баланс на сервере и ставит
// выплату в очередь — фоновый отправитель шлёт перевод on-chain; на кошелёк приходит
// сумма за вычетом комиссии сети.
function TonWithdraw({
  t,
  onBack,
  onClose,
  balanceNano,
  minNano,
  feeNano,
  enabled,
  onSuccess,
}: {
  t: TFunc;
  onBack: () => void;
  onClose: () => void;
  balanceNano: number;
  minNano: number;
  feeNano: number;
  enabled: boolean;
  onSuccess: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [address, setAddress] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  // Клампим к балансу, чтобы «Макс» + округление не вышли за доступное.
  const amountNano = useMemo(() => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(Math.round(n * NANO), balanceNano);
  }, [amount, balanceNano]);

  const receiveNano = Math.max(0, amountNano - feeNano);
  const amountValid = amountNano >= minNano && amountNano <= balanceNano;
  const canSubmit = enabled && amountValid && address.trim().length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      await requestWithdraw(address.trim(), amountNano);
      setDone(true);
      onSuccess(); // обновить баланс в Home (он уже задебечен)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="py-6 text-center">
        <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-green-600 text-white shadow-lg shadow-emerald-500/40">
          <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="mx-auto max-w-[260px] text-sm text-neutral-300">{t("wd.success")}</p>
        <button
          onClick={onClose}
          className="mt-6 w-full rounded-2xl bg-white/10 py-3.5 text-sm font-semibold text-white transition active:scale-[0.99] hover:bg-white/15"
        >
          {t("common.close")}
        </button>
      </div>
    );
  }

  return (
    <>
      <BackButton t={t} onBack={onBack} />

      {/* Доступно к выводу */}
      <div className="mb-4 flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
        <span className="text-sm text-neutral-400">{t("wd.available")}</span>
        <span className="flex items-center gap-1.5 text-sm font-semibold tabular-nums">
          <TonIcon size={18} />
          {fmtTon(balanceNano / NANO)} TON
        </span>
      </div>

      {/* Сумма */}
      <label className="mb-1.5 block text-xs font-medium text-neutral-400">{t("wd.amount")}</label>
      <div className="mb-2 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3.5">
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          placeholder="0.00"
          className="min-w-0 flex-1 bg-transparent py-3.5 text-base tabular-nums outline-none placeholder:text-neutral-600"
        />
        <span className="text-sm font-medium text-neutral-500">TON</span>
        <button
          onClick={() => setAmount(balanceNano > 0 ? String(balanceNano / NANO) : "")}
          className="rounded-lg bg-white/10 px-2.5 py-1 text-xs font-semibold text-sky-300 transition active:scale-95 hover:bg-white/15"
        >
          {t("wd.max")}
        </button>
      </div>

      {/* Комиссия и сумма к получению — показываем, когда ввели валидную сумму */}
      {amountValid ? (
        <div className="mb-4 space-y-1.5 rounded-2xl bg-white/[0.03] px-3.5 py-2.5 text-xs">
          <div className="flex items-center justify-between text-neutral-400">
            <span>{t("wd.fee")}</span>
            <span className="tabular-nums">−{fmtTon(feeNano / NANO)} TON</span>
          </div>
          <div className="flex items-center justify-between font-semibold text-white">
            <span>{t("wd.receive")}</span>
            <span className="tabular-nums">{fmtTon(receiveNano / NANO)} TON</span>
          </div>
        </div>
      ) : (
        <p className="mb-4 text-xs text-neutral-500">{t("wd.min", { min: fmtTon(minNano / NANO) })}</p>
      )}

      {/* Адрес */}
      <label className="mb-1.5 block text-xs font-medium text-neutral-400">{t("wd.address")}</label>
      <input
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder={t("wd.addressPlaceholder")}
        className="mb-4 w-full rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-3.5 text-sm outline-none placeholder:text-neutral-600"
      />

      {error && <p className="mb-3 text-center text-xs text-rose-400">{error}</p>}

      <button
        disabled={!canSubmit}
        onClick={submit}
        className="w-full rounded-2xl bg-gradient-to-r from-sky-400 to-blue-600 py-3.5 text-sm font-bold text-white shadow-lg shadow-sky-500/30 transition active:scale-[0.99] enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
      >
        {submitting ? t("wd.submitting") : t("wd.submit")}
      </button>
      {!enabled && <p className="mt-3 text-center text-xs text-neutral-500">{t("wd.unavailable")}</p>}
    </>
  );
}
