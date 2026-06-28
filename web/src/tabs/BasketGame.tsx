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
// авторитетны на сервере (provably-fair commit+nonce). Авто-броски — как в Костях (тумблер,
// крутит сам пока есть деньги, чуть быстрее). Фон — нарисованная баскетбольная площадка.

const MIN_NANO = 100_000_000; // 0.1 TON
const PRESETS = [0.1, 1, 5, 25];
const IDLE_ANIM = "basket-hit-1"; // первый кадр = мяч готов; кэшируется → мгновенный покой
const THROW_SPEED = 1.15;     // обычный бросок ~3с → ~2.6с
const AUTO_THROW_SPEED = 1.7; // авто-бросок заметно быстрее
const AUTO_PAUSE_MS = 500;    // пауза показа результата между авто-бросками
const THROW_FALLBACK_MS = 3400;

const TOP = "#0a0d18"; // верх экрана = тёмный верх площадки (плашка TG сливается)
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

const fmtMult = (milli: number) => (milli / 1000).toFixed(milli % 1000 === 0 ? 0 : milli % 100 === 0 ? 1 : 2);

// ── Баскетбольная площадка (процедурный SVG, не картинка). Вид от лица бросающего:
//    деревянный пол уходит В ПЕРСПЕКТИВЕ к щиту наверху, разметка (краска, дуга, круг
//    штрафного) сходится к точке схода. Доски пола = линии к точке схода. Тёплый спот.
const VP = { x: 180, y: 118 };  // точка схода (≈ где висит щит)
const HZ = 288;                  // линия пола под щитом (дальний край)
const FLOOR = "-70,660 430,660 249,288 111,288"; // трапеция пола (с запасом за края)
const PLANKS = Array.from({ length: 15 }, (_, i) => -90 + (i / 14) * 540); // x низа досок
const BasketCourt = memo(function BasketCourt() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 360 640" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id="arena" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0a0d18" />
          <stop offset="0.45" stopColor="#15110b" />
          <stop offset="1" stopColor="#23180d" />
        </linearGradient>
        <linearGradient id="wood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3f2a14" />
          <stop offset="0.55" stopColor="#6e4a23" />
          <stop offset="1" stopColor="#a4703a" />
        </linearGradient>
        <radialGradient id="spot" cx="0.5" cy="0.62" r="0.6">
          <stop offset="0" stopColor="#ffd28c" stopOpacity="0.30" />
          <stop offset="0.55" stopColor="#ffb95e" stopOpacity="0.08" />
          <stop offset="1" stopColor="#ffb95e" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="vig" cx="0.5" cy="0.5" r="0.75">
          <stop offset="0.6" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.55" />
        </radialGradient>
        <clipPath id="floorClip"><polygon points={FLOOR} /></clipPath>
      </defs>

      {/* зал (фон) + деревянный пол */}
      <rect x="0" y="0" width="360" height="640" fill="url(#arena)" />
      <polygon points={FLOOR} fill="url(#wood)" />

      {/* всё, что на полу — клипуем по трапеции */}
      <g clipPath="url(#floorClip)" stroke="#ffffff" fill="none">
        {/* доски: линии к точке схода */}
        <g stroke="#000000" strokeOpacity="0.18" strokeWidth="2">
          {PLANKS.map((xb, i) => <line key={i} x1={xb} y1={660} x2={VP.x} y2={VP.y} />)}
        </g>
        {/* блик-полоса вдоль досок */}
        <g stroke="#ffe6c0" strokeOpacity="0.10" strokeWidth="1">
          {PLANKS.map((xb, i) => <line key={i} x1={xb + 9} y1={660} x2={VP.x + 1} y2={VP.y} />)}
        </g>
        {/* трёхочковая дуга */}
        <path d="M 96 288 Q 180 566 264 288" strokeOpacity="0.55" strokeWidth="3" />
        {/* краска (трапеция от щита к штрафной) */}
        <polygon points="156,288 204,288 231,474 129,474" fill="#c2410c" fillOpacity="0.22" stroke="none" />
        <polygon points="156,288 204,288 231,474 129,474" strokeOpacity="0.6" strokeWidth="3" />
        {/* линия штрафного + круг (сплюснут перспективой) */}
        <line x1="129" y1="474" x2="231" y2="474" strokeOpacity="0.6" strokeWidth="3" />
        <ellipse cx="180" cy="474" rx="51" ry="17" strokeOpacity="0.5" strokeWidth="3" />
        {/* лицевая (под щитом) */}
        <line x1="111" y1="288" x2="249" y2="288" strokeOpacity="0.5" strokeWidth="3" />
      </g>

      {/* свет на площадке + виньетка по краям */}
      <ellipse cx="180" cy="430" rx="230" ry="180" fill="url(#spot)" />
      <rect x="0" y="0" width="360" height="640" fill="url(#vig)" />
    </svg>
  );
});

// Тумблер (как в Костях).
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
  const [throwSpeed, setThrowSpeed] = useState(THROW_SPEED); // захвачена на старте броска
  const [pending, setPending] = useState(false);
  const [auto, setAuto] = useState(false);
  const [result, setResult] = useState<{ hit: boolean; payout: number; mult: number } | null>(null);
  const [recent, setRecent] = useState<BasketThrowRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const clipRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<BasketThrowResult | null>(null);
  const settledRef = useRef(true);
  const fallbackRef = useRef<number>(0);
  const autoRef = useRef(auto);
  autoRef.current = auto; // свежее значение для захвата скорости в shoot()
  const shootRef = useRef<() => void>(() => {});

  const minNano = st?.min_stake_nano ?? MIN_NANO;
  const chancePct = (st?.hit_prob_bp ?? 5000) / 100;
  const scoreMults = (st?.scores ?? []).map((s) => fmtMult(s.mult_milli) + "×").join(" / ");

  // Высота clip-слоя до первого paint (useLayoutEffect), расфокус = стабильная --app-h,
  // фокус = visualViewport (клавиатура). Как в Костях — без «доводки» при входе.
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
      setThrowSpeed(autoRef.current ? AUTO_THROW_SPEED : THROW_SPEED); // скорость захвачена на старте
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
      setAuto(false); // ошибка → выключаем авто, чтобы не долбить ею
      setErr(e instanceof Error ? e.message : String(e));
      hapticNotify("error");
    }
  };
  shootRef.current = shoot;

  // Авто-цикл: пока тумблер включён и хватает денег — бросаем сами. Из покоя (delay 0) и
  // после каждого результата (короткая пауза). Стоп — денег не хватает или юзер выключил.
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
        <BasketCourt />

        <div className="relative z-10 flex h-full flex-col overflow-hidden">
          {/* История (высота зарезервирована) */}
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

          {/* Сцена: мяч/кольцо по центру над площадкой */}
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

          {/* Нижняя панель */}
          <div className="border-t border-white/10 bg-[#100c08]/95 px-4 pb-3 pt-3 backdrop-blur-sm">
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

            {/* Авто-броски */}
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
