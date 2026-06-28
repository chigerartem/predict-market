import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fetchMe, fetchDiceState, diceRoll, type DiceState, type DiceRollRow, type DiceRollResult } from "../realapi";
import { fmtTon } from "../format";
import { useT } from "../i18n";
import Lottie from "../components/Lottie";
import TonIcon from "../components/TonIcon";

// «Кости» — мгновенная игра на два кубика. В отличие от Ракеты тут нет общего раунда
// и SSE: тап «Бросить» → один POST, сервер кидает кубики (provably-fair) и сразу
// рассчитывает выигрыш. Деньги авторитетны на сервере; этот экран — только анимация
// и выбор ставки. Кубики — анимированные лотти из стикерпака AnimatedDice2: dice-1..6
// (бросок, останавливается на грани N). Последовательность (по фидбеку Артёма): кубики
// СТОЯТ → тап → ОДНА анимация dice-N от начала до конца → застывает на гранях → и ТОЛЬКО
// ПОТОМ показывается выигрыш/проигрыш. Результат привязан к событию `complete` лотти,
// а не к таймеру, чтобы не опережать анимацию. (dice-spin.json больше не используется.)

const MIN_NANO = 100_000_000; // 0.1 TON
const PRESETS = [0.1, 1, 5, 25];
const DICE_TOP = "#1b2547"; // цвет верха экрана = цвет плашки Telegram (совпадение шва)
const DICE_BOTTOM = "#0a0d18"; // тёмный низ / фон под клавиатурой
const EDGE_BP = 1200; // запасной расчёт множителей (= дефолт бэкенда 12%), если /state не успел прийти
const ROLL_FALLBACK_MS = 3600; // страховка, если событие `complete` не придёт (анимация ~3с)
const AUTO_SPEED = 1.3; // авто-броски крутятся на ~30% быстрее обычных (Артём: «на 20-30%»)
const AUTO_PAUSE_MS = 450; // пауза показа результата между авто-бросками

// Тактильная отдача Telegram (мягко глушим без поддержки).
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

// Нормализация ввода ставки (как в Ракете): запятая→точка, одна точка, «02»→«0.2».
function normStake(raw: string): string {
  let s = raw.replace(",", ".").replace(/[^\d.]/g, "");
  const i = s.indexOf(".");
  if (i >= 0) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, "");
  if (/^0\d/.test(s)) s = "0." + s.slice(1);
  return s;
}

type Bet = { kind: "low" | "high" | "exact"; target: number };

const waysExact = (t: number) => 6 - Math.abs(t - 7);
const multFallback = (ways: number) => Math.floor(((10000 - EDGE_BP) * 36) / (10 * ways));
const fmtMult = (milli: number) => (milli / 1000).toFixed(2);

function multForBet(st: DiceState | null, bet: Bet): number {
  if (st) {
    if (bet.kind === "low") return st.mult_low;
    if (bet.kind === "high") return st.mult_high;
    return st.mult_exact[String(bet.target)] ?? multFallback(waysExact(bet.target));
  }
  if (bet.kind === "exact") return multFallback(waysExact(bet.target));
  return multFallback(15);
}

function chancePct(bet: Bet): number {
  const ways = bet.kind === "exact" ? waysExact(bet.target) : 15;
  return (ways / 36) * 100;
}

const sameBet = (a: Bet, b: Bet) => a.kind === b.kind && (a.kind !== "exact" || a.target === b.target);

// Семь точек кубика (pips) для статичной грани в чипах истории/выбора. Координаты в
// сетке 3×3, единицы 0..2.
const PIP: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

function PipDie({ n, size = 18, className = "" }: { n: number; size?: number; className?: string }) {
  const u = size / 3;
  return (
    <span
      className={"inline-grid shrink-0 place-items-center rounded-[4px] bg-white text-black " + className}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg viewBox="0 0 3 3" width={size} height={size}>
        {(PIP[n] ?? []).map(([x, y], i) => (
          <circle key={i} cx={x + 0.5} cy={y + 0.5} r={0.32} fill="currentColor" />
        ))}
      </svg>
    </span>
  );
}

