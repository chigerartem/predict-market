import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fetchMe, fetchCaseState, caseOpen, type CaseState, type CasePrize, type CaseSpinResult, type CaseSpinRow } from "../realapi";
import { fmtTon } from "../format";
import { useT } from "../i18n";
import Lottie from "../components/Lottie";
import TonIcon from "../components/TonIcon";

// «Кейсы» — мгновенная игра в стиле открытия кейсов CS:GO. Игрок ставит ЛЮБУЮ сумму и
// крутит; лента множителей едет и тормозит на выпавшем — приз = ставка × множитель.
// Исходы: либо «пусто» (ставка теряется), либо реальный икс (≥2×) — без частичных
// возвратов. Деньги авторитетны на сервере (provably-fair commit+nonce, как в Костях).
//
// Анимация — НЕ lottie: лента это flex-строка карточек, едет одним transform:translateX
// с ease-out. На каждый спин строим свежую ленту, выигрышная карта стоит у конца
// (WIN_INDEX); сбрасываем transform в 0 без перехода, reflow, едем к цели. Стоп — по
// transitionend трека (страховка — fallback-таймер). Раскладка — как в Костях: сцена по
// центру (заполняет экран), панель прижата к низу, клавиатурный clip-слой по rAF.

const CARD_W = 78;
const GAP = 8;
const STRIDE = CARD_W + GAP;
const REEL_LEN = 64;
const WIN_INDEX = 58;
const DUR_MS = 5400;
const FALLBACK_MS = DUR_MS + 500;
// Визуальные веса наполнителя ленты (НЕ реальные шансы — те на сервере): лента яркая,
// «пусто» мелькает редко, иксы преобладают. Порядок = тиры приза (low→high).
const VIS_WEIGHTS = [14, 28, 26, 18, 9, 5];

const TOP = "#1e1b4b"; // верх экрана = цвет плашки Telegram (глубокий индиго)
const BG_BOTTOM = "#0a0d18";

function haptic(style: "light" | "medium" | "heavy" | "rigid" | "soft") {
  try {
    (window.Telegram?.WebApp as { HapticFeedback?: { impactOccurred?: (s: string) => void } } | undefined)
      ?.HapticFeedback?.impactOccurred?.(style);
  } catch { /* нет поддержки */ }
}
function hapticNotify(type: "error" | "success" | "warning") {
  try {
    (window.Telegram?.WebApp as { HapticFeedback?: { notificationOccurred?: (t: string) => void } } | undefined)
      ?.HapticFeedback?.notificationOccurred?.(type);
  } catch { /* нет поддержки */ }
}

function normStake(raw: string): string {
  let s = raw.replace(",", ".").replace(/[^\d.]/g, "");
  const i = s.indexOf(".");
  if (i >= 0) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, "");
  if (/^0\d/.test(s)) s = "0." + s.slice(1);
  return s;
}

const PRESETS = [0.1, 1, 5, 25];
type Rarity = CasePrize["rarity"];

// Палитра редкостей. Классы — ЛИТЕРАЛАМИ (Tailwind JIT не видит собранные строкой).
const RARITY: Record<Rarity, { from: string; border: string; text: string; bar: string; glow: string; chip: string; flash: string }> = {
  grey:   { from: "from-zinc-500/20",    border: "border-zinc-500/50",    text: "text-zinc-200",    bar: "bg-zinc-400",    glow: "",                                         chip: "bg-zinc-500/20 text-zinc-300",       flash: "rgba(161,161,170,0.0)" },
  blue:   { from: "from-sky-500/25",     border: "border-sky-400/70",     text: "text-sky-200",     bar: "bg-sky-400",     glow: "shadow-[0_0_14px_rgba(56,189,248,0.45)]",  chip: "bg-sky-500/20 text-sky-200",         flash: "rgba(56,189,248,0.35)" },
  purple: { from: "from-violet-500/30",  border: "border-violet-400/80",  text: "text-violet-100",  bar: "bg-violet-400",  glow: "shadow-[0_0_16px_rgba(167,139,250,0.5)]",  chip: "bg-violet-500/20 text-violet-200",   flash: "rgba(167,139,250,0.4)" },
  pink:   { from: "from-fuchsia-500/30", border: "border-fuchsia-400/80", text: "text-fuchsia-100", bar: "bg-fuchsia-400", glow: "shadow-[0_0_16px_rgba(232,121,249,0.5)]",  chip: "bg-fuchsia-500/20 text-fuchsia-200", flash: "rgba(232,121,249,0.45)" },
  red:    { from: "from-rose-500/30",    border: "border-rose-400/90",    text: "text-rose-100",    bar: "bg-rose-400",    glow: "shadow-[0_0_18px_rgba(251,113,133,0.55)]", chip: "bg-rose-500/20 text-rose-200",       flash: "rgba(251,113,133,0.5)" },
  gold:   { from: "from-amber-400/35",   border: "border-amber-300",      text: "text-amber-100",   bar: "bg-amber-300",   glow: "shadow-[0_0_24px_rgba(251,191,36,0.65)]",  chip: "bg-amber-400/25 text-amber-100",     flash: "rgba(251,191,36,0.55)" },
};

