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
// щит/кольцо/сетка нарисованы ВНУТРИ Lottie и имеют запечённый «наезд камеры»: центр щита
// ныряет вниз, затем поднимается, одновременно вырастая ×2.33 (замерено по стеклу щита).
// Чтобы щит выглядел приклеенным к стене, камера фона ПОВТОРЯЕТ это движение (CAM_CURVES:
// масштаб + сдвиг по вертикали) вокруг центра щита в замахе (origin вычисляем из позиции
// Lottie-бокса в рантайме). На результате зум держим (не «отъезжаем», иначе щит отклеится).

const MIN_NANO = 100_000_000;
const PRESETS = [0.1, 1, 5, 25];
const IDLE_ANIM = "basket-hit-1";
const THROW_SPEED = 1.15;
const AUTO_THROW_SPEED = 1.7;
const AUTO_PAUSE_MS = 500;
const THROW_FALLBACK_MS = 3400;

// Кривые «наезда» щита внутри Lottie: прогресс броска (0..1 = frame/total) → [масштаб, вертикаль].
// Замерено покадрово по белому стеклу щита (центр + ширина). Щит не просто растёт: его центр
// НЫРЯЕТ вниз (до +0.46 высоты бокса на ~p0.44) и затем ПОДНИМАЕТСЯ, одновременно вырастая
// ×2.33 (от размера в замахе). Чтобы щит выглядел приклеенным к стене, камера фона повторяет
// ровно это движение вокруг центра щита в замахе (origin): scale = s, сдвиг вниз = ty×высота
// бокса. tyFrac — доля высоты бокса (центр щита относительно замаха). У анимаций 3 тайминга:
// hit-2≡miss-1 рано, hit-1 средне, miss-2≡miss-3 поздно. Между точками — линейная интерполяция.
type Cam = [number, number, number]; // [p, scale, tyFrac]
const CAM_FAST: Cam[] = [ // hit-2, miss-1
  [0, 1, 0], [0.233, 1, 0], [0.30, 1.03, 0.291], [0.333, 1.07, 0.358], [0.367, 1.12, 0.404],
  [0.40, 1.19, 0.432], [0.433, 1.29, 0.438], [0.467, 1.45, 0.379], [0.50, 1.66, 0.311],
  [0.533, 1.97, 0.195], [0.567, 2.33, 0.109], [1, 2.33, 0.109],
];
const CAM_SLOW: Cam[] = [ // miss-2, miss-3
  [0, 1, 0], [0.233, 1, 0], [0.30, 1, 0.283], [0.333, 1.03, 0.326], [0.367, 1.07, 0.391],
  [0.40, 1.10, 0.426], [0.433, 1.13, 0.43], [0.467, 1.19, 0.443], [0.50, 1.26, 0.436],
  [0.533, 1.36, 0.422], [0.567, 1.47, 0.371], [0.60, 1.63, 0.301], [0.633, 1.82, 0.206],
  [0.667, 2.05, 0.109], [0.70, 2.30, 0.109], [1, 2.33, 0.109],
];
const CAM_CURVES: Record<string, Cam[]> = {
  "basket-hit-1": [
    [0, 1, 0], [0.235, 1, 0], [0.30, 1.02, 0.29], [0.335, 1.03, 0.358], [0.369, 1.07, 0.414],
    [0.402, 1.13, 0.443], [0.436, 1.19, 0.463], [0.469, 1.28, 0.436], [0.503, 1.39, 0.395],
    [0.536, 1.53, 0.33], [0.57, 1.73, 0.248], [0.603, 1.98, 0.16], [0.637, 2.24, 0.111],
    [0.67, 2.33, 0.109], [1, 2.33, 0.109],
  ],
  "basket-hit-2": CAM_FAST,
  "basket-miss-1": CAM_FAST,
  "basket-miss-2": CAM_SLOW,
  "basket-miss-3": CAM_SLOW,
};
// interpCurve → [scale, tyFrac] линейной интерполяцией по прогрессу p.
function interpCurve(c: Cam[], p: number): [number, number] {
  if (p <= c[0][0]) return [c[0][1], c[0][2]];
  for (let i = 1; i < c.length; i++) {
    if (p <= c[i][0]) {
      const [p0, s0, t0] = c[i - 1];
      const [p1, s1, t1] = c[i];
      const u = (p - p0) / (p1 - p0);
      return [s0 + (s1 - s0) * u, t0 + (t1 - t0) * u];
    }
  }
  const last = c[c.length - 1];
  return [last[1], last[2]];
}
// Центр щита в ЗАМАХЕ в долях Lottie-бокса (точка, вокруг которой масштабируем стену). Замер.
const BOARD_CX0 = 0.5;
const BOARD_CY0 = 0.162;

