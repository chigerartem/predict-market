import { useEffect, useRef, useState } from "react";
import lottie, { type AnimationItem } from "lottie-web";
import type { MeResponse } from "../api";
import UserAvatar, { tgHandle } from "../components/UserAvatar";
import { useT, useLang, type Lang } from "../i18n";

// Единый контакт поддержки (white-label: пока общий, см. правило в памяти
// feedback-marketing-copy). При нажатии открываем ЛС с уже готовым текстом
// в поле ввода — юзеру остаётся отправить. Текст предзаполнения локализован
// (profile.supportPrefill / profile.studioPrefill) — следует языку интерфейса.
const SUPPORT_USERNAME = "kopix_tg";
const APP_VERSION = "1.0.0";

type Sheet = null | "faq" | "terms" | "privacy";

// Маска (анимир. эмодзи Batman, public/lottie/batman-mask.json) поверх аватара.
// Геометрия подогнана визуально: маска чуть шире аватара и приподнята, чтобы
// «уши» торчали над макушкой, глаза легли на глаза, а низ аватара (рот) остался
// открытым — у бэтмен-маски низ свободен.
const AVATAR = 88;
// Рисунок эмодзи занимает ~61% ширины своего квадрата, поэтому бокс делаем
// крупным: MASK_W=156 → видимая маска ~95px (шире аватара 88). MASK_TOP=-97 —
// низ рисунка маски ложится на СЕРЕДИНУ аватара (низ открыт), уши уходят вверх
// за край героя (эмодзи — высокий cowl, иначе при «низ на середине + шире» не
// влезает целиком). Подгонять размер/посадку — этими двумя числами.
const MASK_W = 156;
const MASK_TOP = -97;
type MaskState = "hidden" | "resting" | "aside";
const MASK_TF: Record<MaskState, string> = {
  hidden: "translateY(-135%) scale(0.85)", // над аватаром, до въезда
  resting: "translateY(0) scale(1)", // села на лицо
  aside: "translateX(118%) rotate(10deg)", // отъехала вбок (тап) — видно лицо
};