type Phase = "idle" | "rolling" | "revealed";

export default function DiceGame({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [st, setSt] = useState<DiceState | null>(null);
  const [balanceNano, setBalanceNano] = useState(0);
  const [stake, setStake] = useState("0.1");
  const [bet, setBet] = useState<Bet>({ kind: "low", target: 0 });
  const [showExact, setShowExact] = useState(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [dice, setDice] = useState<[number, number]>([6, 1]);
  const [rollSeq, setRollSeq] = useState(0);
  const [pending, setPending] = useState(false); // ждём ответ сервера (до старта анимации)
  const [auto, setAuto] = useState(false); // авто-броски: крутим сами, пока есть деньги
  const [rollSpeed, setRollSpeed] = useState(1); // скорость анимации текущего броска (захвачена на старте → авто-тумблер не дёргает текущую)
  const [outcome, setOutcome] = useState<{ won: boolean; sum: number; payout: number; mult: number } | null>(null);
  const [recent, setRecent] = useState<DiceRollRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const clipRef = useRef<HTMLDivElement>(null);
  const autoRef = useRef(auto);
  autoRef.current = auto; // свежее значение для чтения в roll() (захват скорости)
  const rollRef = useRef<() => void>(() => {}); // последняя версия roll() для авто-цикла
  // Синхронизация показа результата с КОНЦОМ анимации броска: оба кубика шлют onComplete,
  // ждём оба (doneRef), settledRef защищает от двойного срабатывания, fallbackRef —
  // страховочный таймер, если событие complete не придёт. rollCtx держит результат+ставку
  // текущего броска (DTO не эхоит ставку) для записи в историю при завершении.
  const rollCtx = useRef<{ res: DiceRollResult; betKind: Bet["kind"]; betTarget: number; stakeNano: number } | null>(null);
  const doneRef = useRef(0);
  const settledRef = useRef(true);
  const fallbackRef = useRef<number>(0);

  // Клавиатура: ужимаем внутренний clip-слой по rAF (корень стабильно-тёмный во весь
  // экран). Точь-в-точь приём Ракеты — в Telegram/iOS события клавиатуры приходят с
  // пропусками, поэтому синхроним каждый кадр; в расфокусе высота = innerHeight, чтобы
  // не оголялся голубой фон вкладки под уезжающей клавиатурой.
  // useLayoutEffect + ПЕРВЫЙ sync вне rAF → высота выставляется до первого paint. Иначе
  // первый кадр рисуется по инлайновой --app-h (viewportStableHeight), а следующий — по
  // window.innerHeight, и при входе из Games экран заметно «доводится на место». Дальше
  // rAF держит синхрон под клавиатуру.
  useLayoutEffect(() => {
    const vv = window.visualViewport;
    const el = clipRef.current;
    if (!vv || !el) return;
    let raf = 0, lastKey = "";
    // В фокусе (клавиатура) — высота по visualViewport (+ сдвиг). В расфокусе — СТАБИЛЬНАЯ
    // --app-h (та же, что у корня), а НЕ window.innerHeight: innerHeight на пару px
    // отличается от --app-h, и центрированная сцена «доводилась» при входе. --app-h после
    // старта не меняется → вход без подпрыгивания.
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
    sync(); // синхронно до первого paint
    const loop = () => { sync(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const reloadBalance = useCallback(() => {
    fetchMe().then((m) => setBalanceNano(m.balance_nano)).catch(() => {});
  }, []);

  useEffect(() => {
    reloadBalance();
    fetchDiceState()
      .then((s) => {
        setSt(s);
        setRecent(s.recent ?? []);
        // НЕ трогаем кубики при входе: они стоят статично на дефолтной грани и ждут
        // броска (Артём: при входе ничего не должно загружаться/мелькать/меняться).
      })
      .catch(() => {});
  }, [reloadBalance]);

  // Нативная кнопка «Назад» Telegram.
  useEffect(() => {
    const bb = (window.Telegram?.WebApp as { BackButton?: { show?: () => void; hide?: () => void; onClick?: (cb: () => void) => void; offClick?: (cb: () => void) => void } } | undefined)?.BackButton;
    if (!bb) return;
    bb.show?.();
    bb.onClick?.(onClose);
    return () => {
      bb.offClick?.(onClose);
      bb.hide?.();
    };
  }, [onClose]);

  // Плашка/фон Telegram — тёмные, как в Ракете (гасим голубой фон вкладки под клавой),
  // и возвращаем фирменный голубой при выходе.
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    const dark = () => {
      try {
        tg?.setHeaderColor?.(DICE_TOP); // = верхний цвет градиента → плашка сливается с экраном
        tg?.setBackgroundColor?.(DICE_BOTTOM);
      } catch { /* старый клиент */ }
    };
    dark();
    document.addEventListener("focusin", dark);
    document.addEventListener("focusout", dark);
    return () => {
      document.removeEventListener("focusin", dark);
      document.removeEventListener("focusout", dark);
      try {
        tg?.setHeaderColor?.("#5CCBFF");
        tg?.setBackgroundColor?.("#5CCBFF");
      } catch { /* старый клиент */ }
    };
  }, []);

  useEffect(() => {
    if (!err) return;
    const tm = window.setTimeout(() => setErr(null), 2500);
    return () => window.clearTimeout(tm);
  }, [err]);

  // Чистим страховочный таймер при размонтировании.
  useEffect(() => () => window.clearTimeout(fallbackRef.current), []);

  const balanceTon = balanceNano / 1e9;
  const mult = multForBet(st, bet);
  const chance = chancePct(bet);
  const exactMult = (sum: number) => (st ? st.mult_exact[String(sum)] ?? multFallback(waysExact(sum)) : multFallback(waysExact(sum)));

  // Завершение броска: вызывается КОГДА анимация доиграла (оба onComplete) или по
  // страховочному таймеру. Только теперь показываем выигрыш/проигрыш и обновляем баланс
  // (до этого момента баланс не трогаем, чтобы списание/выигрыш не спойлили результат).
  const finalize = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    window.clearTimeout(fallbackRef.current);
    const ctx = rollCtx.current;
    if (!ctx) return;
    const { res, betKind, betTarget, stakeNano } = ctx;
    setBalanceNano(res.balance_nano);
    setOutcome({ won: res.won, sum: res.sum, payout: res.payout_nano, mult: res.mult_milli });
    setPhase("revealed");
    hapticNotify(res.won ? "success" : "error");
    setRecent((prev) => [{
      id: res.roll_id, nonce: res.nonce, bet_kind: betKind,
      bet_target: betKind === "exact" ? betTarget : undefined,
      stake_nano: stakeNano, die1: res.die1, die2: res.die2, sum: res.sum,
      won: res.won, mult_milli: res.mult_milli, payout_nano: res.payout_nano,
      created_at: new Date().toISOString(),
    }, ...prev].slice(0, 15));
  }, []);

  const busy = pending || phase === "rolling";

  const roll = async () => {
    if (busy) return;
    const nano = Math.round((Number(stake) || 0) * 1e9);
    if (nano < MIN_NANO) { setErr(t("dice.min")); return; }
    if (nano > balanceNano) { setErr(t("dice.insufficient")); return; }
    setErr(null);
    setOutcome(null);   // прячем прошлый результат, пока летят новые кубики
    setPending(true);   // ждём сервер (анимацию запускаем только с готовым результатом)
    haptic("medium");
    try {
      const res = await diceRoll(bet.kind, bet.target, nano);
      rollCtx.current = { res, betKind: bet.kind, betTarget: bet.target, stakeNano: nano };
      settledRef.current = false;
      doneRef.current = 0;
      window.clearTimeout(fallbackRef.current);
      fallbackRef.current = window.setTimeout(finalize, ROLL_FALLBACK_MS);
      setRollSpeed(autoRef.current ? AUTO_SPEED : 1); // скорость захвачена на старте броска
      setDice([res.die1, res.die2]); // грани известны → анимация dice-N сразу правильная
      setRollSeq((k) => k + 1);      // remount → ОДНА анимация с первого кадра
      setPhase("rolling");
      setPending(false);
      haptic("rigid");               // «кубики брошены»
    } catch (e) {
      setPending(false);
      setPhase("idle");
      setAuto(false); // ошибка броска → выключаем авто, чтобы не долбить ею в цикле
      setErr(e instanceof Error ? e.message : String(e));
      hapticNotify("error");
    }
  };
  rollRef.current = roll;

  // Кубик доиграл; ждём оба, потом показываем результат.
  const onDieComplete = () => {
    doneRef.current += 1;
    if (doneRef.current >= 2) finalize();
  };

  // Авто-цикл: пока тумблер включён и хватает денег — крутим сами. Триггерится из покоя
  // (первый бросок, delay 0) и после каждого результата (revealed, короткая пауза).
  // Стоп: денег не хватает на ставку → выключаем тумблер; либо юзер сам выключил auto.
  useEffect(() => {
    if (!auto || busy) return;
    const nano = Math.round((Number(stake) || 0) * 1e9);
    if (nano < MIN_NANO || nano > balanceNano) { setAuto(false); return; }
    const delay = phase === "revealed" ? AUTO_PAUSE_MS : 0;
    const id = window.setTimeout(() => rollRef.current(), delay);
    return () => window.clearTimeout(id);
  }, [auto, busy, phase, balanceNano, stake]);

  const canRoll = !busy && (Number(stake) || 0) > 0;

  return (
    <div className="fixed left-0 top-0 z-50 w-full overflow-hidden bg-[#0a0d18] text-white" style={{ height: "var(--app-h, 100dvh)" }}>
      <div ref={clipRef} className="absolute inset-x-0 top-0 overflow-hidden" style={{ height: "var(--app-h, 100dvh)" }}>
        {/* Фон: вертикальный градиент. ВЕРХНИЙ цвет (DICE_TOP) ДОЛЖЕН совпадать с
            setHeaderColor ниже — тогда нативная плашка Telegram и верх экрана сливаются
            без шва (фон статичный, в отличие от Ракеты). Низ темнее = глубина. */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: `linear-gradient(180deg, ${DICE_TOP} 0%, #11162b 44%, #0a0d18 100%)` }}
        />

        {/* Экран костей помещается в один вьюпорт → НЕ скроллим (в отличие от Ракеты с
            доскроллом к ленте). Фикс-раскладка: история сверху всегда видна, сцена
            забирает остаток (flex-1), панель прижата к низу. Без data-allow-scroll →
            глобальный touchmove-preventDefault App'а гасит протяжку. */}
        <div className="relative z-10 flex h-full flex-col overflow-hidden">
          <section className="relative flex flex-1 flex-col">
            {/* История последних бросков */}
            <div className="px-4 pb-1" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-white/50">{t("dice.history")}</div>
              <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {recent.length === 0 && <span className="text-xs text-white/30">{t("dice.noRolls")}</span>}
                {recent.map((r) => (
                  <span
                    key={r.id}
                    className={
                      "flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-bold tabular-nums " +
                      (r.won ? "bg-emerald-500/25 text-emerald-200" : "bg-rose-500/25 text-rose-200")
                    }
                  >
                    <PipDie n={r.die1} size={13} />
                    <PipDie n={r.die2} size={13} />
                    <span className="ml-0.5">{r.sum}</span>
                  </span>
                ))}
              </div>
            </div>

            {/* Сцена с кубиками */}
            <div className="relative flex flex-1 flex-col items-center justify-center px-4 py-6">
              <div className="flex items-center justify-center gap-4">
                {[0, 1].map((i) => (
                  <div key={i} className="grid h-32 w-32 place-items-center">
                    {phase === "idle" ? (
                      // Покой ДО первого броска: НАШ lottie-кубик стоит на ГРАНИ
                      // (autoplay=false, freeze=last → последний кадр), НЕ анимируется.
                      // Обёртка прячет контейнер, пока не встанет последний кадр → кадр 0
                      // («в полёте») не мелькает. Грань при входе не меняем (setDice по
                      // recent убран) → lottie не перезагружается, кубик просто стоит.
                      <Lottie
                        key={`idle-${dice[i]}-${i}`}
                        src={`/lottie/dice-${dice[i]}.json`}
                        className="h-32 w-32"
                        loop={false}
                        autoplay={false}
                        freeze="last"
                      />
                    ) : (
                      // Бросок и покой после него — ОДНА анимация (loop=false: доиграв,
                      // застывает на выпавшей грани). key=rollSeq → новый бросок ремаунтит
                      // с первого кадра. onComplete двигает показ результата.
                      <Lottie
                        key={`roll-${rollSeq}-${i}`}
                        src={`/lottie/dice-${dice[i]}.json`}
                        className="h-32 w-32"
                        loop={false}
                        autoplay
                        speed={rollSpeed}
                        onComplete={onDieComplete}
                      />
                    )}
                  </div>
                ))}
              </div>

              {/* Крупная сумма / результат — ТОЛЬКО после конца анимации (phase "revealed").
                  Во время броска (rolling) и ожидания сервера — пусто, чтобы не опережать
                  кубики. */}
              <div className="pointer-events-none mt-4 flex h-16 flex-col items-center justify-center">
                {phase === "revealed" && outcome ? (
                  <>
                    <div className={"text-5xl font-black tabular-nums " + (outcome.won ? "text-emerald-300" : "text-rose-300")}>
                      {outcome.sum}
                    </div>
                    {outcome.won ? (
                      <div className="mt-1 text-sm font-bold text-emerald-300">
                        +{fmtTon(outcome.payout / 1e9)} TON · {fmtMult(outcome.mult)}x
                      </div>
                    ) : (
                      <div className="mt-1 text-sm font-semibold text-rose-300/90">{t("dice.noLuck")}</div>
                    )}
                  </>
                ) : phase === "idle" && !busy ? (
                  <div className="text-sm font-medium text-white/45">{t("dice.tapToRoll")}</div>
                ) : null}
              </div>
            </div>

            {/* Нижняя панель управления */}
            <div className="border-t border-white/10 bg-[#0a0d18] px-4 pb-3 pt-3">
              {err && <p className="mb-2 text-center text-xs text-rose-400">{err}</p>}

              {/* Выбор ставки: три основные + раскрываемая точная сумма */}
              <div className="mb-2 grid grid-cols-3 gap-2">
                <BetButton label={t("dice.low")} sub={`${fmtMult(st?.mult_low ?? multFallback(15))}x`} active={sameBet(bet, { kind: "low", target: 0 })} onClick={() => setBet({ kind: "low", target: 0 })} />
                <BetButton label={t("dice.seven")} sub={`${fmtMult(exactMult(7))}x`} active={sameBet(bet, { kind: "exact", target: 7 })} onClick={() => setBet({ kind: "exact", target: 7 })} />
                <BetButton label={t("dice.high")} sub={`${fmtMult(st?.mult_high ?? multFallback(15))}x`} active={sameBet(bet, { kind: "high", target: 0 })} onClick={() => setBet({ kind: "high", target: 0 })} />
              </div>

              <button
                onClick={() => setShowExact((v) => !v)}
                className="mb-2 flex w-full items-center justify-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-white/45"
              >
                {t("dice.exactSum")}
                <svg viewBox="0 0 24 24" className={"h-3.5 w-3.5 transition-transform " + (showExact ? "rotate-180" : "")} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {showExact && (
                <div className="mb-2 grid grid-cols-6 gap-1.5">
                  {Array.from({ length: 11 }, (_, k) => k + 2).map((sum) => {
                    const active = sameBet(bet, { kind: "exact", target: sum });
                    return (
                      <button
                        key={sum}
                        onClick={() => setBet({ kind: "exact", target: sum })}
                        className={
                          "flex flex-col items-center rounded-lg border py-1.5 transition active:scale-95 " +
                          (active ? "border-amber-400 bg-amber-400/15 text-amber-200" : "border-white/10 bg-white/[0.04] text-white/70")
                        }
                      >
                        <span className="text-sm font-bold tabular-nums">{sum}</span>
                        <span className="text-[9px] font-semibold tabular-nums opacity-70">{fmtMult(exactMult(sum))}x</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Текущий выбор: шанс + множитель */}
              <div className="mb-2 flex items-center justify-center gap-3 text-[11px] font-medium text-white/50">
                <span>{t("dice.chance")} {chance.toFixed(1)}%</span>
                <span className="h-1 w-1 rounded-full bg-white/30" />
                <span className="text-amber-300">{fmtMult(mult)}x</span>
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
                />
                <button
                  onClick={() => setStake(balanceTon > 0 ? String(Math.floor(balanceTon * 100) / 100) : "0")}
                  className="flex shrink-0 items-center gap-1 rounded-xl bg-white/10 px-2.5 py-1.5 text-sm font-bold tabular-nums text-white/80 active:scale-95"
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
                    className="rounded-xl border border-white/10 bg-white/[0.05] py-2.5 text-sm font-bold tabular-nums text-amber-300 active:scale-95"
                  >
                    {p}
                  </button>
                ))}
              </div>

              {/* Авто-броски: тумблер. Включён → крутит сам (быстрее), пока есть деньги. */}
              <div className="mb-2 flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5">
                <span className="flex items-center gap-2 text-sm font-semibold text-white/80">
                  <svg viewBox="0 0 24 24" className="h-4 w-4 text-amber-300" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
                  </svg>
                  {t("dice.auto")}
                </span>
                <Switch on={auto} onToggle={() => setAuto((a) => !a)} />
              </div>

              <button
                onClick={auto ? () => setAuto(false) : roll}
                disabled={!auto && !canRoll}
                className={
                  "w-full rounded-2xl py-4 text-base font-black text-white shadow-lg transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 " +
                  (auto
                    ? "border border-white/15 bg-white/[0.08]"
                    : "bg-gradient-to-r from-amber-400 to-orange-600 shadow-orange-500/30")
                }
              >
                {auto
                  ? t("dice.stop")
                  : busy
                    ? t("dice.rolling")
                    : `${t("dice.roll")} · ${fmtTon(Number(stake) || 0)} TON`}
              </button>

              {/* Честная игра: commitment-хэш + nonce */}
              <div className="mt-2 truncate text-center text-[10px] text-white/25">
                {t("dice.fair")} · {st?.server_seed_hash ? `🔒 ${st.server_seed_hash.slice(0, 16)}…` : ""} · #{st?.nonce ?? 0}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Switch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className={"relative h-6 w-11 shrink-0 rounded-full transition-colors " + (on ? "bg-amber-400" : "bg-white/15")}
    >
      <span className={"absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all " + (on ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}

function BetButton({ label, sub, active, onClick }: { label: string; sub: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={
        "flex flex-col items-center rounded-2xl border py-2.5 transition active:scale-[0.97] " +
        (active ? "border-amber-400 bg-amber-400/15" : "border-white/10 bg-white/[0.05]")
      }
    >
      <span className={"text-sm font-bold " + (active ? "text-amber-200" : "text-white/85")}>{label}</span>
      <span className={"mt-0.5 text-[11px] font-semibold tabular-nums " + (active ? "text-amber-300/90" : "text-white/45")}>{sub}</span>
    </button>
  );
}