// Цвет синей стены (ровный навигационный синий, НЕ почти-чёрный). Им красим фон/шапку/панель и
// верх задней стены → когда камера во время броска уезжает и обнажает фон, синева продолжается
// без тёмной (читается как чёрная) полосы и без разрыва.
const WALL = "#18233a";
const TOP = WALL;
const BG_BOTTOM = WALL;

// Растворение мяча на краях бокса: при ПРОМАХЕ мяч вылетает за рамку анимации и раньше резко
// обрезался. Маски-градиенты гасят края (лево/право + низ) → мяч плавно растворяется, а не
// «обрубается». Верх НЕ гасим — там висит щит. Две вложенные маски (FADE_X на обёртке, FADE_Y
// на боксе) перемножаются = пересечение, без капризного mask-composite.
const FADE_X = "linear-gradient(to right, transparent, #000 15%, #000 85%, transparent)";
const FADE_Y = "linear-gradient(to bottom, #000 88%, transparent)";

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

// ── Баскетбольный зал (процедурный SVG, 1-точечная перспектива). Камера за дальней от кольца
//    лицевой, смотрит на кольцо у ЗАДНЕЙ стены. Комната: задняя стена + боковые (без потолка —
//    уходят вверх за кадр), деревянный пол с НАСТОЯЩЕЙ разметкой (зона, штрафной, 3-очковая,
//    полукруг под кольцом). proj(depthFt, latFt) → экран [x,y]: depth 0 — лицевая под кольцом
//    (вверху), растёт К ЗРИТЕЛЮ (вниз); lat 0 — центр, ±25ft — боковые. Точка схода (180,VPY).
// Калибровка перспективы: лицевая линия (depth0) на BASE_Y, ближний край (d=1) у низа (y=720),
// полуширина корта на лицевой = HALF_W. BASE_Y поднята к щиту → разметка ВЫШЕ мяча, мяч стоит на
// корте «с игры» (внутри дуги ≈ 2 очка), а не вплотную под кольцом. Подобрано на композите экрана.
const VPY = 196, BASE_Y = 218, NEAR_FT = 38, HALF_W = 110, FLAT = 0.42;
const SYK = 720 - VPY;
const D0 = SYK / (BASE_Y - VPY);
const FTU = NEAR_FT / (D0 - 1);
const SXK = (HALF_W * D0) / 25;
const proj = (dep: number, lat: number): [number, number] => {
  const d = D0 - dep / FTU;
  return [180 + (SXK * lat) / d, VPY + SYK / d];
};
const cpts = (arr: [number, number][]) => arr.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
const cArc = (a: [number, number], rx: number, ry: number, b: [number, number]) =>
  `M ${a[0].toFixed(1)},${a[1].toFixed(1)} A ${rx.toFixed(1)} ${ry.toFixed(1)} 0 0 0 ${b[0].toFixed(1)},${b[1].toFixed(1)}`;

