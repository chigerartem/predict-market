import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fetchMe, fetchBasketState, basketThrow, type BasketState, type BasketThrowResult, type BasketThrowRow } from "../realapi";
import { fmtTon } from "../format";
import { useT } from "../i18n";
import Lottie from "../components/Lottie";
import TonIcon from "../components/TonIcon";
import { getLottieData } from "../lottieCache";

// «Баскетбол» — мгновенная игра: ставишь любую сумму и бросаешь мяч. Попал — выигрыш
// (ставка × множитель), мимо — ставка теряется. Деньги авторитетны на сервере
// (provably-fair commit+nonce, как в Костях): тап «Бросить» → один POST, сервер решает
// исход и сразу считает выплату. Этот экран — только анимация броска и показ результата.
//
// Анимации — стикеры баскетбольного 🏀: попадание (basket-hit-*) и промах (basket-miss-*),
// у всех ОДИН первый кадр (мяч готов к броску) → он же покой. На бросок играем случайную
// анимацию нужного исхода; результат показываем по её завершению (как кубики), а не по
// таймеру (страховка — fallback).

const MIN_NANO = 100_000_000; // 0.1 TON (бэкенд тоже проверяет)
const PRESETS = [0.1, 1, 5, 25];
const HIT_ANIMS = ["basket-hit-1", "basket-hit-2"];
const MISS_ANIMS = ["basket-miss-1", "basket-miss-2", "basket-miss-3"];
const IDLE_ANIM = "basket-hit-1"; // первый кадр = мяч готов; кэшируется для мгновенного покоя
const THROW_SPEED = 1.15; // бросок ~3с → ~2.6с
const THROW_FALLBACK_MS = 3200; // страховка, если onComplete не придёт

const TOP = "#241a12"; // верх экрана = цвет плашки Telegram (тёплый тёмный, «зал»)
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

const fmtMult = (milli: number) => (milli / 1000).toFixed(2);
const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

type Phase = "idle" | "throwing" | "revealed";

