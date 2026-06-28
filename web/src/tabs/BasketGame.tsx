import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fetchMe, fetchBasketState, basketThrow, type BasketState, type BasketThrowResult, type BasketThrowRow } from "../realapi";
import { fmtTon } from "../format";
import { useT } from "../i18n";
import Lottie from "../components/Lottie";
import TonIcon from "../components/TonIcon";
import { getLottieData } from "../lottieCache";

// «Баскетбол» — мгновенная игра: ставишь любую сумму и бросаешь мяч. Сервер тянет один из
// 5 исходов по редкости (3 промаха + 2 попадания) и отдаёт КОНКРЕТНУЮ 🏀-анимацию — фронт
// её играет; попал = выигрыш (ставка × множитель тира), мимо = ставка теряется. Деньги
// авторитетны на сервере. Авто-броски — как в Костях. Фон — баскетбольный зал в перспективе;
// камера во время броска ПРИВЯЗАНА К КАДРАМ анимации (onFrame) и едет за мячом по дуге
// (наезд + проводка вниз в корзину), после — отъезд назад.

const MIN_NANO = 100_000_000;
const PRESETS = [0.1, 1, 5, 25];
const IDLE_ANIM = "basket-hit-1";
const THROW_SPEED = 1.15;
const AUTO_THROW_SPEED = 1.7;
const AUTO_PAUSE_MS = 500;
const THROW_FALLBACK_MS = 3400;
const CAM_ZOOM = 1.5;  // наезд камеры к концу броска
const CAM_DOWN = 34;   // px, проводка камеры вниз за мячом (в корзину)

const TOP = "#06070e";
const BG_BOTTOM = "#06070e";

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

const fmtMult = (milli: number) => (milli / 1000).toFixed(milli % 1000 === 0 ? 0 : milli % 100 === 0 ? 1 : 2);

// ── Баскетбольный зал (процедурный SVG, 1-точечная перспектива). ШИРОКИЙ корт: дальний
//    край (лицевая) широкий, перспектива не «коридором». Пол, задняя стена со щитом,
//    боковые трибуны, потолок — к точке схода у кольца. Разметка, спот, виньетка.
const VP = { x: 180, y: 200 };
const FLOOR = "-110,660 470,660 290,300 70,300";
const FARWALL = "70,120 290,120 290,300 70,300";
const LWALL = "-110,-40 70,120 70,300 -110,660";
const RWALL = "470,-40 290,120 290,300 470,660";
const CEIL = "-110,-40 470,-40 290,120 70,120";
const PLANKS = Array.from({ length: 17 }, (_, i) => -130 + (i / 16) * 620);
const BasketCourt = memo(function BasketCourt() {
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 360 640" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id="bWood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3f2a14" /><stop offset="0.55" stopColor="#6e4a23" /><stop offset="1" stopColor="#a4703a" />
        </linearGradient>
        <linearGradient id="bLwall" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0a0e1c" /><stop offset="1" stopColor="#1a2138" />
        </linearGradient>
        <linearGradient id="bRwall" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#0a0e1c" /><stop offset="1" stopColor="#1a2138" />
        </linearGradient>
        <linearGradient id="bFar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1d3a61" /><stop offset="1" stopColor="#0e2138" />
        </linearGradient>
        <radialGradient id="bLight" cx="0.5" cy="0" r="0.75">
          <stop offset="0" stopColor="#cfe0ff" stopOpacity="0.20" /><stop offset="1" stopColor="#cfe0ff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="bSpot" cx="0.5" cy="0.64" r="0.62">
          <stop offset="0" stopColor="#ffd28c" stopOpacity="0.30" /><stop offset="0.55" stopColor="#ffb95e" stopOpacity="0.08" /><stop offset="1" stopColor="#ffb95e" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="bVig" cx="0.5" cy="0.5" r="0.78">
          <stop offset="0.56" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.6" />
        </radialGradient>
        <clipPath id="bFloorClip"><polygon points={FLOOR} /></clipPath>
      </defs>

      <rect x="0" y="0" width="360" height="640" fill="#06070e" />
      <polygon points={CEIL} fill="#070912" />
      <polygon points={LWALL} fill="url(#bLwall)" />
      <polygon points={RWALL} fill="url(#bRwall)" />
      <g stroke="#ffffff" strokeOpacity="0.045" strokeWidth="1">
        <line x1="-110" y1="120" x2="70" y2="165" /><line x1="-110" y1="340" x2="70" y2="230" /><line x1="-110" y1="560" x2="70" y2="282" />
        <line x1="470" y1="120" x2="290" y2="165" /><line x1="470" y1="340" x2="290" y2="230" /><line x1="470" y1="560" x2="290" y2="282" />
      </g>
      <polygon points={FARWALL} fill="url(#bFar)" />
      <rect x="70" y="108" width="220" height="74" fill="url(#bLight)" />

      <polygon points={FLOOR} fill="url(#bWood)" />
      <g clipPath="url(#bFloorClip)" stroke="#ffffff" fill="none">
        <g stroke="#000000" strokeOpacity="0.17" strokeWidth="2">
          {PLANKS.map((xb, i) => <line key={i} x1={xb} y1={660} x2={VP.x} y2={VP.y} />)}
        </g>
        <g stroke="#ffe6c0" strokeOpacity="0.08" strokeWidth="1">
          {PLANKS.map((xb, i) => <line key={i} x1={xb + 10} y1={660} x2={VP.x + 1} y2={VP.y} />)}
        </g>
        <path d="M 40 300 Q 180 596 320 300" strokeOpacity="0.5" strokeWidth="3" />
        <polygon points="155,300 205,300 251,486 109,486" fill="#c2410c" fillOpacity="0.20" stroke="none" />
        <polygon points="155,300 205,300 251,486 109,486" strokeOpacity="0.55" strokeWidth="3" />
        <line x1="109" y1="486" x2="251" y2="486" strokeOpacity="0.55" strokeWidth="3" />
        <ellipse cx="180" cy="486" rx="71" ry="22" strokeOpacity="0.45" strokeWidth="3" />
      </g>
      <g stroke="#ffffff" fill="none" strokeWidth="2">
        <line x1="70" y1="300" x2="290" y2="300" strokeOpacity="0.5" />
        <line x1="70" y1="300" x2="-110" y2="660" strokeOpacity="0.26" />
        <line x1="290" y1="300" x2="470" y2="660" strokeOpacity="0.26" />
      </g>

      <ellipse cx="180" cy="440" rx="250" ry="190" fill="url(#bSpot)" />
      <rect x="0" y="0" width="360" height="640" fill="url(#bVig)" />
    </svg>
  );
});

