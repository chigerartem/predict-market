import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fetchMe, fetchCaseState, caseOpen, type CaseState, type CasePrize, type CaseSpinResult, type CaseSpinRow } from "../realapi";
import { fmtTon } from "../format";
import { useT } from "../i18n";
import TonIcon from "../components/TonIcon";

// «Кейсы» — мгновенная игра в стиле открытия кейсов CS:GO. Фикс. цена за спин; лента
// карточек прокручивается и тормозит на выпавшем призе — сумме TON по множителю к цене
// (0×..200×) с редкостью (цвет рамки). Деньги авторитетны на сервере (provably-fair
// commit+nonce, как в Костях): тап «Открыть» → один POST, сервер тянет приз и сразу
// рассчитывает выплату. Этот экран — только анимация ленты и показ результата.
//
// Анимация — НЕ lottie: лента это flex-строка статичных карточек, едет одним
// transform: translateX с ease-out (быстро→медленно). Приём «как в кейсах»: на каждый
// спин строим свежую ленту, выигрышная карта стоит у конца (WIN_INDEX), сбрасываем
// transform в 0 без перехода, reflow, затем включаем переход и едем к цели. Стоп
// результата привязан к событию transitionend трека, не к таймеру (страховка — fallback).

const CARD_W = 78;   // px, ширина карточки
const GAP = 8;       // px, зазор
const STRIDE = CARD_W + GAP;
const REEL_LEN = 64; // карточек в ленте
const WIN_INDEX = 58; // позиция выигрышной карты (нужны карты после неё для «проезда»)
const DUR_MS = 5400;  // длительность проезда
const FALLBACK_MS = DUR_MS + 500;
// Визуальные веса наполнителя ленты (НЕ реальные шансы — те скрыты на сервере): просто
// чтобы в ленте преобладали частые тиры, а редкие/золото мелькали для азарта. Порядок =
// порядок тиров приза (low→high).
const VIS_WEIGHTS = [34, 30, 24, 14, 8, 4, 2];

const TOP = "#171a2e";    // верх экрана = цвет плашки Telegram (совпадение шва)
const BOTTOM = "#0a0d18"; // тёмный низ

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

type Rarity = CasePrize["rarity"];

// Палитра редкостей (рамка/свечение/текст/чип истории). Золото и красный — самые яркие.
// Классы — литералами (а не собираем строкой), иначе Tailwind JIT их не увидит.
const RARITY: Record<Rarity, { border: string; glow: string; text: string; chip: string; from: string; bar: string }> = {
  grey:   { border: "border-zinc-500/40",    glow: "",                      text: "text-zinc-300",    chip: "bg-zinc-500/20 text-zinc-300",       from: "from-zinc-700/40",    bar: "bg-zinc-400" },
  blue:   { border: "border-sky-400/60",     glow: "shadow-sky-500/20",     text: "text-sky-300",     chip: "bg-sky-500/20 text-sky-200",         from: "from-sky-600/30",     bar: "bg-sky-400" },
  purple: { border: "border-violet-400/70",  glow: "shadow-violet-500/30",  text: "text-violet-200",  chip: "bg-violet-500/20 text-violet-200",   from: "from-violet-600/30",  bar: "bg-violet-400" },
  pink:   { border: "border-fuchsia-400/70", glow: "shadow-fuchsia-500/30", text: "text-fuchsia-200", chip: "bg-fuchsia-500/20 text-fuchsia-200", from: "from-fuchsia-600/30", bar: "bg-fuchsia-400" },
  red:    { border: "border-rose-400/80",    glow: "shadow-rose-500/40",    text: "text-rose-200",    chip: "bg-rose-500/20 text-rose-200",       from: "from-rose-600/30",    bar: "bg-rose-400" },
  gold:   { border: "border-amber-300",      glow: "shadow-amber-400/50",   text: "text-amber-200",   chip: "bg-amber-400/20 text-amber-200",     from: "from-amber-500/30",   bar: "bg-amber-300" },
};

type Card = { rarity: Rarity; multMilli: number };

