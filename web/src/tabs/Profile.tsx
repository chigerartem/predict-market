import { useEffect, useRef, useState } from "react";
import lottie, { type AnimationItem } from "lottie-web";
import type { MeResponse } from "../api";
import { fetchMyBets, type Bet } from "../realapi";
import { fmtTon } from "../format";
import UserAvatar, { tgHandle } from "../components/UserAvatar";
import TonIcon from "../components/TonIcon";
import { useT } from "../i18n";

// Маска Бэтмена (public/lottie/batman-mask.json) поверх аватара: въезжает сверху,
// садится на лицо, по тапу отъезжает вбок на ~2с.
const AVATAR = 88;
const MASK_W = 156;
const MASK_TOP = -97;
type MaskState = "hidden" | "resting" | "aside";
const MASK_TF: Record<MaskState, string> = {
  hidden: "translateY(-135%) scale(0.85)",
  resting: "translateY(0) scale(1)",
  aside: "translateX(118%) rotate(10deg)",
};

// Аккаунт поддержки (и ручного вывода звёзд) — личка владельца.
const SUPPORT_HANDLE = "LinkerFlugel";

export default function Profile({ me, active }: { me: MeResponse; active: boolean }) {
  const t = useT();
  const [maskState, setMaskState] = useState<MaskState>("hidden");
  const maskBox = useRef<HTMLDivElement>(null);
  const maskAnim = useRef<AnimationItem | null>(null);
  const asideTimer = useRef<number | undefined>(undefined);

  // Статистика игрока считается из его ставок (как в «Ставках») — отдельного эндпоинта
  // нет. Грузим на маунте и обновляем при открытии вкладки (статусы могли измениться).
  const [bets, setBets] = useState<Bet[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchMyBets()
      .then((b) => !cancelled && setBets(b))
      .catch(() => !cancelled && setBets([]));
    return () => {
      cancelled = true;
    };
  }, [active]);
  const stats = computeStats(bets);

  useEffect(() => {
    const el = maskBox.current;
    if (!el) return;
    const anim = lottie.loadAnimation({
      container: el,
      renderer: "svg",
      loop: true,
      autoplay: false,
      path: "/lottie/batman-mask.json",
    });
    maskAnim.current = anim;
    return () => {
      anim.destroy();
      maskAnim.current = null;
    };
  }, []);

  useEffect(() => {
    if (active) {
      maskAnim.current?.play();
      setMaskState("hidden");
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

  function tapMask() {
    if (maskState !== "resting") return;
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light");
    setMaskState("aside");
    clearTimeout(asideTimer.current);
    asideTimer.current = window.setTimeout(() => setMaskState("resting"), 2000);
  }

  function openSupport() {
    const url = `https://t.me/${SUPPORT_HANDLE}`;
    const tg = window.Telegram?.WebApp;
    if (tg?.openTelegramLink) tg.openTelegramLink(url);
    else window.open(url, "_blank");
  }

  return (
    <div>
      <div className="flex min-h-[218px] w-full flex-col justify-end bg-gradient-to-b from-[#5CCBFF] to-[#2E9BE6] px-5 pb-7 text-white">
        <div className="flex items-center justify-center gap-2">
          <div className="min-w-0 flex-1 truncate text-center text-lg font-semibold leading-tight">
            {me.user.name}
          </div>
          <div className="relative shrink-0" style={{ width: AVATAR, height: AVATAR }}>
            <UserAvatar name={me.user.name} size={AVATAR} />
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

      <div className="space-y-3 px-4 pb-28 pt-4">
        {/* Статистика игрока (по ставкам) */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="mb-3 text-sm font-semibold text-white">{t("profile.stats")}</h2>
          <div className="grid grid-cols-2 gap-2.5">
            <StatTile label={t("profile.statBets")} value={stats ? String(stats.total) : "—"} />
            <StatTile
              label={t("profile.statWinRate")}
              value={stats && stats.winRate !== null ? `${Math.round(stats.winRate * 100)}%` : "—"}
            />
            <StatTile
              label={t("profile.statPnl")}
              value={stats ? fmtSigned(stats.pnl) : "—"}
              ton
              accent={stats ? (stats.pnl >= 0 ? "pos" : "neg") : undefined}
            />
            <StatTile label={t("profile.statWagered")} value={stats ? fmtTon(stats.wagered) : "—"} ton />
          </div>
        </section>

        {/* Честная игра (provably fair) */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-400/15 text-emerald-400">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l7 4v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7l7-4z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
            </span>
            <h2 className="text-sm font-semibold text-white">{t("profile.fairTitle")}</h2>
          </div>
          <p className="text-xs leading-relaxed text-neutral-400">{t("profile.fairText")}</p>
        </section>

        {/* Поддержка */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="text-sm font-semibold text-white">{t("profile.support")}</h2>
          <p className="mb-3 mt-1 text-xs leading-relaxed text-neutral-400">{t("profile.supportText")}</p>
          <button
            onClick={openSupport}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-sky-400 to-blue-600 py-3 text-sm font-bold text-white shadow-lg shadow-sky-500/30 transition active:scale-[0.99] hover:brightness-110"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71l-4.14-3.05-1.99 1.93c-.23.23-.42.42-.86.42z" />
            </svg>
            {t("profile.supportBtn")}
          </button>
        </section>
      </div>
    </div>
  );
}

// Сводка по ставкам игрока:
//   total   — всего ставок
//   winRate — доля выигранных среди расчитанных (WON/(WON+LOST)); null если расчётов нет
//   pnl     — реализованный P&L (TON): WON даёт (выплата − ставка), LOST даёт (− ставка)
//   wagered — суммарно поставлено (TON)
function computeStats(bets: Bet[] | null) {
  if (!bets) return null;
  let wins = 0;
  let settled = 0;
  let pnlNano = 0;
  let wageredNano = 0;
  for (const b of bets) {
    wageredNano += b.stake_nano;
    if (b.status === "WON") {
      wins++;
      settled++;
      pnlNano += b.payout_nano - b.stake_nano;
    } else if (b.status === "LOST") {
      settled++;
      pnlNano -= b.stake_nano;
    }
  }
  return {
    total: bets.length,
    winRate: settled > 0 ? wins / settled : null,
    pnl: pnlNano / 1e9,
    wagered: wageredNano / 1e9,
  };
}

function fmtSigned(ton: number): string {
  const s = fmtTon(Math.abs(ton));
  if (ton > 0) return "+" + s;
  if (ton < 0) return "−" + s;
  return s;
}

function StatTile({
  label,
  value,
  ton,
  accent,
}: {
  label: string;
  value: string;
  ton?: boolean;
  accent?: "pos" | "neg";
}) {
  const color = accent === "pos" ? "text-emerald-400" : accent === "neg" ? "text-red-400" : "text-white";
  return (
    <div className="rounded-xl bg-white/[0.04] px-3 py-3 text-center">
      <div className={"flex items-center justify-center gap-1 text-lg font-bold leading-none tabular-nums " + color}>
        {ton && value !== "—" && <TonIcon size={14} />}
        {value}
      </div>
      <div className="mt-1.5 text-[11px] font-medium text-neutral-500">{label}</div>
    </div>
  );
}