const C_BL = proj(0, -25), C_BR = proj(0, 25);                 // дальние углы пола = низ задней стены
const C_BACKX = C_BL[0], C_BACKW = C_BR[0] - C_BL[0], C_BASEY = C_BL[1];
const C_FLOOR = cpts([proj(0, -25), proj(0, 25), proj(NEAR_FT, 25), proj(NEAR_FT, -25)]);
const C_FLn = proj(NEAR_FT, -25), C_FRn = proj(NEAR_FT, 25);  // ближние углы пола (за кадром по бокам)
const C_YL0 = C_BL[1] + (C_FLn[1] - C_BL[1]) * ((0 - C_BL[0]) / (C_FLn[0] - C_BL[0]));   // пол↔лев.стена на x=0
const C_YR0 = C_BR[1] + (C_FRn[1] - C_BR[1]) * ((360 - C_BR[0]) / (C_FRn[0] - C_BR[0])); // пол↔прав.стена на x=360
const C_LANE = cpts([proj(0, -8), proj(0, 8), proj(19, 8), proj(19, -8)]);
const C_FTC = proj(19, 0), C_FT_RX = proj(19, 6)[0] - proj(19, 0)[0];
// круги на полу рисуем ПЛОСКИМИ эллипсами (ry ≤ rx·FLAT) — крутая перспектива иначе даёт «стоячий» овал
const C_FT_CY = C_FTC[1], C_FT_RY = Math.min((proj(25, 0)[1] - proj(13, 0)[1]) / 2, C_FT_RX * FLAT);
const C_3L0 = proj(0, -22), C_3L1 = proj(14.19, -22), C_3R0 = proj(0, 22), C_3R1 = proj(14.19, 22);
const C_ARC_RX = (C_3R1[0] - C_3L1[0]) / 2, C_ARC_RY = Math.min(proj(29, 0)[1] - C_3L1[1], C_ARC_RX * 0.7);
const C_ARC = cArc(C_3L1, C_ARC_RX, C_ARC_RY, C_3R1);
const C_RA = cArc(proj(1.25, -4), proj(5.25, 4)[0] - 180, Math.min((proj(9.25, 0)[1] - proj(1.25, 0)[1]) / 2, (proj(5.25, 4)[0] - 180) * FLAT), proj(1.25, 4));
const C_PLANKS = Array.from({ length: 25 }, (_, i) => -24 + i * 2); // lat каждой доски (вдоль корта)
// На сколько (viewBox-единиц) стены и свечение рисуются ВЫШЕ кадра. При наезде камеры вниз во
// время броска эта «надстройка» въезжает сверху → три стены со свечением продолжаются без разрыва.
const C_EXT = 340;