type Card = { rarity: Rarity; multMilli: number };

const multX = (milli: number) => {
  const x = milli / 1000;
  return (Number.isInteger(x) ? String(x) : x.toFixed(1)) + "×";
};
const tierLabel = (milli: number) => (milli === 0 ? "—" : multX(milli));

// Карточка в ленте: «пусто» — тёмная с прочерком; икс — градиент-тинт + рамка/свечение
// по редкости, в центре «×N».
function ReelCard({ card, highlight }: { card: Card; highlight?: boolean }) {
  const r = RARITY[card.rarity];
  const miss = card.multMilli === 0;
  if (miss) {
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03]"
        style={{ width: CARD_W, height: 92 }}
      >
        <span className="text-2xl font-black text-white/15">—</span>
      </div>
    );
  }
  return (
    <div
      className={
        "relative flex shrink-0 items-center justify-center rounded-xl border bg-gradient-to-b to-black/20 " +
        r.from + " " + r.border + " " + (highlight ? "scale-105 " + r.glow : "")
      }
      style={{ width: CARD_W, height: 92, transition: "transform 150ms ease-out" }}
    >
      <span className={"absolute inset-x-0 top-0 h-1 rounded-t-xl " + r.bar} />
      <span className={"text-[18px] font-black tabular-nums " + r.text}>{multX(card.multMilli)}</span>
    </div>
  );
}

// Арт кейса над лентой — светящийся бокс (gift-лотти) с пульсирующим ореолом. Заполняет
// верх сцены и даёт фокус (чтобы экран не был пустым).
const CaseArt = memo(function CaseArt() {
  return (
    <div className="relative grid place-items-center">
      <div
        className="pointer-events-none absolute h-36 w-36 rounded-full blur-2xl animate-pulse"
        style={{ background: "radial-gradient(circle, rgba(251,191,36,0.35), rgba(167,139,250,0.20) 55%, transparent 72%)", animationDuration: "3s" }}
      />
      <Lottie src="/lottie/gift.json" className="relative h-24 w-24 drop-shadow-[0_6px_20px_rgba(167,139,250,0.4)]" />
    </div>
  );
});

const SPARKS = [
  { l: 8, t: 14, s: 2, d: "0s" }, { l: 22, t: 34, s: 1, d: "0.6s" }, { l: 35, t: 9, s: 1, d: "1.2s" },
  { l: 48, t: 26, s: 2, d: "0.3s" }, { l: 63, t: 12, s: 1, d: "0.9s" }, { l: 78, t: 30, s: 2, d: "1.5s" },
  { l: 90, t: 18, s: 1, d: "0.4s" }, { l: 14, t: 70, s: 1, d: "1.1s" }, { l: 72, t: 66, s: 1, d: "0.7s" },
  { l: 86, t: 74, s: 2, d: "0.2s" }, { l: 30, t: 78, s: 1, d: "1.4s" }, { l: 55, t: 72, s: 1, d: "0.8s" },
];
const Sparkles = memo(function Sparkles() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {SPARKS.map((s, i) => (
        <span key={i} className="absolute rounded-full bg-white/60 animate-pulse"
          style={{ left: `${s.l}%`, top: `${s.t}%`, width: s.s, height: s.s, animationDelay: s.d, animationDuration: "2.4s" }} />
      ))}
    </div>
  );
});