const amountTon = (priceNano: number, multMilli: number) => (priceNano / 1e9) * (multMilli / 1000);
const fmtMult = (m: number) => (m / 1000).toFixed(m % 1000 === 0 ? 0 : (m % 100 === 0 ? 1 : 2));

// Карточка приза в ленте: рамка/свечение по редкости, сверху градиент-тинт, в центре —
// сумма TON (или «—» на «мимо» 0×).
function ReelCard({ card, priceNano, highlight }: { card: Card; priceNano: number; highlight?: boolean }) {
  const r = RARITY[card.rarity];
  const amt = amountTon(priceNano, card.multMilli);
  const miss = card.multMilli === 0;
  return (
    <div
      className={
        "relative flex shrink-0 flex-col items-center justify-center rounded-xl border bg-gradient-to-b to-white/[0.02] " +
        r.from + " " + r.border + " " +
        (highlight ? "shadow-lg " + r.glow : "")
      }
      style={{ width: CARD_W, height: 96 }}
    >
      {/* верхняя цветная полоска редкости */}
      <span className={"absolute inset-x-0 top-0 h-1 rounded-t-xl " + r.bar} />
      {miss ? (
        <span className="text-2xl font-black text-white/25">—</span>
      ) : (
        <>
          <TonIcon size={20} />
          <span className={"mt-1 text-[15px] font-black tabular-nums " + r.text}>{fmtTon(amt)}</span>
        </>
      )}
    </div>
  );
}