const BasketCourt = memo(function BasketCourt() {
  return (
    <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 360 640" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id="cWood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6a4621" /><stop offset="0.5" stopColor="#925f2c" /><stop offset="1" stopColor="#c08c4c" />
        </linearGradient>
        {/* userSpaceOnUse: цвет/свечение привязаны к координатам, а не к bbox → корректны и в надстройке выше кадра */}
        <linearGradient id="cBack" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={C_BASEY}>
          <stop offset="0" stopColor="#18233a" /><stop offset="1" stopColor="#20304f" />
        </linearGradient>
        <linearGradient id="cLW" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#101a2e" /><stop offset="1" stopColor="#18233a" /></linearGradient>
        <linearGradient id="cRW" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stopColor="#101a2e" /><stop offset="1" stopColor="#18233a" /></linearGradient>
        <radialGradient id="cHoop" gradientUnits="userSpaceOnUse" cx="180" cy="40" r="260"><stop offset="0" stopColor="#cdd9ff" stopOpacity="0.18" /><stop offset="1" stopColor="#cdd9ff" stopOpacity="0" /></radialGradient>
        <radialGradient id="cSpot" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stopColor="#ffe7c2" stopOpacity="0.14" /><stop offset="1" stopColor="#ffe7c2" stopOpacity="0" /></radialGradient>
        <linearGradient id="cVig" x1="0" y1="0" x2="0" y2="1"><stop offset="0.74" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.5" /></linearGradient>
        <clipPath id="cFloorClip"><polygon points={C_FLOOR} /></clipPath>
      </defs>

      {/* комната: 3 стены (задняя + боковые) + свечение, без потолка. Рисуем ВЫШЕ кадра на C_EXT
          (overflow-visible) → при наезде камеры вниз стены со свечением продолжаются вверх без разрыва. */}
      <rect x="0" y={-C_EXT} width="360" height={640 + C_EXT} fill="#18233a" />
      <polygon points={`0,${-C_EXT} ${C_BACKX.toFixed(1)},${-C_EXT} ${C_BACKX.toFixed(1)},${C_BASEY.toFixed(1)} 0,${C_YL0.toFixed(1)}`} fill="url(#cLW)" />
      <polygon points={`360,${-C_EXT} ${C_BR[0].toFixed(1)},${-C_EXT} ${C_BR[0].toFixed(1)},${C_BASEY.toFixed(1)} 360,${C_YR0.toFixed(1)}`} fill="url(#cRW)" />
      <rect x={C_BACKX} y={-C_EXT} width={C_BACKW} height={C_BASEY + C_EXT} fill="url(#cBack)" />
      <rect x="0" y={-C_EXT} width="360" height={C_BASEY + C_EXT + 60} fill="url(#cHoop)" />
      <g stroke="#ffffff" strokeOpacity="0.05" strokeWidth="1">
        <line x1={C_BACKX} y1={-C_EXT} x2={C_BACKX} y2={C_BASEY} /><line x1={C_BR[0]} y1={-C_EXT} x2={C_BR[0]} y2={C_BASEY} />
      </g>

      <polygon points={C_FLOOR} fill="url(#cWood)" />
      <g clipPath="url(#cFloorClip)">
        <g stroke="#3a2410" strokeOpacity="0.55" strokeWidth="1.4">
          {C_PLANKS.map((lat, i) => { const a = proj(0, lat), b = proj(NEAR_FT, lat); return <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />; })}
        </g>
        <g stroke="#e7c79a" strokeOpacity="0.10" strokeWidth="1">
          {C_PLANKS.map((lat, i) => { const a = proj(0, lat + 0.18), b = proj(NEAR_FT, lat + 0.18); return <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />; })}
        </g>
        <ellipse cx="180" cy="430" rx="250" ry="150" fill="url(#cSpot)" />
      </g>

      <g stroke="#f4f1e8" strokeOpacity="0.85" fill="none" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round">
        <line x1={C_BL[0]} y1={C_BASEY} x2={C_BR[0]} y2={C_BASEY} />
        <polygon points={C_LANE} fill="#c2410c" fillOpacity="0.18" />
        <ellipse cx={C_FTC[0]} cy={C_FT_CY} rx={C_FT_RX} ry={C_FT_RY} />
        <line x1={C_3L0[0]} y1={C_3L0[1]} x2={C_3L1[0]} y2={C_3L1[1]} />
        <line x1={C_3R0[0]} y1={C_3R0[1]} x2={C_3R1[0]} y2={C_3R1[1]} />
        <path d={C_ARC} />
        <path d={C_RA} strokeWidth="1.8" />
      </g>

      <rect x="0" y="0" width="360" height="640" fill="url(#cVig)" />
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
  const boxRef = useRef<HTMLDivElement>(null);
  const camCurveRef = useRef<Cam[]>(CAM_CURVES["basket-hit-1"]);
  const camBoxHRef = useRef(0); // высота Lottie-бокса (px), снимается на старте броска
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

  // Камера: в throwing каждый кадр (onThrowFrame) повторяет движение щита — масштаб + сдвиг вниз
  // (camCurve) вокруг центра щита в замахе (origin из позиции Lottie-бокса в рантайме). На старте
  // броска ставим origin, снимаем высоту бокса и сбрасываем transform. На "revealed" камеру НЕ
  // трогаем — держит финал (щит приклеен к стене и в показе результата). На "idle" — возврат к 1.
  useLayoutEffect(() => {
    const c = courtRef.current;
    if (!c) return;
    if (phase === "throwing") {
      const box = boxRef.current;
      if (box) {
        const br = box.getBoundingClientRect();
        camBoxHRef.current = br.height;
        c.style.transformOrigin = `${br.left + br.width * BOARD_CX0}px ${br.top + br.height * BOARD_CY0}px`;
      }
      c.style.transition = "none";                  // кадры драйвят transform напрямую
      c.style.transform = "translateY(0px) scale(1)"; // старт броска: щит мал → зал в 1×
    } else if (phase === "idle") {
      c.style.transition = "transform 700ms cubic-bezier(0.3, 0, 0.2, 1)";
      c.style.transform = "translateY(0px) scale(1)";
    }
    // phase === "revealed": камеру не трогаем — держит финальный зум
  }, [phase, throwSeq]);

  const onThrowFrame = useCallback((p: number) => {
    const c = courtRef.current;
    if (!c) return;
    const [s, tyFrac] = interpCurve(camCurveRef.current, p);
    c.style.transform = `translateY(${tyFrac * camBoxHRef.current}px) scale(${s})`;
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
      camCurveRef.current = CAM_CURVES[res.anim] ?? CAM_CURVES["basket-hit-1"];
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
        <div ref={courtRef} className="pointer-events-none absolute inset-0 will-change-transform">
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
            <div className="h-72 w-72" style={{ WebkitMaskImage: FADE_X, maskImage: FADE_X, WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat" }}>
            <div ref={boxRef} className="grid h-72 w-72 place-items-center" style={{ WebkitMaskImage: FADE_Y, maskImage: FADE_Y, WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat" }}>
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
                  animationData={getLottieData(throwAnim)}
                  className="h-72 w-72"
                  loop={false}
                  autoplay
                  speed={throwSpeed}
                  onFrame={onThrowFrame}
                  onComplete={finalize}
                />
              )}
            </div>
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

          <div className="border-t border-white/10 bg-[#18233a] px-4 pb-3 pt-3">
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
