import { useEffect, useState, type ReactNode } from "react";
import { beginCell } from "@ton/core";
import { useTonAddress, useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";
import { createStarsInvoice, fetchStarsQuote, fetchTonDepositInfo, type TonDepositInfo } from "../realapi";
import { useT, type TKey, type TFunc } from "../i18n";
import BottomSheet from "./BottomSheet";
import Lottie from "./Lottie";
import TonIcon from "./TonIcon";

type Method = "gifts" | "ton" | "stars";
type Props = { open: boolean; onClose: () => void; onSuccess?: () => void };

// tint — яркий градиент-акцент карточки по методу (casino-стиль, не тусклые тинты):
// подарок розово-фиолетовый, TON голубой, Stars золотой. Цветное свечение снизу.
const METHODS: { id: Method; emoji: ReactNode; title: TKey; desc: TKey; tint: string }[] = [
  {
    id: "gifts",
    emoji: <Lottie src="/lottie/gift.json" className="h-full w-full" />,
    title: "dep.gifts",
    desc: "dep.giftsDesc",
    tint: "bg-gradient-to-br from-[#ff4d94] to-[#b521d6] shadow-pink-600/40",
  },
  {
    id: "ton",
    emoji: <TonIcon size={34} />,
    title: "dep.ton",
    desc: "dep.tonDesc",
    tint: "bg-gradient-to-br from-[#41b6ff] to-[#1a6bf0] shadow-sky-600/40",
  },
  {
    id: "stars",
    emoji: <Lottie src="/lottie/star.json" className="h-full w-full" />,
    title: "dep.stars",
    desc: "dep.starsDesc",
    tint: "bg-gradient-to-br from-[#ffd23f] to-[#ff8a00] shadow-orange-600/40",
  },
];

const MIN_STARS = 50;
const PRESETS = [100, 250, 500, 1000];

// Пополнение баланса (TON). Stars — рабочий путь (инвойс → openInvoice → кредит на
// webhook); TON и подарки пока заглушка «скоро».
export default function DepositModal({ open, onClose, onSuccess }: Props) {
  const t = useT();
  const [method, setMethod] = useState<Method | null>(null);
  useEffect(() => {
    if (open) setMethod(null);
  }, [open]);

  const active = METHODS.find((m) => m.id === method);

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <div className="text-lg font-bold">{t("dep.title")}</div>
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
            <p className="mb-4 text-sm text-neutral-300">{t("dep.subtitle")}</p>
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
                  <span className="grid h-12 w-12 shrink-0 place-items-center text-3xl drop-shadow-md">
                    {m.emoji}
                  </span>
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
        ) : active.id === "stars" ? (
          <StarsDeposit t={t} onBack={() => setMethod(null)} onClose={onClose} onSuccess={onSuccess} />
        ) : active.id === "ton" ? (
          <TonDeposit t={t} onBack={() => setMethod(null)} onClose={onClose} onSuccess={onSuccess} />
        ) : (
          <div className="flex flex-col items-center pb-2 pt-3 text-center">
            <span className="grid h-24 w-24 place-items-center text-4xl">
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
    </BottomSheet>
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
        className="w-full rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 py-3.5 text-sm font-bold text-white shadow-lg shadow-orange-500/30 transition active:scale-[0.99] enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
      >
        {busy ? t("dep.processing") : `${t("dep.pay")} ${stars} ⭐`}
      </button>
    </div>
  );
}

const TON_PRESETS = [1, 5, 10, 50];