export default function CaseGame({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [st, setSt] = useState<CaseState | null>(null);
  const [balanceNano, setBalanceNano] = useState(0);
  const [reel, setReel] = useState<Card[]>([]);
  const [spinSeq, setSpinSeq] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [pending, setPending] = useState(false); // ждём ответ сервера до старта ленты
  const [result, setResult] = useState<{ rarity: Rarity; multMilli: number; payout: number } | null>(null);
  const [recent, setRecent] = useState<CaseSpinRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const trackRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<CaseSpinResult | null>(null);
  const settledRef = useRef(true);
  const fallbackRef = useRef<number>(0);

  const reloadBalance = useCallback(() => {
    fetchMe().then((m) => setBalanceNano(m.balance_nano)).catch(() => {});
  }, []);

  // Наполнитель ленты: случайный тир по визуальным весам (только для вида).
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
        // стартовая лента-наполнитель (статичная, без проезда)
        setReel(Array.from({ length: REEL_LEN }, () => randomCard(s.prizes)));
      })
      .catch(() => {});
  }, [reloadBalance, randomCard]);

  // Нативная кнопка «Назад» Telegram.
  useEffect(() => {
    const bb = (window.Telegram?.WebApp as { BackButton?: { show?: () => void; hide?: () => void; onClick?: (cb: () => void) => void; offClick?: (cb: () => void) => void } } | undefined)?.BackButton;
    if (!bb) return;
    bb.show?.();
    bb.onClick?.(onClose);
    return () => { bb.offClick?.(onClose); bb.hide?.(); };
  }, [onClose]);

  // Плашка/фон Telegram — тёмные (как в Костях/Ракете), возвращаем голубой при выходе.
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    try { tg?.setHeaderColor?.(TOP); tg?.setBackgroundColor?.(BOTTOM); } catch { /* старый клиент */ }
    return () => {
      try { tg?.setHeaderColor?.("#5CCBFF"); tg?.setBackgroundColor?.("#5CCBFF"); } catch { /* старый клиент */ }
    };
  }, []);

  useEffect(() => {
    if (!err) return;
    const tm = window.setTimeout(() => setErr(null), 2500);
    return () => window.clearTimeout(tm);
  }, [err]);

  useEffect(() => () => window.clearTimeout(fallbackRef.current), []);

  // Завершение проезда: показываем приз, обновляем баланс и историю. Вызывается по
  // transitionend трека (или страховочному таймеру).
  const finalize = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    window.clearTimeout(fallbackRef.current);
    const res = resultRef.current;
    if (!res) return;
    setBalanceNano(res.balance_nano);
    setResult({ rarity: res.rarity, multMilli: res.mult_milli, payout: res.payout_nano });
    setSpinning(false);
    hapticNotify(res.payout_nano > 0 ? "success" : "error");
    if (res.payout_nano > 0) haptic("rigid");
    setRecent((prev) => [{
      id: res.spin_id, nonce: res.nonce, price_nano: res.price_nano, prize_index: res.prize_index,
      rarity: res.rarity, mult_milli: res.mult_milli, payout_nano: res.payout_nano,
      created_at: new Date().toISOString(),
    }, ...prev].slice(0, 20));
  }, []);

  // Императивный проезд ленты: после рендера новой ленты (spinSeq) сбрасываем трек в 0
  // без перехода, форсим reflow, затем едем к цели с ease-out. Цель = центр вьюпорта под
  // выигрышной картой (+ небольшой джиттер, чтобы не всегда ровно по центру).
  useLayoutEffect(() => {
    if (spinSeq === 0 || !spinning) return;
    const track = trackRef.current;
    const vp = viewportRef.current;
    if (!track || !vp) return;
    const w = vp.clientWidth;
    const jitter = (Math.random() - 0.5) * CARD_W * 0.6;
    const target = w / 2 - (WIN_INDEX * STRIDE + CARD_W / 2) + jitter;

    track.style.transition = "none";
    track.style.transform = "translateX(0px)";
    void track.offsetWidth; // reflow → старт с нуля
    track.style.transition = `transform ${DUR_MS}ms cubic-bezier(0.10, 0.82, 0.16, 1)`;
    track.style.transform = `translateX(${target}px)`;

    const onEnd = (e: TransitionEvent) => { if (e.propertyName === "transform") finalize(); };
    track.addEventListener("transitionend", onEnd);
    window.clearTimeout(fallbackRef.current);
    fallbackRef.current = window.setTimeout(finalize, FALLBACK_MS);
    return () => track.removeEventListener("transitionend", onEnd);
  }, [spinSeq, spinning, finalize]);

  const priceNano = st?.price_nano ?? 0;
  const canOpen = !!st && !spinning && !pending && balanceNano >= priceNano && priceNano > 0;

  const open = async () => {
    if (!st || spinning || pending) return;
    if (balanceNano < priceNano) { setErr(t("case.insufficient")); return; }
    setErr(null);
    setResult(null);
    setPending(true);
    haptic("medium");
    try {
      const res = await caseOpen();
      resultRef.current = res;
      // строим свежую ленту с выигрышной картой у конца
      const next = Array.from({ length: REEL_LEN }, () => randomCard(st.prizes));
      next[WIN_INDEX] = { rarity: res.rarity, multMilli: res.mult_milli };
      setReel(next);
      settledRef.current = false;
      setSpinning(true);
      setSpinSeq((k) => k + 1); // триггерит layout-эффект проезда
      setPending(false);
      haptic("rigid");
    } catch (e) {
      setPending(false);
      setSpinning(false);
      setErr(e instanceof Error ? e.message : String(e));
      hapticNotify("error");
    }
  };

  const balanceTon = balanceNano / 1e9;
  const priceTon = priceNano / 1e9;

  return (
    <div className="fixed left-0 top-0 z-50 w-full overflow-hidden text-white" style={{ height: "var(--app-h, 100dvh)", background: `linear-gradient(180deg, ${TOP} 0%, #11142a 46%, ${BOTTOM} 100%)` }}>
      <div className="flex h-full flex-col overflow-hidden">
        {/* История дропов */}
        <div className="px-4 pb-1" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-white/50">{t("case.history")}</div>
          <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {recent.length === 0 && <span className="text-xs text-white/30">{t("case.noSpins")}</span>}
            {recent.map((r) => (
              <span key={r.id} className={"flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-bold tabular-nums " + RARITY[r.rarity].chip}>
                {r.payout_nano > 0 ? `+${fmtTon(r.payout_nano / 1e9)}` : "—"}
              </span>
            ))}
          </div>
        </div>

        {/* Сцена: лента + указатель */}
        <div className="relative flex flex-1 flex-col items-center justify-center">
          {/* мягкие тени по краям ленты */}
          <div ref={viewportRef} className="relative w-full overflow-hidden" style={{ height: 112 }}>
            <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-12 bg-gradient-to-r from-[#0c0f1f] to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 z-20 w-12 bg-gradient-to-l from-[#0c0f1f] to-transparent" />
            {/* центральный указатель */}
            <div className="pointer-events-none absolute inset-y-0 left-1/2 z-30 -ml-px w-0.5 bg-amber-300/80 shadow-[0_0_12px_2px_rgba(252,211,77,0.5)]" />
            <div className="pointer-events-none absolute left-1/2 top-0 z-30 -ml-2 h-0 w-0 -translate-y-px border-x-8 border-t-8 border-x-transparent border-t-amber-300" />
            <div className="pointer-events-none absolute bottom-0 left-1/2 z-30 -ml-2 h-0 w-0 translate-y-px border-x-8 border-b-8 border-x-transparent border-b-amber-300" />
            {/* трек ленты */}
            <div ref={trackRef} className="absolute top-1/2 left-0 flex -translate-y-1/2 will-change-transform" style={{ gap: GAP }}>
              {reel.map((c, i) => (
                <ReelCard key={`${spinSeq}-${i}`} card={c} priceNano={priceNano} highlight={!spinning && i === WIN_INDEX} />
              ))}
            </div>
          </div>

          {/* Результат — после остановки ленты */}
          <div className="pointer-events-none mt-4 flex h-14 flex-col items-center justify-center">
            {!spinning && result ? (
              result.payout > 0 ? (
                <>
                  <div className={"flex items-center gap-1.5 text-3xl font-black tabular-nums " + RARITY[result.rarity].text}>
                    <TonIcon size={24} />+{fmtTon(result.payout / 1e9)}
                  </div>
                  <div className={"mt-0.5 text-sm font-bold " + RARITY[result.rarity].text}>{t("case.youWon")} · {fmtMult(result.multMilli)}×</div>
                </>
              ) : (
                <div className="text-sm font-semibold text-white/45">{t("case.empty")}</div>
              )
            ) : !spinning && !pending ? (
              <div className="text-sm font-medium text-white/45">{t("case.tapToOpen")}</div>
            ) : null}
          </div>
        </div>

        {/* Нижняя панель */}
        <div className="border-t border-white/10 bg-[#0a0d18] px-4 pb-3 pt-3">
          {err && <p className="mb-2 text-center text-xs text-rose-400">{err}</p>}

          {/* Что внутри — тиры призов */}
          <div className="mb-2.5">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-white/40">{t("case.contents")}</div>
            <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {(st?.prizes ?? []).map((p, i) => (
                <span key={i} className={"flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold tabular-nums " + RARITY[p.rarity].chip}>
                  {p.mult_milli === 0 ? "—" : fmtTon(amountTon(priceNano, p.mult_milli))}
                </span>
              ))}
            </div>
          </div>

          {/* Баланс */}
          <div className="mb-2 flex items-center justify-center gap-1.5 text-sm font-semibold text-white/60">
            <TonIcon size={14} /> <span className="tabular-nums text-white/85">{fmtTon(balanceTon)}</span>
          </div>

          <button
            onClick={open}
            disabled={!canOpen}
            className="w-full rounded-2xl bg-gradient-to-r from-amber-400 to-orange-600 py-4 text-base font-black text-white shadow-lg shadow-orange-500/30 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending || spinning ? t("case.opening") : `${t("case.open")} · ${fmtTon(priceTon)} TON`}
          </button>

          {/* Честная игра: commitment-хэш + nonce */}
          <div className="mt-2 truncate text-center text-[10px] text-white/25">
            {t("case.fair")} · {st?.server_seed_hash ? `🔒 ${st.server_seed_hash.slice(0, 16)}…` : ""} · #{st?.nonce ?? 0}
          </div>
        </div>
      </div>
    </div>
  );
}