export default function Profile({ me, active }: { me: MeResponse; active: boolean }) {
  const t = useT();
  const [lang, setLang] = useLang();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [maskState, setMaskState] = useState<MaskState>("hidden");
  const maskBox = useRef<HTMLDivElement>(null);
  const maskAnim = useRef<AnimationItem | null>(null);
  const asideTimer = useRef<number | undefined>(undefined);

  // Грузим Lottie-маску один раз (Profile всегда смонтирован, скрыт через hidden).
  useEffect(() => {
    const el = maskBox.current;
    if (!el) return;
    const anim = lottie.loadAnimation({
      container: el,
      renderer: "svg",
      loop: true,
      autoplay: false, // play/pause по active — не крутим на других вкладках
      path: "/lottie/batman-mask.json",
    });
    maskAnim.current = anim;
    return () => {
      anim.destroy();
      maskAnim.current = null;
    };
  }, []);

  // Вход на вкладку: маска выезжает сверху и садится; уход — сброс для повтора.
  useEffect(() => {
    if (active) {
      maskAnim.current?.play();
      setMaskState("hidden");
      // двойной rAF: дать кадр отрисовать «hidden», чтобы transition проиграл
      const r1 = requestAnimationFrame(() =>
        requestAnimationFrame(() => setMaskState("resting")),
      );
      return () => cancelAnimationFrame(r1);
    }
    maskAnim.current?.pause();
    setMaskState("hidden");
    clearTimeout(asideTimer.current);
  }, [active]);

  useEffect(() => () => clearTimeout(asideTimer.current), []);

  // Тап по маске: отъезжает вбок, показывает лицо ~2с, заезжает назад.
  function tapMask() {
    if (maskState !== "resting") return;
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light");
    setMaskState("aside");
    clearTimeout(asideTimer.current);
    asideTimer.current = window.setTimeout(() => setMaskState("resting"), 2000);
  }

  function openSupport() {
    const tg = window.Telegram?.WebApp;
    const url = `https://t.me/${SUPPORT_USERNAME}?text=${encodeURIComponent(t("profile.supportPrefill"))}`;
    tg?.HapticFeedback?.impactOccurred?.("medium");
    if (tg?.openTelegramLink) tg.openTelegramLink(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  }

  // Заявка на разработку — тот же @kopix_tg, но со «студийным» предзаполнением.
  function openStudio() {
    const tg = window.Telegram?.WebApp;
    const url = `https://t.me/${SUPPORT_USERNAME}?text=${encodeURIComponent(t("profile.studioPrefill"))}`;
    tg?.HapticFeedback?.impactOccurred?.("medium");
    if (tg?.openTelegramLink) tg.openTelegramLink(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div>
      {/* Голубой герой профиля: аватар + имя. Плашка Telegram голубая (App.tsx). */}
      <div className="flex min-h-[218px] w-full flex-col justify-end bg-gradient-to-b from-[#5CCBFF] to-[#2E9BE6] px-5 pb-7 text-white">
        {/* Имя и @username — ПО БОКАМ от аватара (не под ним), сам аватар опущен
            вниз (justify-end) → над ним свободно, уши маски видны целиком. */}
        <div className="flex items-center justify-center gap-2">
          <div className="min-w-0 flex-1 truncate text-center text-lg font-semibold leading-tight">
            {me.user.name}
          </div>
          <div className="relative shrink-0" style={{ width: AVATAR, height: AVATAR }}>
            <UserAvatar name={me.user.name} size={AVATAR} />
            {/* Маска поверх аватара. Центрируем через left/marginLeft, transform
                оставляем под анимацию (въезд сверху / отъезд вбок по тапу). */}
            <button
              type="button"
              aria-label={t("profile.maskAria")}
              onClick={tapMask}
              className="absolute cursor-pointer will-change-transform"
              style={{
                width: MASK_W,
                height: MASK_W,
                left: "50%",
                marginLeft: -(MASK_W / 2),
                top: MASK_TOP,
                opacity: maskState === "hidden" ? 0 : 1,
                transform: MASK_TF[maskState],
                transition:
                  "transform 680ms cubic-bezier(0.30,1.75,0.55,1), opacity 420ms ease",
              }}
            >
              <div ref={maskBox} className="h-full w-full" />
            </button>
          </div>
          <div className="min-w-0 flex-1 truncate text-center text-sm leading-tight text-white/80">
            {tgHandle(me.user)}
          </div>
        </div>
      </div>

      <div className="min-h-full space-y-4 bg-[#0A0E16] px-4 pb-32 pt-5">
        {/* Поддержка */}
        <section className="overflow-hidden rounded-3xl border border-white/[0.07] bg-white/[0.03]">
          <Row
            onClick={openSupport}
            title={t("profile.contactSupport")}
            subtitle={t("profile.replyOnTelegram")}
            icon={
              <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8 8.38 8.38 0 0 1 8.5-8.5A8.5 8.5 0 0 1 21 11.5z" />
            }
            external
          />
          <Divider />
          <Row
            onClick={() => setSheet("faq")}
            title={t("profile.howCashbackWorks")}
            subtitle={t("profile.theEssentials")}
            icon={
              <>
                <circle cx="12" cy="12" r="9" />
                <path d="M9.5 9a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 2-2 3" />
                <path d="M12 17h.01" />
              </>
            }
          />
        </section>

        {/* О приложении */}
        <section className="overflow-hidden rounded-3xl border border-white/[0.07] bg-white/[0.03]">
          <Row
            onClick={() => setSheet("terms")}
            title={t("profile.terms")}
            icon={
              <>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6M9 13h6M9 17h4" />
              </>
            }
          />
          <Divider />
          <Row
            onClick={() => setSheet("privacy")}
            title={t("profile.privacy")}
            icon={<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />}
          />
        </section>

        {/* Переключатель языка интерфейса. Английский — по умолчанию; выбор
            хранится в localStorage (см. i18n.tsx) и мгновенно меняет весь апп. */}
        <section className="rounded-3xl border border-white/[0.07] bg-white/[0.03] p-4">
          <div className="mb-2.5 px-1 text-[11px] uppercase tracking-wider text-neutral-500">
            {t("profile.language")}
          </div>
          <div className="flex gap-2">
            {(["en", "ru"] as const).map((l) => {
              const activeLang = lang === l;
              return (
                <button
                  key={l}
                  onClick={() => setLang(l as Lang)}
                  className={
                    "flex-1 rounded-2xl py-2.5 text-sm font-medium ring-1 ring-inset transition active:scale-[0.99] " +
                    (activeLang
                      ? "bg-[#5CCBFF]/10 text-[#5CCBFF] ring-[#5CCBFF]/30"
                      : "text-neutral-300 ring-white/10")
                  }
                >
                  {l === "en" ? "English" : "Русский"}
                </button>
              );
            })}
          </div>
        </section>

        {/* Ненавязчивый кредит студии (по просьбе Артёма): KopiX берёт заказы на
            разработку. Мелкий футер — заметно, только если присмотреться. @kopix_tg. */}
        <button
          onClick={openStudio}
          className="block w-full text-center text-[11px] leading-relaxed text-neutral-600 transition active:opacity-70"
        >
          {t("profile.studioA")}<span className="font-medium text-neutral-400">KopiX</span>{t("profile.studioB")}
          <br />
          {t("profile.studioTagline")}{" "}
          <span className="text-sky-400/80">@{SUPPORT_USERNAME}</span>
        </button>

        <div className="pt-2 text-center text-[11px] text-neutral-600">
          {t("profile.version", { v: APP_VERSION, id: me.user.tg_id })}
        </div>
      </div>

      {sheet === "faq" && (
        <BottomSheet title={t("profile.howCashbackWorks")} onClose={() => setSheet(null)}>
          <div className="space-y-4">
            <Faq q={t("profile.faqQ1")} a={t("profile.faqA1")} />
            <Faq q={t("profile.faqQ2")} a={t("profile.faqA2")} />
            <Faq q={t("profile.faqQ3")} a={t("profile.faqA3")} />
            <Faq q={t("profile.faqQ4")} a={t("profile.faqA4")} />
          </div>
        </BottomSheet>
      )}

      {sheet === "terms" && (
        <BottomSheet title={t("profile.terms")} onClose={() => setSheet(null)}>
          <div className="space-y-4">
            <p className="text-[13px] leading-relaxed text-neutral-400">
              {t("profile.termsIntro")}
            </p>
            <LegalSection h={t("profile.termsH1")}>{t("profile.termsB1")}</LegalSection>
            <LegalSection h={t("profile.termsH2")}>{t("profile.termsB2")}</LegalSection>
            <LegalSection h={t("profile.termsH3")}>{t("profile.termsB3")}</LegalSection>
            <LegalSection h={t("profile.termsH4")}>{t("profile.termsB4")}</LegalSection>
            <LegalSection h={t("profile.termsH5")}>{t("profile.termsB5")}</LegalSection>
            <LegalSection h={t("profile.termsH6")}>{t("profile.termsB6")}</LegalSection>
          </div>
        </BottomSheet>
      )}

      {sheet === "privacy" && (
        <BottomSheet title={t("profile.privacy")} onClose={() => setSheet(null)}>
          <div className="space-y-4">
            <LegalSection h={t("profile.privH1")}>{t("profile.privB1")}</LegalSection>
            <LegalSection h={t("profile.privH2")}>{t("profile.privB2")}</LegalSection>
            <LegalSection h={t("profile.privH3")}>{t("profile.privB3")}</LegalSection>
            <LegalSection h={t("profile.privH4")}>{t("profile.privB4")}</LegalSection>
            <LegalSection h={t("profile.privH5")}>{t("profile.privB5")}</LegalSection>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}

function Row({
  title,
  subtitle,
  icon,
  onClick,
  external,
}: {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  onClick: () => void;
  external?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition active:bg-white/[0.03]"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sky-400/10 text-sky-300">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {icon}
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-neutral-100">{title}</span>
        {subtitle && <span className="block text-[12px] text-neutral-500">{subtitle}</span>}
      </span>
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-neutral-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {external ? <path d="M7 17L17 7M9 7h8v8" /> : <path d="M9 6l6 6-6 6" />}
      </svg>
    </button>
  );
}

function Divider() {
  return <div className="ml-16 border-t border-white/[0.06]" />;
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <div className="text-sm font-semibold text-neutral-100">{q}</div>
      <div className="mt-1 text-sm leading-relaxed text-neutral-400">{a}</div>
    </div>
  );
}

function LegalSection({ h, children }: { h: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-sm font-semibold text-neutral-100">{h}</div>
      <p className="mt-1 text-[13px] leading-relaxed text-neutral-400">{children}</p>
    </div>
  );
}

function BottomSheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl border border-white/10 bg-[#121217] p-6"
        onClick={(e) => e.stopPropagation()}
        style={{ marginBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="grid h-8 w-8 place-items-center rounded-full bg-white/[0.06] text-neutral-400 transition active:scale-95"
          >
            ✕
          </button>
        </div>
        <div className="mt-5 max-h-[68vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