// TON deposit via TON Connect: the user connects a wallet (Tonkeeper, Tonhub,
// MyTonWallet…) once via the picker, then signs the transfer in-app. It carries
// the user's per-user memo as a text comment, so the backend watcher credits it by
// memo (~30s after confirmation). "Сменить кошелёк" disconnects and reopens the
// picker, so the user can switch to a different wallet.
//
// NB: the TON Connect bridge hosts MUST be allowed in nginx CSP `connect-src`, else
// sendTransaction hangs forever waiting for the wallet's reply over the (blocked)
// bridge — that CSP gap was the original "TON Connect hangs on iOS".
function TonDeposit({
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
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const address = useTonAddress(); // '' пока кошелёк не подключён

  const [info, setInfo] = useState<TonDepositInfo | null>(null);
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState(false); // идёт подпись в кошельке
  const [waiting, setWaiting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchTonDepositInfo()
      .then(setInfo)
      .catch(() => setErr(t("dep.tonUnavailable")));
  }, [t]);

  // Once the user heads to their wallet, poll the balance — the watcher credits the
  // transfer shortly after the network confirms, with no callback from the wallet.
  useEffect(() => {
    if (!waiting) return;
    let tries = 0;
    const poll = window.setInterval(() => {
      tries++;
      onSuccess?.();
      if (tries >= 20) window.clearInterval(poll);
    }, 6000);
    return () => window.clearInterval(poll);
  }, [waiting, onSuccess]);

  const amountTon = Number(amount) || 0;
  const amountNano = Math.round(amountTon * 1_000_000_000);
  const minNano = info?.min_nano ?? 100_000_000;
  const valid = !!info && amountNano >= minNano;

  // Подпись перевода в подключённом кошельке. memo кладём текстовым комментом
  // (опкод 0x00000000 + UTF-8) — ровно то, что воркер читает из in_msg.message.
  const pay = async () => {
    if (!valid || !info || busy) return;
    setErr(null);
    setBusy(true);
    try {
      const payload = beginCell()
        .storeUint(0, 32)
        .storeStringTail(info.memo)
        .endCell()
        .toBoc()
        .toString("base64");
      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [{ address: info.address, amount: String(amountNano), payload }],
      });
      setWaiting(true); // подписано и отправлено → воркер зачислит; опрашиваем баланс
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setErr(/reject|cancel|decline|abort/i.test(msg) ? t("dep.tonRejected") : t("dep.tonSendError"));
    } finally {
      setBusy(false);
    }
  };

  // Сменить кошелёк: отключаемся и сразу открываем список кошельков TON Connect,
  // чтобы юзер выбрал другой (напр. Tonhub вместо Tonkeeper) — возврат «в начало».
  const switchWallet = async () => {
    try {
      await tonConnectUI.disconnect();
    } catch {
      /* noop — даже если отключение не успело, openModal перепривяжет сессию */
    }
    tonConnectUI.openModal();
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

      {/* Сумму показываем ТОЛЬКО после подключения: TON Connect подписывает ровно её.
          Не подключён → один шаг «Подключить кошелёк» (picker со всеми кошельками). */}
      {!wallet ? (
        <button
          onClick={() => tonConnectUI.openModal()}
          disabled={!info}
          className={
            "w-full rounded-2xl py-3.5 text-center text-sm font-bold text-white transition " +
            (info ? "bg-gradient-to-r from-sky-400 to-blue-600 shadow-lg shadow-sky-500/30 active:scale-[0.99] hover:brightness-110" : "cursor-not-allowed bg-sky-500/30")
          }
        >
          {t("dep.tonConnect")}
        </button>
      ) : (
        <>
          <label className="mb-2 block text-xs font-medium text-neutral-400">{t("dep.tonAmount")}</label>
          <div className="mb-3 grid grid-cols-4 gap-2">
            {TON_PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setAmount(String(p))}
                className="rounded-xl border border-white/10 bg-white/[0.04] py-2 text-sm font-semibold tabular-nums text-neutral-200 transition active:scale-95 hover:bg-white/[0.08]"
              >
                {p}
              </button>
            ))}
          </div>

          <div className="mb-4 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3.5">
            <TonIcon size={18} />
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
              className="min-w-0 flex-1 bg-transparent py-3.5 text-base tabular-nums outline-none placeholder:text-neutral-600"
              placeholder="0.0"
            />
            <span className="text-sm font-medium text-neutral-500">TON</span>
          </div>

          {!err && info && !valid && <p className="mb-3 text-center text-xs text-neutral-500">{t("dep.tonMin")}</p>}

          <button
            onClick={pay}
            disabled={!valid || busy}
            className="w-full rounded-2xl bg-gradient-to-r from-sky-400 to-blue-600 py-3.5 text-center text-sm font-bold text-white shadow-lg shadow-sky-500/30 transition active:scale-[0.99] enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            {busy ? t("dep.tonConfirm") : `${t("dep.tonPay")} ${amountTon} TON`}
          </button>
          <div className="mt-2 flex items-center justify-center gap-1.5 text-xs text-neutral-500">
            <span className="font-mono">
              {t("dep.tonWallet")}: {address.slice(0, 4)}…{address.slice(-4)}
            </span>
            <span aria-hidden>·</span>
            <button
              onClick={switchWallet}
              className="text-neutral-400 underline-offset-2 hover:text-neutral-200 hover:underline"
            >
              {t("dep.tonSwitchWallet")}
            </button>
          </div>
        </>
      )}

      {err && <p className="mt-3 text-center text-xs text-red-400">{err}</p>}

      {waiting && <p className="mt-3 text-center text-xs text-emerald-400">{t("dep.tonWaiting")}</p>}

      {waiting && (
        <button
          onClick={onClose}
          className="mt-4 w-full rounded-2xl border border-white/15 bg-white/5 py-3 text-sm font-semibold transition active:scale-[0.99] hover:bg-white/10"
        >
          {t("common.close")}
        </button>
      )}
    </div>
  );
}