function Switch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onToggle}
      className={"relative h-6 w-11 shrink-0 rounded-full transition-colors " + (on ? "bg-orange-400" : "bg-white/15")}>
      <span className={"absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all " + (on ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}

type Phase = "idle" | "throwing" | "revealed";

export default function BasketGame({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [st, setSt] = useState<BasketState | null>(null);
  const [balanceNano, setBalanceNano] = useState(0);
  const [stake, setStake] = useState("0.1");
  const [phase, setPhase] = useState<Phase>("idle");
  const [throwSeq, setThrowSeq] = useState(0);
  const [throwAnim, setThrowAnim] = useState("basket-miss-1");
  const [throwSpeed, setThrowSpeed] = useState(THROW_SPEED);
  const [pending, setPending] = useState(false);
  const [auto, setAuto] = useState(false);
  const [result, setResult] = useState<{ hit: boolean; payout: number; mult: number } | null>(null);
  const [recent, setRecent] = useState<BasketThrowRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const clipRef = useRef<HTMLDivElement>(null);
  const courtRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<BasketThrowResult | null>(null);
  const settledRef = useRef(true);
  const fallbackRef = useRef<number>(0);
  const autoRef = useRef(auto);
  autoRef.current = auto;
  const shootRef = useRef<() => void>(() => {});

  const minNano = st?.min_stake_nano ?? MIN_NANO;
  const chancePct = (st?.hit_prob_bp ?? 5000) / 100;
  const scoreMults = (st?.scores ?? []).map((s) => fmtMult(s.mult_milli) + "×").join(" / ");

  useLayoutEffect(() => {
    const vv = window.visualViewport;
    const el = clipRef.current;
    if (!vv || !el) return;
    let raf = 0, lastKey = "";
    const sync = () => {
      const ae = document.activeElement as HTMLElement | null;
      const focused = !!ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA");
      if (focused) {
        const h = Math.round(vv.height), tY = Math.round(vv.offsetTop);
        const key = `f${h}_${tY}`;
        if (key !== lastKey) {
          el.style.height = h + "px";
          el.style.transform = tY ? `translateY(${tY}px)` : "";
          lastKey = key;
        }
      } else if (lastKey !== "s") {
        el.style.height = "var(--app-h, 100dvh)";
        el.style.transform = "";
        lastKey = "s";
      }
    };
    sync();
    const loop = () => { sync(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Камера: во время throwing КАЖДЫЙ кадр анимации (onThrowFrame) двигает зал — наезд +
  // проводка вниз за мячом, синхронно с лотти. Вне броска — плавный отъезд к исходному.
  useLayoutEffect(() => {
    const c = courtRef.current;
    if (!c) return;
    if (phase === "throwing") {
      c.style.transition = "none"; // кадры драйвят transform напрямую
    } else {
      c.style.transition = "transform 700ms cubic-bezier(0.3, 0, 0.2, 1)";
      c.style.transform = "translateY(0px) scale(1)";
    }
  }, [phase, throwSeq]);

  const onThrowFrame = useCallback((p: number) => {
    const c = courtRef.current;
    if (!c) return;
    const e = p * p; // ускоряемся к корзине
    const s = 1 + (CAM_ZOOM - 1) * e;
    const ty = CAM_DOWN * e;
    c.style.transform = `translateY(${ty}px) scale(${s})`;
  }, []);

  const reloadBalance = useCallback(() => {
    fetchMe().then((m) => setBalanceNano(m.balance_nano)).catch(() => {});
  }, []);

  useEffect(() => {
    reloadBalance();
    fetchBasketState()
      .then((s) => { setSt(s); setRecent(s.recent ?? []); })
      .catch(() => {});
  }, [reloadBalance]);

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

  useEffect(() => () => window.clearTimeout(fallbackRef.current), []);

  const finalize = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    window.clearTimeout(fallbackRef.current);
    const res = ctxRef.current;
    if (!res) return;
    setBalanceNano(res.balance_nano);
    setResult({ hit: res.hit, payout: res.payout_nano, mult: res.mult_milli });
    setPhase("revealed");
    hapticNotify(res.hit ? "success" : "error");
    if (res.hit) haptic("rigid");
    setRecent((prev) => [{
      id: res.throw_id, nonce: res.nonce, stake_nano: res.stake_nano, roll: res.roll,
      hit: res.hit, mult_milli: res.mult_milli, payout_nano: res.payout_nano,
      created_at: new Date().toISOString(),
    }, ...prev].slice(0, 20));
  }, []);

  const busy = pending || phase === "throwing";
  const balanceTon = balanceNano / 1e9;
  const canThrow = !!st && !busy && (Number(stake) || 0) > 0;
  const lock = busy || auto;

  const shoot = async () => {
    if (!st || busy) return;
    const nano = Math.round((Number(stake) || 0) * 1e9);
    if (nano < minNano) { setErr(t("basket.min", { n: fmtTon(minNano / 1e9) })); return; }
    if (nano > balanceNano) { setErr(t("basket.insufficient")); return; }
    setErr(null);
    setResult(null);
    setPending(true);
    haptic("medium");
    try {
      const res = await basketThrow(nano);
      ctxRef.current = res;
      setThrowAnim(res.anim);
      setThrowSpeed(autoRef.current ? AUTO_THROW_SPEED : THROW_SPEED);
      settledRef.current = false;
      setPhase("throwing");
      setThrowSeq((k) => k + 1);
      setPending(false);
      window.clearTimeout(fallbackRef.current);
      fallbackRef.current = window.setTimeout(finalize, THROW_FALLBACK_MS);
      haptic("rigid");
    } catch (e) {
      setPending(false);
      setPhase("idle");
      setAuto(false);
      setErr(e instanceof Error ? e.message : String(e));
      hapticNotify("error");
    }
  };
  shootRef.current = shoot;

  useEffect(() => {
    if (!auto || busy) return;
    const nano = Math.round((Number(stake) || 0) * 1e9);
    if (nano < minNano || nano > balanceNano) { setAuto(false); return; }
    const delay = phase === "revealed" ? AUTO_PAUSE_MS : 0;
    const id = window.setTimeout(() => shootRef.current(), delay);
    return () => window.clearTimeout(id);
  }, [auto, busy, phase, balanceNano, stake, minNano]);

  return (
    <div className="fixed left-0 top-0 z-50 w-full overflow-hidden text-white" style={{ height: "var(--app-h, 100dvh)", background: BG_BOTTOM }}>
      <div ref={clipRef} className="absolute inset-x-0 top-0 overflow-hidden" style={{ height: "var(--app-h, 100dvh)" }}>
        <div ref={courtRef} className="pointer-events-none absolute inset-0 will-change-transform" style={{ transformOrigin: "50% 30%" }}>
          <BasketCourt />
        </div>

        <div className="relative z-10 flex h-full flex-col overflow-hidden">
          <div className="px-4 pb-1" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-white/60 drop-shadow">{t("basket.history")}</div>
            <div className="flex min-h-[24px] items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {recent.length === 0 && <span className="text-xs text-white/40">{t("basket.noThrows")}</span>}
              {recent.map((r) => (
                <span
                  key={r.id}
                  className={
                    "flex shrink-0 items-center rounded-md px-1.5 py-1 text-xs font-bold tabular-nums " +
                    (r.hit ? "bg-emerald-500/30 text-emerald-100" : "bg-rose-500/30 text-rose-100")
                  }
                >
                  {r.hit ? `+${fmtTon(r.payout_nano / 1e9)}` : "✗"}
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-1 flex-col items-center justify-center overflow-hidden px-4">
            <div className="grid h-72 w-72 place-items-center drop-shadow-[0_10px_24px_rgba(0,0,0,0.55)]">
              {phase === "idle" ? (
                <Lottie
                  key="idle"
                  src={`/lottie/${IDLE_ANIM}.json`}
                  animationData={getLottieData(IDLE_ANIM)}
                  className="h-72 w-72"
                  loop={false}
                  autoplay={false}
                />
              ) : (
                <Lottie
                  key={`throw-${throwSeq}`}
                  src={`/lottie/${throwAnim}.json`}
                  className="h-72 w-72"
                  loop={false}
                  autoplay
                  speed={throwSpeed}
                  onFrame={onThrowFrame}
                  onComplete={finalize}
                />
              )}
            </div>

            <div className="pointer-events-none mt-1 flex h-14 flex-col items-center justify-center">
              {phase === "revealed" && result ? (
                result.hit ? (
                  <>
                    <div className="flex items-center gap-1.5 text-[32px] font-black leading-none tabular-nums text-orange-300 drop-shadow-[0_0_18px_rgba(251,146,60,0.7)]">
                      <TonIcon size={24} />+{fmtTon(result.payout / 1e9)}
                    </div>
                    <div className="mt-1 text-sm font-bold text-orange-300">{t("basket.score")} · {fmtMult(result.mult)}×</div>
                  </>
                ) : (
                  <div className="text-base font-semibold text-white/55">{t("basket.miss")}</div>
                )
              ) : phase === "idle" && !busy ? (
                <div className="text-sm font-medium text-white/55">{t("basket.tapToThrow")}</div>
              ) : null}
            </div>
          </div>

          <div className="border-t border-white/10 bg-[#0b0e16]/95 px-4 pb-3 pt-3 backdrop-blur-sm">
            {err && <p className="mb-2 text-center text-xs text-rose-400">{err}</p>}

            <div className="mb-2 flex items-center justify-center gap-3 text-[11px] font-medium text-white/55">
              <span>{t("basket.chance")} {chancePct.toFixed(0)}%</span>
              <span className="h-1 w-1 rounded-full bg-white/30" />
              <span className="text-orange-300">{scoreMults || "—"}</span>
            </div>

            <div className="mb-2 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] pl-3.5 pr-2">
              <TonIcon size={18} />
              <input
                inputMode="decimal"
                value={stake}
                onChange={(e) => setStake(normStake(e.target.value))}
                className="min-w-0 flex-1 bg-transparent py-3 text-base tabular-nums outline-none placeholder:text-white/30"
                placeholder="0.0"
                disabled={lock}
              />
              <button
                onClick={() => setStake(balanceTon > 0 ? String(Math.floor(balanceTon * 100) / 100) : "0")}
                disabled={lock}
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
                  disabled={lock}
                  className="rounded-xl border border-white/10 bg-white/[0.05] py-2.5 text-sm font-bold tabular-nums text-orange-300 active:scale-95 disabled:opacity-40"
                >
                  {p}
                </button>
              ))}
            </div>

            <div className="mb-2 flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5">
              <span className="flex items-center gap-2 text-sm font-semibold text-white/80">
                <svg viewBox="0 0 24 24" className="h-4 w-4 text-orange-300" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
                </svg>
                {t("basket.auto")}
              </span>
              <Switch on={auto} onToggle={() => setAuto((a) => !a)} />
            </div>

            <button
              onClick={auto ? () => setAuto(false) : shoot}
              disabled={!auto && !canThrow}
              className={
                "w-full rounded-2xl py-4 text-base font-black text-white shadow-lg transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 " +
                (auto ? "border border-white/15 bg-white/[0.08]" : "bg-gradient-to-r from-orange-400 to-orange-600 shadow-orange-500/30")
              }
            >
              {auto ? t("basket.stop") : busy ? t("basket.throwing") : `${t("basket.throw")} · ${fmtTon(Number(stake) || 0)} TON`}
            </button>

            <div className="mt-2 truncate text-center text-[10px] text-white/30">
              {t("basket.fair")} · {st?.server_seed_hash ? `🔒 ${st.server_seed_hash.slice(0, 16)}…` : ""} · #{st?.nonce ?? 0}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
