import { useEffect, useRef, useState } from "react";
import lottie from "lottie-web";
import {
  ApiError,
  connectExchange,
  getExchanges,
  type ExchangeInfo,
} from "../api";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { useT, type TFunc } from "../i18n";

// Аккаунт поддержки для РУЧНОЙ активации биржевого VIP на Bitunix
// (VIP выдаётся не автоматически — менеджером после обращения юзера).
const SUPPORT_USERNAME = "kopix_tg";

type Step = "intro" | "uid" | "done" | "error";

type Props = {
  open: boolean;
  exchange: ExchangeInfo | null;
  onClose: () => void;
  onSuccess: () => void;
};

export default function ConnectExchangeModal({
  open,
  exchange,
  onClose,
  onSuccess,
}: Props) {
  const t = useT();
  const [step, setStep] = useState<Step>("intro");
  const [uid, setUid] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Свежая реф-ссылка (из бэка при открытии), чтобы только что изменённая в
  // админке ссылка работала сразу, не дожидаясь обновления localStorage-кеша
  // Home. undefined — ещё не загружена (фолбэк на пропс из кеша).
  const [freshRefUrl, setFreshRefUrl] = useState<string | null | undefined>(undefined);
  const uidInputRef = useRef<HTMLInputElement>(null);
  const sheetWrapRef = useRef<HTMLDivElement>(null);

  // Голубая шапка (а не дефолтная тёмная) — фон при открытой модалке голубой,
  // без затемнения (выбор Артёма 2026-06-17), шапка должна с ним сливаться.
  useBodyScrollLock(open, "#5CCBFF");

  useEffect(() => {
    if (!open) return;
    setStep("intro");
    setUid("");
    setError(null);
    setFreshRefUrl(undefined);
    window.Telegram?.WebApp?.expand?.();
  }, [open]);

  // Под клавиатурой фон viewport не должен быть голубым: bg вкладки Home (#5CCBFF)
  // проступает ПОД полупрозрачной iOS-клавой и в зазоре — голубое под клавишами
  // выглядит странно. Пока модалка открыта → тёмный bg (#0A0E16, как фон контента
  // под героем); на закрытие возвращаем голубой (верхний overscroll Home голубой).
  // Это НЕ затемнение модалки (оверлея нет, «разрыв» не возвращается) — только цвет
  // viewport за пределами контента. Верх остаётся голубым: шапка + герой (контент).
  useEffect(() => {
    if (!open) return;
    const tg = window.Telegram?.WebApp;
    try {
      tg?.setBackgroundColor?.("#0A0E16");
    } catch {
      /* старый клиент без setBackgroundColor */
    }
    return () => {
      try {
        tg?.setBackgroundColor?.("#5CCBFF");
      } catch {
        /* старый клиент */
      }
    };
  }, [open]);

  // Подтягиваем СВЕЖИЙ список бирж при открытии и берём актуальную referral_url
  // именно для этой биржи (минуя возможно устаревший localStorage-кеш Home).
  useEffect(() => {
    if (!open || !exchange) return;
    let cancelled = false;
    getExchanges()
      .then((list) => {
        if (cancelled) return;
        const fresh = list.find((e) => e.slug === exchange.slug);
        setFreshRefUrl(fresh ? fresh.referral_url : exchange.referral_url);
      })
      .catch(() => {
        if (!cancelled) setFreshRefUrl(exchange.referral_url);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, exchange?.slug]);

  // Двигаем контейнер sheet, чтобы модалка садилась ровно над клавиатурой на iOS
  // (position:fixed сам не учитывает выезд клавиатуры). Затемнения больше нет —
  // модалка на голубом фоне Home, поэтому рассинхрон vv максимум сдвинет саму
  // карточку, а оголять/«рвать» нечего.
  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    const el = sheetWrapRef.current;
    if (!vv || !el) return;
    // Синхроним оверлей с visualViewport КАЖДЫЙ кадр (rAF), а НЕ по событиям: на
    // iOS события resize/scroll клавиатуры приходят с пропусками/устаревшими
    // значениями → оверлей «рвался через раз». rAF ловит каждый кадр анимации
    // клавы и финальное состояние; стиль пишем только при изменении значений.
    let raf = 0;
    let lastH = -1;
    let lastT = -1;
    const loop = () => {
      // Поле UID в фокусе (клавиатура открыта) → размер по visualViewport (sheet
      // над клавой). НЕ в фокусе (клава закрыта) → стабильный window.innerHeight
      // (на iOS vv.height после закрытия клавы «залипает» уменьшенным).
      const focused =
        !!uidInputRef.current && document.activeElement === uidInputRef.current;
      const h = focused ? Math.round(vv.height) : Math.round(window.innerHeight);
      const t = focused ? Math.round(vv.offsetTop) : 0;
      if (h !== lastH || t !== lastT) {
        el.style.height = `${h}px`;
        el.style.transform = `translateY(${t}px)`;
        lastH = h;
        lastT = t;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      el.style.height = "";
      el.style.transform = "";
    };
  }, [open]);

  // Актуальная ссылка: свежая из fetch, фолбэк — пропс из кеша Home.
  const refUrl = freshRefUrl !== undefined ? freshRefUrl : exchange?.referral_url ?? null;

  function openReferralLink() {
    if (!refUrl) return;
    haptic("medium");
    const tg = window.Telegram?.WebApp;
    if (tg?.openLink) {
      tg.openLink(refUrl, { try_instant_view: false });
    } else {
      window.open(refUrl, "_blank", "noopener,noreferrer");
    }
  }

  function openSupport() {
    haptic("medium");
    const url = `https://t.me/${SUPPORT_USERNAME}`;
    const tg = window.Telegram?.WebApp;
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(url);
    } else if (tg?.openLink) {
      tg.openLink(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  async function submitUid() {
    if (!exchange) return;
    const isEmail = exchange.slug === "binance";
    let value = uid;
    if (isEmail) {
      value = uid.trim().toLowerCase();
      if (value.length > 128 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
        setError(t("cem.emailError", { name: exchange.name }));
        return;
      }
    } else if (!/^\d{3,32}$/.test(uid)) {
      setError(t("cem.uidError"));
      return;
    }
    // Снимаем фокус с input ДО запроса. Иначе цепочка событий «keyboard
    // close → visualViewport resize → margin transition → смена step → новая
    // высота sheet» наезжает сама на себя и sheet прыгает туда-сюда.
    (document.activeElement as HTMLElement | null)?.blur?.();
    setSubmitting(true);
    setError(null);
    try {
      // Даём клавиатуре и sheet доехать вниз ОДНИМ движением до смены контента.
      const settle = new Promise((r) => setTimeout(r, 280));
      await connectExchange(exchange.slug, value);
      await settle;
      haptic("success");
      setStep("done");
      onSuccess();
    } catch (e) {
      haptic("error");
      setError(humanError(e, exchange.name, t));
    } finally {
      setSubmitting(false);
    }
  }

  if (!open || !exchange) return null;

  const isEmail = exchange.slug === "binance";

  return createPortal(
    // БЕЗ затемнения: прозрачный контейнер, модалка выезжает снизу прямо на голубой
    // фон Home (выбор Артёма 2026-06-17). Тёмного оверлея НЕТ → «разрыв» затемнения
    // при клавиатуре на iOS невозможен. Контейнер садится над клавиатурой через rAF
    // по visualViewport (см. useEffect). Сама карточка тёмная — выделяется на голубом.
    <div
      ref={sheetWrapRef}
      className="fixed inset-x-0 top-0 z-50 flex h-full items-end justify-center overscroll-contain"
      onTouchMove={(e) => {
        if (e.target === e.currentTarget) e.preventDefault();
      }}
    >
      <div className="max-h-full w-full max-w-md overflow-y-auto rounded-t-3xl bg-neutral-900 p-5 pb-8 sm:mb-4 sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-base font-semibold">{t("cem.connectTitle", { name: exchange.name })}</div>
          <button
            onClick={onClose}
            className="text-xl text-neutral-500 hover:text-neutral-200"
            aria-label={t("common.close")}
          >
            ×
          </button>
        </div>

        <Stepper step={step} />

        {step === "intro" && (
          <div className="space-y-4">
            <p className="text-sm text-neutral-300">
              {t("cem.intro", { name: exchange.name })}
            </p>
            {exchange.slug === "bitunix" && (
              <VipBlock
                title={t("cem.vipIntroTitle")}
                text={
                  <>
                    {t("cem.vipIntroA")}
                    <b className="text-neutral-200">{t("cem.vipIntroBold")}</b>
                    {t("cem.vipIntroB")}
                  </>
                }
              />
            )}
            <button
              onClick={openReferralLink}
              disabled={!refUrl}
              className="w-full rounded-xl bg-[#5CCBFF] py-3 font-medium text-[#04243b] disabled:opacity-40"
            >
              {t("cem.openAndSignUp", { name: exchange.name })}
            </button>
            {!refUrl && (
              <p className="text-xs text-amber-400">
                {t("cem.refNotSet")}
              </p>
            )}
            <button
              onClick={() => setStep("uid")}
              className="w-full rounded-xl border border-neutral-700 py-3 text-sm text-neutral-200"
            >
              {t("cem.iSignedUp")}
            </button>
          </div>
        )}

        {step === "uid" && (
          <div className="space-y-4">
            <div className="text-sm text-neutral-400">
              {isEmail
                ? t("cem.enterEmail", { name: exchange.name })
                : t("cem.enterUid", { name: exchange.name })}
            </div>

            <input
              ref={uidInputRef}
              value={uid}
              onChange={(e) =>
                setUid(isEmail ? e.target.value : e.target.value.replace(/\D/g, ""))
              }
              inputMode={isEmail ? "email" : "numeric"}
              type={isEmail ? "email" : "text"}
              autoCapitalize={isEmail ? "none" : undefined}
              autoCorrect={isEmail ? "off" : undefined}
              spellCheck={isEmail ? false : undefined}
              placeholder={isEmail ? t("cem.emailPlaceholder") : t("cem.uidPlaceholder")}
              className="w-full rounded-xl bg-neutral-800 px-4 py-3 text-base text-white outline-none ring-[#5CCBFF] focus:ring-2 placeholder:text-neutral-600"
            />

            <p className="text-xs text-neutral-500">
              {isEmail
                ? t("cem.emailHint", { name: exchange.name })
                : t("cem.uidHint", { name: exchange.name })}
            </p>
            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              onClick={submitUid}
              disabled={submitting || !uid}
              className="w-full rounded-xl bg-[#5CCBFF] py-3 font-medium text-[#04243b] disabled:opacity-40"
            >
              {submitting ? t("cem.checking") : t("cem.confirm")}
            </button>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#5CCBFF] shadow-lg shadow-[#5CCBFF]/25">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#04243b"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <div className="text-base font-medium">{t("cem.connected", { name: exchange.name })}</div>
            <p className="text-sm text-neutral-400">
              {t("cem.doneNote")}
            </p>
            {exchange.slug === "bitunix" && (
              <VipBlock
                title={t("cem.vipDoneTitle")}
                text={
                  <>
                    {t("cem.vipDoneA")}
                    <b className="text-neutral-200">{t("cem.vipDoneBold")}</b>
                    {t("cem.vipDoneB")}
                  </>
                }
                action={
                  <button
                    onClick={openSupport}
                    className="mt-3 w-full rounded-lg py-2.5 text-sm font-semibold text-[#04243b]"
                    style={{ background: "#5CCBFF" }}
                  >
                    {t("cem.contactSupport")}
                  </button>
                }
              />
            )}
            <button
              onClick={onClose}
              className="w-full rounded-xl bg-[#5CCBFF] py-3 font-medium text-[#04243b]"
            >
              {t("cem.done")}
            </button>
          </div>
        )}

        {step === "error" && (
          <div className="space-y-4">
            <p className="text-sm text-red-400">{error}</p>
            <button
              onClick={onClose}
              className="w-full rounded-xl border border-neutral-700 py-3"
            >
              {t("common.close")}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// Голубой VIP-блок Bitunix: КРУПНАЯ корона по ЦЕНТРУ сверху (золотая рука→корона,
// GiftsRO#36, Lottie), под ней заголовок + текст. По центру (Артём 2026-06-17).
function VipBlock({
  title,
  text,
  action,
}: {
  title: string;
  text: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl border p-4 text-center"
      style={{ borderColor: "#5CCBFF40", background: "#5CCBFF14" }}
    >
      <CrownLottie size={64} />
      <div className="mt-1.5 text-sm font-semibold" style={{ color: "#5CCBFF" }}>
        {title}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-neutral-300">{text}</p>
      {action}
    </div>
  );
}

// Анимированная корона (золотая рука → корона, GiftsRO#36), центрируется в блоке.
function CrownLottie({ size = 64 }: { size?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const anim = lottie.loadAnimation({
      container: el,
      renderer: "svg",
      loop: true,
      autoplay: true,
      path: "/lottie/vip-crown.json",
    });
    return () => anim.destroy();
  }, []);
  return <div ref={ref} className="mx-auto" style={{ width: size, height: size }} aria-hidden />;
}

function Stepper({ step }: { step: Step }) {
  const idx = step === "intro" ? 0 : step === "uid" ? 1 : 2;
  return (
    <div className="mb-4 grid grid-cols-3 gap-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={
            "h-1 rounded-full " + (i <= idx ? "bg-[#5CCBFF]" : "bg-neutral-700")
          }
        />
      ))}
    </div>
  );
}

function haptic(kind: "success" | "warning" | "error" | "medium") {
  const tg = window.Telegram?.WebApp;
  if (!tg?.HapticFeedback) return;
  if (kind === "medium") tg.HapticFeedback.impactOccurred("medium");
  else tg.HapticFeedback.notificationOccurred(kind);
}

function humanError(e: unknown, exchangeName: string, t: TFunc): string {
  if (e instanceof ApiError) {
    if (e.status === 503) {
      return t("cem.err503", { name: exchangeName });
    }
    if (e.status === 409) {
      return e.message;
    }
    if (e.status === 422 || e.status === 502) {
      return e.message || t("cem.err422", { name: exchangeName });
    }
    return e.message || t("cem.errGeneric", { status: e.status });
  }
  return e instanceof Error ? e.message : String(e);
}
