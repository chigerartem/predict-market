import { useEffect, useRef, useState } from "react";
import lottie from "lottie-web";
import { getReferral, type MeResponse, type ReferralInfo } from "../api";
import { fmtInt, fmtUsd, fmtUsdCompact } from "../format";
import { useT } from "../i18n";

export default function Community({ me }: { me: MeResponse }) {
  const t = useT();
  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const animRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getReferral().then(setInfo).catch(() => setInfo(null));
  }, []);

  // Крутящаяся пачка денег (Lottie) в голубом герое. Файл — public/lottie/money.json.
  useEffect(() => {
    const el = animRef.current;
    if (!el) return;
    const anim = lottie.loadAnimation({
      container: el,
      renderer: "svg",
      loop: true,
      autoplay: true,
      path: "/lottie/money.json",
    });
    return () => anim.destroy();
  }, []);

  const refUrl =
    info?.ref_url ?? `https://t.me/kopix_cashback_bot?start=ref_${me.user.ref_code}`;
  const contact = info?.claim_contact ?? "kopix_tg";

  // Предпросмотр вида новичка БЕЗ изменения данных: открой Mini App по ссылке с
  // ?startapp=newbie (в Telegram) или ?newbie (в браузере) — экран покажется с
  // нулями, как у нового юзера. Реальные приглашённые и их объём не меняются.
  const previewNewbie =
    window.Telegram?.WebApp?.initDataUnsafe?.start_param === "newbie" ||
    new URLSearchParams(window.location.search).has("newbie");

  const levels = info?.levels ?? [];
  const vol = previewNewbie ? 0 : Number(info?.invitee_volume_usd ?? 0);
  const invitedCount = previewNewbie ? 0 : info?.invited_count;
  const cur = previewNewbie ? 0 : info?.current_level ?? 0;
  const next = previewNewbie
    ? levels[0] ?? { level: 1, threshold_usd: 250_000, reward_usd: 4 }
    : info?.next_level ?? null;
  const claimable = previewNewbie ? 0 : Number(info?.claimable_usd ?? 0);
  const prevThreshold = cur > 0 ? levels.find((l) => l.level === cur)?.threshold_usd ?? 0 : 0;
  const progress = next
    ? Math.min(100, Math.max(0, ((vol - prevThreshold) / (next.threshold_usd - prevThreshold)) * 100))
    : 100;

  async function copy() {
    try {
      await navigator.clipboard.writeText(refUrl);
      setCopied(true);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore — clipboard not available
    }
  }

  function shareToTelegram() {
    const tg = window.Telegram?.WebApp;
    const text = t("community.shareText");
    const url = `https://t.me/share/url?url=${encodeURIComponent(refUrl)}&text=${encodeURIComponent(text)}`;
    tg?.HapticFeedback?.impactOccurred?.("medium");
    if (tg?.openTelegramLink) tg.openTelegramLink(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  }

  function claim() {
    const tg = window.Telegram?.WebApp;
    const url = `https://t.me/${contact}`;
    tg?.HapticFeedback?.impactOccurred?.("medium");
    if (tg?.openTelegramLink) tg.openTelegramLink(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div>
      {/* Голубой герой: крутящаяся пачка денег на голубом фоне. Плашка Telegram
          красится в тот же голубой в App.tsx (по активной вкладке) — бесшовно. */}
      <div className="relative flex w-full flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-[#5CCBFF] to-[#2E9BE6] px-6 pb-7 pt-7 text-center">
        <div ref={animRef} className="h-32 w-32" />
        <h1
          className="mt-4 text-[26px] font-bold leading-tight text-white"
          style={{ textShadow: "0 2px 12px rgba(0,40,80,0.3)" }}
        >
          {t("community.heroTitle")}
        </h1>
        <p
          className="mt-2 max-w-[300px] text-[13px] leading-relaxed text-white/85"
          style={{ textWrap: "balance" }}
        >
          {t("community.heroSubtitle")}
        </p>
      </div>

      <div className="min-h-screen space-y-4 bg-[#0A0E16] p-4 pb-32">
      <div className="grid grid-cols-2 gap-3">
        <Stat label={t("community.statInvited")} value={fmtInt(invitedCount)} />
        <Stat label={t("community.statVolume")} value={fmtUsdCompact(String(vol))} />
      </div>

      {/* Статус: уровень + прогресс к следующему + «как это работает» — единым
          блоком, чтобы уровень не висел оторванной плашкой над экраном. */}
      <section className="rounded-3xl border border-white/[0.07] bg-white/[0.03] p-5">
        <div className="flex items-center justify-between">
          {cur > 0 ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-sky-400/10 px-3 py-1 text-sm font-medium text-sky-300 ring-1 ring-inset ring-sky-400/20">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
              {t("community.level", { n: cur })}
            </span>
          ) : (
            <span className="text-sm font-semibold text-neutral-200">{t("community.yourLevel")}</span>
          )}
          <button
            onClick={() => setShowInfo(true)}
            className="inline-flex items-center gap-1 text-[13px] text-neutral-400 transition active:scale-95"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11v5" />
              <path d="M12 7.5h.01" />
            </svg>
            {t("community.howItWorksQ")}
          </button>
        </div>

        {cur === 0 && next && (
          <p className="mt-4 text-sm leading-relaxed text-neutral-300">
            {t("community.firstInviteA")}
            <b className="text-white">{t("community.levelN", { n: next.level })}</b>
            {t("community.firstInviteB")}
            <b className="text-sky-300">{fmtUsd(String(next.reward_usd))}</b>
            {t("community.firstInviteC", { threshold: fmtUsdCompact(String(next.threshold_usd)) })}
          </p>
        )}

        {next ? (
          <>
            <div className="mt-4 flex items-baseline justify-between">
              <span className="text-sm text-neutral-300">
                {cur > 0 ? t("community.toLevel", { n: next.level }) : t("community.toFirstLevel")}
              </span>
              <span className="text-sm font-semibold text-sky-300">{fmtUsd(String(next.reward_usd))}</span>
            </div>
            <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#5CCBFF] to-[#2E9BE6] transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-2 text-[11px] text-neutral-500">
              {t("community.volumeOf", {
                vol: fmtUsdCompact(String(vol)),
                threshold: fmtUsdCompact(String(next.threshold_usd)),
              })}
            </div>
          </>
        ) : (
          <div className="mt-4 text-sm font-medium text-sky-300">{t("community.maxLevel")}</div>
        )}
      </section>

      {/* Награда за достигнутый уровень — забрать через бота вручную */}
      {cur > 0 && claimable > 0 && (
        <section className="overflow-hidden rounded-3xl border border-sky-400/30 bg-gradient-to-b from-sky-400/[0.16] to-sky-400/[0.04] p-5">
          <div className="text-[11px] uppercase tracking-wider text-sky-300/80">
            {t("community.rewardForLevel", { n: cur })}
          </div>
          <div className="mt-1 text-3xl font-bold tracking-tight text-white">
            {fmtUsd(String(claimable))}
          </div>
          <button
            onClick={claim}
            className="mt-4 w-full rounded-2xl bg-[#5CCBFF] py-3 text-sm font-semibold text-[#04243b] transition active:scale-[0.99]"
          >
            {t("community.claimVia", { contact })}
          </button>
        </section>
      )}

      {/* Все уровни — что это и за что: без «от», с колонками «оборот → награда» */}
      <section className="rounded-3xl border border-white/[0.07] bg-white/[0.03] p-5">
        <div className="text-[11px] uppercase tracking-wider text-neutral-500">{t("community.rewardsTitle")}</div>
        <div className="mt-4 flex items-center gap-3 border-b border-white/[0.06] pb-2 text-[10px] uppercase tracking-wider text-neutral-500">
          <span className="w-7" />
          <span className="flex-1">{t("community.colVolume")}</span>
          <span className="w-5" />
          <span className="w-14 text-right">{t("community.colReward")}</span>
        </div>
        <div className="mt-1">
          {levels.map((lv) => {
            const reached = vol >= lv.threshold_usd;
            return (
              <div key={lv.level} className="flex items-center gap-3 py-2 text-sm">
                <span
                  className={
                    "grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold " +
                    (reached ? "bg-[#5CCBFF] text-[#04243b]" : "bg-white/[0.06] text-neutral-500")
                  }
                >
                  {reached ? "✓" : lv.level}
                </span>
                <span className={"flex-1 tabular-nums " + (reached ? "text-neutral-100" : "text-neutral-400")}>
                  {fmtUsdCompact(String(lv.threshold_usd))}
                </span>
                <span className="text-neutral-600">→</span>
                <span
                  className={
                    "w-14 text-right tabular-nums font-semibold " +
                    (reached ? "text-sky-300" : "text-neutral-500")
                  }
                >
                  {fmtUsd(String(lv.reward_usd))}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Реф-ссылка */}
      <section className="rounded-3xl border border-white/[0.07] bg-white/[0.03] p-5">
        <div className="mb-2 text-[11px] uppercase tracking-wider text-neutral-500">
          {t("community.yourLink")}
        </div>
        <div className="break-all rounded-2xl bg-black/30 px-3 py-2.5 text-[13px] text-neutral-300 ring-1 ring-inset ring-white/[0.06]">
          {refUrl}
        </div>
        <div className="mt-3 flex gap-2.5">
          <button
            onClick={copy}
            className={
              "flex-1 rounded-2xl py-3 text-sm font-medium ring-1 ring-inset transition active:scale-[0.99] " +
              (copied
                ? "bg-sky-400/10 text-sky-300 ring-sky-400/30"
                : "text-neutral-200 ring-white/10")
            }
          >
            {copied ? t("community.copied") : t("community.copy")}
          </button>
          <button
            onClick={shareToTelegram}
            className="flex-1 rounded-2xl bg-[#5CCBFF] py-3 text-sm font-semibold text-[#04243b] transition active:scale-[0.99]"
          >
            {t("community.share")}
          </button>
        </div>
      </section>

      </div>

      {/* Модалка «Как это работает» — открывается по кнопке «i» */}
      {showInfo && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setShowInfo(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl border border-white/10 bg-[#121217] p-6"
            onClick={(e) => e.stopPropagation()}
            style={{ marginBottom: "max(1rem, env(safe-area-inset-bottom))" }}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t("community.howItWorks")}</h2>
              <button
                onClick={() => setShowInfo(false)}
                aria-label={t("common.close")}
                className="grid h-8 w-8 place-items-center rounded-full bg-white/[0.06] text-neutral-400 transition active:scale-95"
              >
                ✕
              </button>
            </div>
            <ol className="mt-5 space-y-4">
              <Step n={1} text={t("community.step1")} />
              <Step n={2} text={t("community.step2")} />
              <Step n={3} text={t("community.step3")} />
              <Step n={4} text={t("community.step4")} />
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] p-4 text-center">
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wider text-neutral-500">{label}</div>
    </div>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-sky-400/15 text-xs font-semibold text-sky-300">
        {n}
      </span>
      <span className="text-sm leading-relaxed text-neutral-300">{text}</span>
    </li>
  );
}