export default function CaseGame({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [st, setSt] = useState<CaseState | null>(null);
  const [balanceNano, setBalanceNano] = useState(0);
  const [stake, setStake] = useState("0.1");
  const [reel, setReel] = useState<Card[]>([]);
  const [spinSeq, setSpinSeq] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ rarity: Rarity; multMilli: number; payout: number } | null>(null);
  const [recent, setRecent] = useState<CaseSpinRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const clipRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<CaseSpinResult | null>(null);
  const settledRef = useRef(true);
  const fallbackRef = useRef<number>(0);
  const flashTimer = useRef<number>(0);

  const minNano = st?.min_stake_nano ?? 100_000_000;

  // Клавиатура: ужимаем ВНУТРЕННИЙ clip-слой по rAF (корень стабильно-тёмный во весь
  // экран). ПЕРВЫЙ sync — синхронно до первого paint (useLayoutEffect), иначе первый
  // кадр по инлайновой --app-h, а следующий по innerHeight → экран «доводится на место»
  // при входе из Games. Дальше rAF держит синхрон под клавиатуру (приём Костей/Ракеты).
  useLayoutEffect(() => {
    const vv = window.visualViewport;
    const el = clipRef.current;
    if (!vv || !el) return;
    let raf = 0, lastH = -1, lastT = -1;
    const sync = () => {
      const ae = document.activeElement as HTMLElement | null;
      const focused = !!ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA");
      const h = focused ? Math.round(vv.height) : Math.round(window.innerHeight);
      const tY = focused ? Math.round(vv.offsetTop) : 0;
      if (h !== lastH || tY !== lastT) {
        el.style.height = h + "px";
        el.style.transform = tY ? `translateY(${tY}px)` : "";
        lastH = h; lastT = tY;
      }
    };
    sync(); // синхронно до первого paint
    const loop = () => { sync(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const reloadBalance = useCallback(() => {
    fetchMe().then((m) => setBalanceNano(m.balance_nano)).catch(() => {});
  }, []);

  const randomCard = useCallback((prizes: CasePrize[]): Card => {
    const w = prizes.map((_, i) => VIS_WEIGHTS[i] ?? 1);
    const total = w.reduce((a, b) => a + b, 0);
    let x = Math.random() * total;
    for (let i = 0; i < prizes.length; i++) {
      x -= w[i];
      if (x < 0) return { rarity: prizes[i].rarity, multMilli: prizes[i].mult_milli };
    }
    const last = prizes[prizes.length - 1];
    return { rarity: last.rarity, multMilli: last.mult_milli };
  }, []);

  useEffect(() => {
    reloadBalance();
    fetchCaseState()
      .then((s) => {
        setSt(s);
        setRecent(s.recent ?? []);
        setReel(Array.from({ length: REEL_LEN }, () => randomCard(s.prizes)));
      })
      .catch(() => {});
  }, [reloadBalance, randomCard]);

  useEffect(() => {
    const bb = (window.Telegram?.WebApp as { BackButton?: { show?: () => void; hide?: () => void; onClick?: (cb: () => void) => void; offClick?: (cb: () => void) => void } } | undefined)?.BackButton;
    if (!bb) return;
    bb.show?.();
    bb.onClick?.(onClose);
    return () => { bb.offClick?.(onClose); bb.hide?.(); };
  }, [onClose]);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    const dark = () => { try { tg?.setHeaderColor?.(TOP); tg?.setBackgroundColor?.(BG_BOTTOM); } catch { /* старый клиент */ } };
    dark();
    document.addEventListener("focusin", dark);
    document.addEventListener("focusout", dark);
    return () => {
      document.removeEventListener("focusin", dark);
      document.removeEventListener("focusout", dark);
      try { tg?.setHeaderColor?.("#5CCBFF"); tg?.setBackgroundColor?.("#5CCBFF"); } catch { /* старый клиент */ }
    };
  }, []);

  useEffect(() => {
    if (!err) return;
    const tm = window.setTimeout(() => setErr(null), 2500);
    return () => window.clearTimeout(tm);
  }, [err]);

  useEffect(() => () => { window.clearTimeout(fallbackRef.current); window.clearTimeout(flashTimer.current); }, []);

  const finalize = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    window.clearTimeout(fallbackRef.current);
    const res = resultRef.current;
    if (!res) return;
    setBalanceNano(res.balance_nano);
    setResult({ rarity: res.rarity, multMilli: res.mult_milli, payout: res.payout_nano });
    setSpinning(false);
    const win = res.payout_nano > 0;
    hapticNotify(win ? "success" : "error");
    if (win) {
      haptic("rigid");
      setFlash(RARITY[res.rarity].flash);
      window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlash(null), 650);
    }
    setRecent((prev) => [{
      id: res.spin_id, nonce: res.nonce, stake_nano: res.stake_nano, prize_index: res.prize_index,
      rarity: res.rarity, mult_milli: res.mult_milli, payout_nano: res.payout_nano,
      created_at: new Date().toISOString(),
    }, ...prev].slice(0, 20));
  }, []);

  useLayoutEffect(() => {
    if (spinSeq === 0 || !spinning) return;
    const track = trackRef.current, vp = viewportRef.current;
    if (!track || !vp) return;
    const w = vp.clientWidth;
    const jitter = (Math.random() - 0.5) * CARD_W * 0.6;
    const target = w / 2 - (WIN_INDEX * STRIDE + CARD_W / 2) + jitter;

    track.style.transition = "none";
    track.style.transform = "translateX(0px)";
    void track.offsetWidth;
    track.style.transition = `transform ${DUR_MS}ms cubic-bezier(0.10, 0.82, 0.16, 1)`;
    track.style.transform = `translateX(${target}px)`;

    const onEnd = (e: TransitionEvent) => { if (e.propertyName === "transform") finalize(); };
    track.addEventListener("transitionend", onEnd);
    window.clearTimeout(fallbackRef.current);
    fallbackRef.current = window.setTimeout(finalize, FALLBACK_MS);
    return () => track.removeEventListener("transitionend", onEnd);
  }, [spinSeq, spinning, finalize]);

  const balanceTon = balanceNano / 1e9;
  const canSpin = !!st && !spinning && !pending && (Number(stake) || 0) > 0;

  const spin = async () => {
    if (!st || spinning || pending) return;
    const nano = Math.round((Number(stake) || 0) * 1e9);
    if (nano < minNano) { setErr(t("case.min", { n: fmtTon(minNano / 1e9) })); return; }
    if (nano > balanceNano) { setErr(t("case.insufficient")); return; }
    setErr(null);
    setResult(null);
    setFlash(null);
    setPending(true);
    haptic("medium");
    try {
      const res = await caseOpen(nano);
      resultRef.current = res;
      const next = Array.from({ length: REEL_LEN }, () => randomCard(st.prizes));
      next[WIN_INDEX] = { rarity: res.rarity, multMilli: res.mult_milli };
      setReel(next);
      settledRef.current = false;
      setSpinning(true);
      setSpinSeq((k) => k + 1);
      setPending(false);
      haptic("rigid");
    } catch (e) {
      setPending(false);
      setSpinning(false);
      setErr(e instanceof Error ? e.message : String(e));
      hapticNotify("error");
    }
  };

  return (
    <div className="fixed left-0 top-0 z-50 w-full overflow-hidden text-white" style={{ height: "var(--app-h, 100dvh)", background: BG_BOTTOM }}>
      <div ref={clipRef} className="absolute inset-x-0 top-0 overflow-hidden" style={{ height: "var(--app-h, 100dvh)" }}>
        {/* Фон: индиго-градиент + искры */}
        <div className="pointer-events-none absolute inset-0" style={{ background: `linear-gradient(180deg, ${TOP} 0%, #16142e 42%, ${BG_BOTTOM} 100%)` }} />
        <Sparkles />

        {/* Вспышка на выигрыше */}
        <div
          className="pointer-events-none absolute inset-0 z-40 transition-opacity duration-700"
          style={{ background: flash ? `radial-gradient(60% 50% at 50% 42%, ${flash}, transparent 70%)` : "transparent", opacity: flash ? 1 : 0 }}
        />

        <div className="relative z-10 flex h-full flex-col overflow-hidden">
          {/* История дропов */}
          <div className="px-4 pb-1" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-white/50">{t("case.history")}</div>
            <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {recent.length === 0 && <span className="text-xs text-white/30">{t("case.noSpins")}</span>}
              {recent.map((r) => (
                <span key={r.id} className={"flex shrink-0 items-center rounded-md px-1.5 py-1 text-xs font-bold tabular-nums " + RARITY[r.rarity].chip}>
                  {tierLabel(r.mult_milli)}
                </span>
              ))}
            </div>
          </div>

          {/* Сцена по центру: арт кейса + лента + результат (заполняет экран, держится
              стабильно — clip-слой синхронит высоту, как в Костях). */}
          <div className="flex flex-1 flex-col items-center justify-center overflow-hidden">
            <CaseArt />

            {/* Лента-«окно» в рамке */}
            <div
              ref={viewportRef}
              className="relative mx-3 my-6 w-[calc(100%-1.5rem)] overflow-hidden rounded-2xl bg-black/30 ring-1 ring-white/10"
              style={{ height: 116, boxShadow: "inset 0 0 30px rgba(0,0,0,0.5)" }}
            >
              {/* спотлайт за лентой */}
              <div className="pointer-events-none absolute inset-0 z-0" style={{ background: "radial-gradient(60% 80% at 50% 50%, rgba(167,139,250,0.18), transparent 72%)" }} />
              <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-12 bg-gradient-to-r from-black/60 to-transparent" />
              <div className="pointer-events-none absolute inset-y-0 right-0 z-20 w-12 bg-gradient-to-l from-black/60 to-transparent" />
              {/* центральный неон-указатель */}
              <div className="pointer-events-none absolute inset-y-1 left-1/2 z-30 -ml-px w-0.5 bg-amber-300 shadow-[0_0_14px_3px_rgba(252,211,77,0.7)]" />
              <div className="pointer-events-none absolute left-1/2 top-0 z-30 -ml-2 h-0 w-0 border-x-8 border-t-[9px] border-x-transparent border-t-amber-300" />
              <div className="pointer-events-none absolute bottom-0 left-1/2 z-30 -ml-2 h-0 w-0 border-x-8 border-b-[9px] border-x-transparent border-b-amber-300" />
              {/* трек */}
              <div ref={trackRef} className="absolute top-1/2 left-0 z-10 flex -translate-y-1/2 will-change-transform" style={{ gap: GAP }}>
                {reel.map((c, i) => (
                  <ReelCard key={`${spinSeq}-${i}`} card={c} highlight={!spinning && i === WIN_INDEX} />
                ))}
              </div>
            </div>

            {/* Результат */}
            <div className="pointer-events-none flex h-14 flex-col items-center justify-center">
              {!spinning && result ? (
                result.payout > 0 ? (
                  <>
                    <div className={"flex items-center gap-1.5 text-[34px] font-black leading-none tabular-nums drop-shadow-[0_0_18px_currentColor] " + RARITY[result.rarity].text}>
                      <TonIcon size={26} />+{fmtTon(result.payout / 1e9)}
                    </div>
                    <div className={"mt-1 text-sm font-bold " + RARITY[result.rarity].text}>
                      {t("case.youWon")} · {multX(result.multMilli)}
                    </div>
                  </>
                ) : (
                  <div className="text-base font-semibold text-white/45">{t("case.empty")}</div>
                )
              ) : !spinning && !pending ? (
                <div className="text-sm font-medium text-white/45">{t("case.tapToOpen")}</div>
              ) : null}
            </div>
          </div>

          {/* Нижняя панель */}
          <div className="border-t border-white/10 bg-[#0c0a1c] px-4 pb-3 pt-3">
            {err && <p className="mb-2 text-center text-xs text-rose-400">{err}</p>}

            {/* Что внутри */}
            <div className="mb-2.5">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-white/40">{t("case.contents")}</div>
              <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {(st?.prizes ?? []).map((p, i) => (
                  <span key={i} className={"flex shrink-0 items-center rounded-lg px-2 py-1 text-xs font-bold tabular-nums " + RARITY[p.rarity].chip}>
                    {tierLabel(p.mult_milli)}
                  </span>
                ))}
              </div>
            </div>

            {/* Ставка */}
            <div className="mb-2 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] pl-3.5 pr-2">
              <TonIcon size={18} />
              <input
                inputMode="decimal"
                value={stake}
                onChange={(e) => setStake(normStake(e.target.value))}
                className="min-w-0 flex-1 bg-transparent py-3 text-base tabular-nums outline-none placeholder:text-white/30"
                placeholder="0.0"
                disabled={spinning}
              />
              <button
                onClick={() => setStake(balanceTon > 0 ? String(Math.floor(balanceTon * 100) / 100) : "0")}
                disabled={spinning}
                className="flex shrink-0 items-center gap-1 rounded-xl bg-white/10 px-2.5 py-1.5 text-sm font-bold tabular-nums text-white/80 active:scale-95 disabled:opacity-40"
              >
                <TonIcon size={13} />
                {fmtTon(balanceTon)}
              </button>
            </div>

            <div className="mb-2.5 grid grid-cols-4 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => setStake(String(p))}
                  disabled={spinning}
                  className="rounded-xl border border-white/10 bg-white/[0.05] py-2.5 text-sm font-bold tabular-nums text-amber-300 active:scale-95 disabled:opacity-40"
                >
                  {p}
                </button>
              ))}
            </div>

            <button
              onClick={spin}
              disabled={!canSpin}
              className="w-full rounded-2xl bg-gradient-to-r from-amber-400 to-orange-600 py-4 text-base font-black text-white shadow-lg shadow-orange-500/30 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pending || spinning ? t("case.opening") : `${t("case.open")} · ${fmtTon(Number(stake) || 0)} TON`}
            </button>

            <div className="mt-2 truncate text-center text-[10px] text-white/25">
              {t("case.fair")} · {st?.server_seed_hash ? `🔒 ${st.server_seed_hash.slice(0, 16)}…` : ""} · #{st?.nonce ?? 0}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