export default function BasketGame({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [st, setSt] = useState<BasketState | null>(null);
  const [balanceNano, setBalanceNano] = useState(0);
  const [stake, setStake] = useState("0.1");
  const [phase, setPhase] = useState<Phase>("idle");
  const [throwSeq, setThrowSeq] = useState(0);
  const [throwAnim, setThrowAnim] = useState(MISS_ANIMS[0]);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ hit: boolean; payout: number; mult: number } | null>(null);
  const [recent, setRecent] = useState<BasketThrowRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const clipRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<BasketThrowResult | null>(null);
  const settledRef = useRef(true);
  const fallbackRef = useRef<number>(0);

  const minNano = st?.min_stake_nano ?? MIN_NANO;
  const mult = st?.mult_milli ?? 1880;
  const chancePct = (st?.hit_prob_bp ?? 5000) / 100;

  // Высоту clip-слоя выставляем СИНХРОННО до первого paint (useLayoutEffect + первый sync
  // вне rAF); в расфокусе — стабильная --app-h, в фокусе — visualViewport (клавиатура).
  // Точь-в-точь приём Костей — экран при входе не «доводится» и не подпрыгивает.
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

  // Нативная кнопка «Назад».
  useEffect(() => {
    const bb = (window.Telegram?.WebApp as { BackButton?: { show?: () => void; hide?: () => void; onClick?: (cb: () => void) => void; offClick?: (cb: () => void) => void } } | undefined)?.BackButton;
    if (!bb) return;
    bb.show?.();
    bb.onClick?.(onClose);
    return () => { bb.offClick?.(onClose); bb.hide?.(); };
  }, [onClose]);

  // Плашка/фон Telegram — тёмные (гасим голубой фон под клавой), возвращаем при выходе.
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

  // Завершение броска: показываем исход, баланс, историю. По onComplete анимации или
  // страховочному таймеру.
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
      setThrowAnim(pick(res.hit ? HIT_ANIMS : MISS_ANIMS));
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
      setErr(e instanceof Error ? e.message : String(e));
      hapticNotify("error");
    }
  };

  return (
    <div className="fixed left-0 top-0 z-50 w-full overflow-hidden text-white" style={{ height: "var(--app-h, 100dvh)", background: BG_BOTTOM }}>
      <div ref={clipRef} className="absolute inset-x-0 top-0 overflow-hidden" style={{ height: "var(--app-h, 100dvh)" }}>
        <div className="pointer-events-none absolute inset-0" style={{ background: `linear-gradient(180deg, ${TOP} 0%, #14110d 44%, ${BG_BOTTOM} 100%)` }} />

        <div className="relative z-10 flex h-full flex-col overflow-hidden">
          {/* История бросков (высота зарезервирована — не толкает сцену при подгрузке) */}
          <div className="px-4 pb-1" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-white/50">{t("basket.history")}</div>
            <div className="flex min-h-[24px] items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {recent.length === 0 && <span className="text-xs text-white/30">{t("basket.noThrows")}</span>}
              {recent.map((r) => (
                <span
                  key={r.id}
                  className={
                    "flex shrink-0 items-center rounded-md px-1.5 py-1 text-xs font-bold tabular-nums " +
                    (r.hit ? "bg-emerald-500/25 text-emerald-200" : "bg-rose-500/25 text-rose-200")
                  }
                >
                  {r.hit ? `+${fmtTon(r.payout_nano / 1e9)}` : "✗"}
                </span>
              ))}
            </div>
          </div>

          {/* Сцена: мяч/кольцо по центру (стабильно, как в Костях) */}
          <div className="flex flex-1 flex-col items-center justify-center overflow-hidden px-4">
            <div className="grid h-72 w-72 place-items-center">
              {phase === "idle" ? (
                // Покой: мяч готов к броску (первый кадр), без анимации. Кэш → мгновенно.
                <Lottie
                  key="idle"
                  src={`/lottie/${IDLE_ANIM}.json`}
                  animationData={getLottieData(IDLE_ANIM)}
                  className="h-72 w-72"
                  loop={false}
                  autoplay={false}
                />
              ) : (
                // Бросок: одна анимация нужного исхода (loop=false → застывает на финале:
                // мяч в сетке / мимо). onComplete двигает показ результата.
                <Lottie
                  key={`throw-${throwSeq}`}
                  src={`/lottie/${throwAnim}.json`}
                  className="h-72 w-72"
                  loop={false}
                  autoplay
                  speed={THROW_SPEED}
                  onComplete={finalize}
                />
              )}
            </div>

            {/* Результат — ТОЛЬКО после конца анимации */}
            <div className="pointer-events-none mt-1 flex h-14 flex-col items-center justify-center">
              {phase === "revealed" && result ? (
                result.hit ? (
                  <>
                    <div className="flex items-center gap-1.5 text-[32px] font-black leading-none tabular-nums text-orange-300 drop-shadow-[0_0_18px_rgba(251,146,60,0.6)]">
                      <TonIcon size={24} />+{fmtTon(result.payout / 1e9)}
                    </div>
                    <div className="mt-1 text-sm font-bold text-orange-300">{t("basket.score")} · {fmtMult(result.mult)}×</div>
                  </>
                ) : (
                  <div className="text-base font-semibold text-white/45">{t("basket.miss")}</div>
                )
              ) : phase === "idle" && !busy ? (
                <div className="text-sm font-medium text-white/45">{t("basket.tapToThrow")}</div>
              ) : null}
            </div>
          </div>

          {/* Нижняя панель */}
          <div className="border-t border-white/10 bg-[#100c08] px-4 pb-3 pt-3">
            {err && <p className="mb-2 text-center text-xs text-rose-400">{err}</p>}

            {/* Шанс + множитель */}
            <div className="mb-2 flex items-center justify-center gap-3 text-[11px] font-medium text-white/50">
              <span>{t("basket.chance")} {chancePct.toFixed(0)}%</span>
              <span className="h-1 w-1 rounded-full bg-white/30" />
              <span className="text-orange-300">{fmtMult(mult)}×</span>
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
                disabled={busy}
              />
              <button
                onClick={() => setStake(balanceTon > 0 ? String(Math.floor(balanceTon * 100) / 100) : "0")}
                disabled={busy}
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
                  disabled={busy}
                  className="rounded-xl border border-white/10 bg-white/[0.05] py-2.5 text-sm font-bold tabular-nums text-orange-300 active:scale-95 disabled:opacity-40"
                >
                  {p}
                </button>
              ))}
            </div>

            <button
              onClick={shoot}
              disabled={!canThrow}
              className="w-full rounded-2xl bg-gradient-to-r from-orange-400 to-orange-600 py-4 text-base font-black text-white shadow-lg shadow-orange-500/30 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? t("basket.throwing") : `${t("basket.throw")} · ${fmtTon(Number(stake) || 0)} TON`}
            </button>

            <div className="mt-2 truncate text-center text-[10px] text-white/25">
              {t("basket.fair")} · {st?.server_seed_hash ? `🔒 ${st.server_seed_hash.slice(0, 16)}…` : ""} · #{st?.nonce ?? 0}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
