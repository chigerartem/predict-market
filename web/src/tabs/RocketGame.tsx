import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fetchMe, rocketBet, rocketCashout, rocketStreamUrl, type RocketState } from "../realapi";
import { fmtTon } from "../format";
import { useT } from "../i18n";
import Lottie from "../components/Lottie";
import TonIcon from "../components/TonIcon";

// Должно совпадать с бэкендом (rocket.Config.GrowthPerSec) — по нему локально и
// плавно (rAF) считаем растущий множитель между SSE-тиками. Деньги авторитетны на
// сервере (кешаут пересчитывает множитель сам), это число — только для глаз.
const K = 0.15;
const MIN_NANO = 100_000_000; // 0.1 TON
const PRESETS = [0.1, 1, 5, 25];
const PAD_H = 92; // высота металлического пола (px)
const ROCKET_ROT = -45; // лотти рисует ракету под ~45° → доворачиваем носом строго вверх
const RISE_PX = 140; // макс. подъём ракеты — останавливается НИЖЕ цифр (с зазором)
const CHAR_SRCS = ["/lottie/gift-bee.json", "/lottie/gift-corgi.json", "/lottie/gift-capybara.json"];
const SKY_TOP = "#3f7ad0"; // верхний цвет неба (земля)
const SKY_BOTTOM = "#b8d4f0"; // нижний цвет неба (горизонт)
const SPACE_TOP = "#0a1130"; // верхний цвет космоса
const SPACE_BOTTOM = "#05060f"; // нижний цвет космоса
const BASE_BOTTOM = PAD_H - 35; // боковые ножки ровно касаются пола при REST_SCALE
const CHAR_SPEED = 2.4; // базовая скорость падения эмодзи (px/кадр при 1x); растёт с множителем
const REST_SCALE = 1.25; // на старте ракета крупнее
const FLY_SCALE = 0.92; // в полёте уменьшается (~26% от стартового размера)

// Тактильная отдача Telegram. Мягко глушим, если клиент не поддерживает.
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

const fmtMult = (milli: number) => (milli / 1000).toFixed(2);
// Плавное затемнение: асимптота к 1, БЕЗ плато — фон постепенно темнеет всю дорогу.
// Экспонента 1.2 = темнеет быстрее (Артём: «чтобы космос начинался ещё быстрее»).
// factor: 1.5x≈0.39, 2x≈0.56, 3x≈0.68, 5x≈0.79, 10x≈0.87.
const factorOf = (milli: number) => Math.min(1, Math.max(0, 1 - Math.pow(1000 / Math.max(1000, milli), 1.2)));

function lerpHex(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return "#" + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

// Нормализация ввода ставки: запятая → точка, только цифры/одна точка, и «02» → «0.2»
// (ведущий 0 + цифра без точки = пользователь имел в виду дробь).
function normStake(raw: string): string {
  let s = raw.replace(",", ".").replace(/[^\d.]/g, "");
  const i = s.indexOf(".");
  if (i >= 0) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, ""); // оставляем одну точку
  if (/^0\d/.test(s)) s = "0." + s.slice(1);
  return s;
}

// ── Металлический пол (по мотивам стикера ArtisanBrick #32 — серебристый слиток).
//    Техника как PixelGround: SVG из 1×1 <rect>, плиты «в перевязку» с фаской
//    (светлый верх-лево, тёмная тень низ-право) + бирюзовые заклёпки, тайлим,
//    image-rendering:pixelated. НЕ вставка анимированного стикера — воссоздан стиль.
const M_PAL: Record<string, string> = {
  s: "#2c3350", // глубокий шов
  d: "#676f8a", // тень фаски
  b: "#aeb2bd", // тело металла
  B: "#cdd0d8", // светлый металл
  H: "#ebedf2", // блик
  t: "#33a199", // бирюзовая заклёпка-акцент (из стикера)
};
const PW = 8, PH = 6, MTW = 16, MTH = 12;
function metalChar(x: number, y: number): string {
  const yy = y % PH;
  const off = Math.floor(y / PH) % 2 ? PW / 2 : 0;
  const xx = (x + off) % PW;
  if (yy === PH - 1 || xx === PW - 1) return "s";              // швы (низ + право)
  if (yy === 0 || xx === 0) return "H";                         // фаска: светлый верх/лево
  if (yy === PH - 2 || xx === PW - 2) return "d";               // фаска: тень низ/право
  if ((xx === 1 && yy === 1) || (xx === PW - 3 && yy === PH - 3)) return "t"; // заклёпки
  return (x + y) % 2 === 0 ? "B" : "b";                         // брашированный дизер
}
let metalRects = "";
for (let y = 0; y < MTH; y++) for (let x = 0; x < MTW; x++) {
  metalRects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${M_PAL[metalChar(x, y)]}"/>`;
}
const METAL_URI = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${MTW}" height="${MTH}" shape-rendering="crispEdges">${metalRects}</svg>`,
)}")`;

// ── Фейковая лента «живых ставок» (реальных чужих не показываем — решение продукта).
// Юзернеймы с замазанными последними символами (приватность-вид), иногда один и тот
// же подряд (как будто человек заходит в пару сделок).
// Не «придуманные» крипто-клише, а как у живых людей: имя+цифры, лит, обрывки слов.
const USERNAMES = [
  "mxr_88", "dnk240", "alexbtw", "p1xel", "v0vchik", "n1kita7", "sashka93", "qz_777",
  "lol1337", "denis_k", "anton4ik", "kr1ss", "zhenya21", "max_05", "tema777", "vrtx_",
  "s_lavik", "egor_xd", "muffin42", "k0sty4", "andr3y", "n0va99", "frog_22", "dm1try",
  "ilya06", "x_roma", "kat14", "serg_ai", "y0lo99", "b0bre", "lexa_m", "pavel_nft",
  "wsp_13", "g1ga", "to4ka", "ne0n_", "ruslan9", "z3ro_x", "miha777", "art3m_k",
];
const STAKES = [0.2, 0.5, 1, 1, 2, 2, 3, 5, 5, 10, 15, 25];

type Fake = { name: string; stake: number; target: number };

// Замазываем последние 1-3 символа точками (последние символы не видны).
function maskName(u: string): string {
  const hide = Math.min(3, Math.max(1, u.length - 3));
  return "@" + u.slice(0, u.length - hide) + "•".repeat(hide);
}

function genFeed(): Fake[] {
  const n = 8 + Math.floor(Math.random() * 8);
  const out: Fake[] = [];
  let prev = "";
  for (let i = 0; i < n; i++) {
    // иногда тот же юзернейм подряд (≈22%)
    const same = prev !== "" && Math.random() < 0.22;
    const u = same ? prev : USERNAMES[Math.floor(Math.random() * USERNAMES.length)];
    prev = u;
    const stake = STAKES[Math.floor(Math.random() * STAKES.length)];
    const greedy = Math.random() < 0.18;
    const target = greedy ? 3000 + Math.floor(Math.random() * 12000) : 1200 + Math.floor(Math.random() * 2000);
    out.push({ name: maskName(u), stake, target });
  }
  return out;
}

type Char = { id: number; src: string; left: number; y: number }; // y — позиция в px от верха экрана

export default function RocketGame({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [st, setSt] = useState<RocketState | null>(null);
  const [balanceNano, setBalanceNano] = useState(0);
  const [stake, setStake] = useState("0.1");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [myBet, setMyBet] = useState<{ roundId: number; stakeNano: number } | null>(null);
  const [cashed, setCashed] = useState<{ mult: number; payout: number } | null>(null);

  const [liveMult, setLiveMult] = useState(1000);
  const flyStartRef = useRef<number | null>(null);

  const [feed, setFeed] = useState<Fake[]>(() => genFeed());
  const [groundFactor, setGroundFactor] = useState(0); // затемнение фона на земле — плавно гаснет после взрыва
  const [chars, setChars] = useState<Char[]>([]);
  const charId = useRef(0);
  const lastHapticStep = useRef(0); // веха вибрации по множителю
  const clipRef = useRef<HTMLDivElement>(null);

  // Клавиатура: ужимаем ВНУТРЕННИЙ clip-слой (корень — стабильно-тёмный во весь экран).
  // Синхроним по rAF КАЖДЫЙ кадр, а НЕ по resize/scroll-событиям: в Telegram/iOS события
  // клавиатуры приходят с пропусками и устаревшими значениями → слой «рвётся через раз»
  // (тот же приём, что в cashback). Ключ против голубого разрыва: когда поле НЕ в фокусе
  // (клава закрывается) → высота СРАЗУ = window.innerHeight (полный экран), чтобы уезжающая
  // клавиатура открывала уже полноразмерную игру, а не растущую снизу. В фокусе → vv.height
  // (над клавой) + сдвиг на vv.offsetTop. На iOS vv.height после закрытия залипает
  // уменьшенным — поэтому в расфокусе берём именно innerHeight.
  // ПЕРВЫЙ sync — синхронно до первого paint (useLayoutEffect), иначе первый кадр
  // рисуется по инлайновой --app-h, а следующий по innerHeight → экран «доводится на
  // место» при входе из Games. Дальше rAF держит синхрон под клавиатуру.
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
        lastH = h;
        lastT = tY;
      }
    };
    sync(); // синхронно до первого paint
    const loop = () => { sync(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const phase = st?.phase;
  const roundId = st?.round_id;

  const reloadBalance = useCallback(() => {
    fetchMe().then((m) => setBalanceNano(m.balance_nano)).catch(() => {});
  }, []);
  useEffect(reloadBalance, [reloadBalance]);

  // Плашка Telegram: каждый setHeaderColor перекрашивает нативный бар → название аппки
  // и «⋮» мерцают (Telegram подкрашивает их под контраст). Поэтому красим РЕДКО —
  // только при смене крупной ступени цвета (квантуем фактор на 4 ступени → ~4 перекраски
  // за полёт), а не покадрово. Дедуп по hex.
  const lastHeaderHex = useRef("");
  const applyHeader = useCallback((sf: number) => {
    const banded = Math.round(Math.max(0, Math.min(1, sf)) * 4) / 4; // 0 / .25 / .5 / .75 / 1
    const hex = lerpHex(SKY_TOP, SPACE_TOP, banded);
    if (hex === lastHeaderHex.current) return;
    lastHeaderHex.current = hex;
    try {
      window.Telegram?.WebApp?.setHeaderColor?.(hex);
    } catch { /* старый клиент */ }
  }, []);

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

  useEffect(() => {
    if (!err) return;
    const tm = window.setTimeout(() => setErr(null), 2500);
    return () => window.clearTimeout(tm);
  }, [err]);

  // SSE со встроенной устойчивостью. Голый EventSource в Telegram WebView ненадёжен:
  // при рестарте бэкенда или сетевом сбое соединение часто «зависает» полуоткрытым —
  // TCP мёртв, а события `error` не приходит, стрим молча встаёт, и игра замирает
  // (локальный счётчик добегает до потолка). Поэтому: (1) onerror → пересоздаём;
  // (2) СТОРОЖ — сервер шлёт состояние не реже раза в 500мс, так что тишина >4с = мёртвое
  // соединение → принудительно переподключаемся (ловит как раз «полуоткрытые» дыры WebView).
  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer = 0;
    let lastMsg = performance.now();
    let closed = false;

    const connect = () => {
      es?.close();
      es = new EventSource(rocketStreamUrl());
      es.onmessage = (e) => {
        lastMsg = performance.now();
        try {
          setSt(JSON.parse(e.data) as RocketState);
        } catch { /* битый кадр */ }
      };
      es.onerror = () => {
        if (closed) return;
        window.clearTimeout(reconnectTimer);
        reconnectTimer = window.setTimeout(() => { if (!closed) connect(); }, 1000);
      };
    };
    connect();

    const watchdog = window.setInterval(() => {
      if (closed) return;
      if (performance.now() - lastMsg > 4000) {
        lastMsg = performance.now(); // не долбить переподключением каждую секунду
        connect();
      }
    }, 1000);

    return () => {
      closed = true;
      window.clearTimeout(reconnectTimer);
      window.clearInterval(watchdog);
      es?.close();
    };
  }, []);

  const prevRound = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (roundId !== undefined && roundId !== prevRound.current) {
      prevRound.current = roundId;
      setMyBet(null);
      setCashed(null);
      setErr(null);
      setFeed(genFeed());
    }
  }, [roundId]);

  useEffect(() => {
    if (phase === "FLYING") {
      const sm = Math.max(1000, st?.multiplier_milli ?? 1000);
      // Ре-синк со СЕРВЕРОМ: при первом старте, а также если локальная оценка далеко
      // ушла от серверной (возврат из фона: performance.now() накапливает время простоя
      // → exp(огромный) → 10-15 цифр). Тогда пересчитываем старт от серверного множителя.
      let resync = flyStartRef.current == null;
      if (!resync && flyStartRef.current != null) {
        const implied = 1000 * Math.exp(K * ((performance.now() - flyStartRef.current) / 1000));
        if (implied > sm * 1.3 || implied < sm * 0.7) resync = true;
      }
      if (resync) flyStartRef.current = performance.now() - (Math.log(sm / 1000) / K) * 1000;
    } else {
      flyStartRef.current = null;
      if (phase === "CRASHED") setLiveMult(st?.crash_milli ?? st?.multiplier_milli ?? 1000);
      if (phase === "BETTING") setLiveMult(1000);
    }
  }, [phase, st?.multiplier_milli, st?.crash_milli]);

  useEffect(() => {
    if (phase !== "FLYING") return;
    let raf = 0;
    lastHapticStep.current = Math.floor((st?.multiplier_milli ?? 1000) / 100); // без всплеска на старте
    const tick = () => {
      const start = flyStartRef.current;
      if (start != null) {
        const m = Math.min(1_000_000, Math.floor(1000 * Math.exp(K * ((performance.now() - start) / 1000))));
        setLiveMult(m);
        applyHeader(factorOf(m)); // плашка следует за фоном плавно
        // Вибрация по вехам множителя (каждые 0.1x / десятые): чем быстрее растёт x,
        // тем чаще вехи → отдача ускоряется вместе с ракетой (макс. 1 тик/кадр).
        const step = Math.floor(m / 100);
        if (step !== lastHapticStep.current) {
          lastHapticStep.current = step;
          haptic("light");
        }
        // Эмодзи падают со скоростью, растущей вместе с множителем (параллакс
        // ускорения): медленно на старте, быстрее по мере разгона. Уносим за низ экрана.
        const speed = CHAR_SPEED * (m / 1000);
        const limit = window.innerHeight + 90;
        setChars((cs) => {
          if (!cs.length) return cs; // нет персонажей → не плодим новый массив (и ре-рендер) каждый кадр
          const moved = cs.map((c) => ({ ...c, y: c.y + speed }));
          return moved.some((c) => c.y > limit) ? moved.filter((c) => c.y <= limit) : moved;
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  // Большой «пам» на крахе (один раз при входе в CRASHED).
  useEffect(() => {
    if (phase === "CRASHED") {
      haptic("heavy");
      hapticNotify("error");
    }
  }, [phase, roundId]);

  // Пролетающие персонажи — только в полёте, по одному, НЕ под ракетой (по краям).
  useEffect(() => {
    if (phase !== "FLYING") {
      setChars([]);
      return;
    }
    const spawn = () => {
      const onLeft = Math.random() < 0.5;
      const c: Char = {
        id: ++charId.current,
        src: CHAR_SRCS[Math.floor(Math.random() * CHAR_SRCS.length)],
        left: onLeft ? 3 + Math.random() * 22 : 71 + Math.random() * 22, // края, не центр
        y: -70, // над верхом экрана → выпадают из-под плашки Mini App
      };
      setChars((cs) => [...cs, c].slice(-3));
    };
    const iv = window.setInterval(spawn, 1500 + Math.random() * 1200);
    return () => window.clearInterval(iv);
  }, [phase]);

  const balanceTon = balanceNano / 1e9;
  const haveBet = !!myBet && myBet.roundId === roundId;
  const displayMult = phase === "FLYING" ? liveMult : phase === "CRASHED" ? st?.crash_milli ?? liveMult : 1000;
  const crashed = phase === "CRASHED";
  const flying = phase === "FLYING";
  // Ракета/пол возвращаются ТОЛЬКО на старте (BETTING), а НЕ во время крашевых иксов
  // — иначе готовая ракета показывается одновременно с красными иксами (бесит Артёма).
  const onGround = phase === "BETTING" || phase === undefined;

  // Высота/темнота. На земле всё в нуле (ракета на полу, светло). Подъём — только в
  // полёте; во взрыве замираем на высоте краша. Так после взрыва нет дёрганья.
  const flyFactor = factorOf(liveMult);
  const crashFactor = factorOf(st?.crash_milli ?? 1000);
  const spaceFactor = flying ? flyFactor : groundFactor;
  const rocketRise = flying ? flyFactor * RISE_PX : 0;
  const explodeRise = crashFactor * RISE_PX;
  const rocketScale = flying ? FLY_SCALE : REST_SCALE; // крупнее на земле, меньше в полёте
  // Один градиент с лерпом цвета (НЕ два слоя с кросс-фейдом — он давал мутную тёмную
  // смесь в середине перехода). Квантуем фактор фона и звёзд: цвет/прозрачность идут
  // мелкими ступенями (для глаза плавно), но строка стиля и пропс StarField стабильны
  // между кадрами → React не пишет в DOM → нет полноэкранной перерисовки градиента и
  // реконсиляции 50 звёзд каждый кадр. Трансформы (подъём/масштаб) остаются покадровыми.
  const bgFactor = Math.round(spaceFactor * 80) / 80;
  const starOpacity = Math.round(spaceFactor * 40) / 40;
  const bgTop = lerpHex(SKY_TOP, SPACE_TOP, bgFactor);
  const bgBottom = lerpHex(SKY_BOTTOM, SPACE_BOTTOM, bgFactor);

  // Фон при крахе темнее старта → гасим его до светлого ПЛАВНО за всю паузу (а не
  // прыжком на BETTING). Едем crashFactor→0 от момента краха.
  useEffect(() => {
    if (crashed) {
      const from = factorOf(st?.crash_milli ?? 1000);
      const DUR = 2000;
      const t0 = performance.now();
      let raf = 0;
      const ease = () => {
        const k = Math.min(1, (performance.now() - t0) / DUR);
        const e = 1 - (1 - k) * (1 - k); // ease-out
        const f = from * (1 - e);
        setGroundFactor(f);
        // applyHeader тут НЕ зовём: иначе плашка спускается по всем ступеням, пока
        // экран уже светлый. Плашка остаётся тёмной до BETTING → там один скачок на небо.
        if (k < 1) raf = requestAnimationFrame(ease);
      };
      setGroundFactor(from);
      raf = requestAnimationFrame(ease);
      return () => cancelAnimationFrame(raf);
    }
    setGroundFactor(0);
  }, [crashed, st?.crash_milli]);

  // Плашка Telegram = цвет верхнего пикселя экрана (плавно лерпим небо→космос).
  // Квантуем на 16 ступеней, чтобы не дёргать setHeaderColor каждый кадр.
  // В статичных фазах (BETTING/земля) плашка = верх неба. В полёте/крахе её красит
  // applyHeader из rAF (плавно).
  useEffect(() => {
    if (!flying && !crashed) {
      lastHeaderHex.current = SKY_TOP;
      try {
        window.Telegram?.WebApp?.setHeaderColor?.(SKY_TOP);
      } catch { /* старый клиент */ }
    }
  }, [flying, crashed]);

  // Фон viewport (виден под клавиатурой) — тёмный экранный, НЕ голубой. App при
  // фокусе поля красит его в свои цвета (вкл. голубой на focusout) — перехватываем
  // обе фокус-события и держим тёмный (наш листенер регистрируется позже → он последний).
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    const dark = () => { try { tg?.setBackgroundColor?.("#05060f"); } catch { /* старый клиент */ } };
    dark();
    document.addEventListener("focusin", dark);
    document.addEventListener("focusout", dark);
    return () => {
      document.removeEventListener("focusin", dark);
      document.removeEventListener("focusout", dark);
    };
  }, []);
  useEffect(() => {
    return () => {
      const tg = window.Telegram?.WebApp;
      try {
        tg?.setHeaderColor?.("#5CCBFF");
        tg?.setBackgroundColor?.("#5CCBFF");
      } catch { /* старый клиент */ }
    };
  }, []);

  const placeBet = async () => {
    if (busy || phase !== "BETTING" || haveBet) return;
    const nano = Math.round((Number(stake) || 0) * 1e9);
    if (nano < MIN_NANO) { setErr(t("rocket.min")); return; }
    if (nano > balanceNano) { setErr(t("rocket.insufficient")); return; }
    setBusy(true);
    setErr(null);
    try {
      const r = await rocketBet(nano);
      setMyBet({ roundId: r.round_id, stakeNano: nano });
      reloadBalance();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const cashout = async () => {
    if (busy || phase !== "FLYING" || !haveBet || cashed) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await rocketCashout();
      setCashed({ mult: r.multiplier_milli, payout: r.payout_nano });
      hapticNotify("success");
      reloadBalance();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed left-0 top-0 z-50 w-full overflow-hidden bg-[#05060f] text-white" style={{ height: "var(--app-h, 100dvh)" }}>
      {/* Корень — полноэкранный ТЁМНЫЙ щит (z-50 над голубой вкладкой Games). Высота =
          --app-h (viewportStableHeight, см. main.tsx) — СТАБИЛЬНАЯ, в отличие от 100dvh:
          в Telegram Android клавиатура ужимает dvh, и «полноэкранный» корень становился
          коротким → под ним оголялся голубой фон вкладки (та самая вспышка). --app-h на
          клавиатуру не реагирует → корень всегда кроет весь экран тёмным, голубому неоткуда
          взяться ни на кадр. Небо/игра — во внутреннем clip-слое, он и ужимается под клаву. */}
      <div ref={clipRef} className="absolute inset-x-0 top-0 overflow-hidden" style={{ height: "var(--app-h, 100dvh)" }}>
        {/* Фон: градиент небо→космос. ABSOLUTE → клипается высотой clip-слоя (=
            visualViewport): голубой низ неба не попадает в зону клавиатуры → нет вспышки.
            Цвет из квантованного bgFactor → строка стабильна между кадрами → нет 60fps
            перерисовки всего экрана. */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: `linear-gradient(to bottom, ${bgTop} 0%, ${bgBottom} 100%)` }}
        />
      <StarField opacity={starOpacity} />

      {/* Пролетающие персонажи — полноэкранный слой, падают с самого верха (из-под
          плашки Mini App). z между фоном и контентом → за панелями/ракетой. */}
      {flying && (
        <div className="pointer-events-none absolute inset-0 z-[5]">
          {chars.map((c) => (
            <div
              key={c.id}
              className="absolute top-0"
              style={{ left: `${c.left}%`, transform: `translateY(${c.y}px)`, willChange: "transform" }}
            >
              <Lottie src={c.src} className="h-16 w-16" />
            </div>
          ))}
        </div>
      )}

      {/* Скролл-слой: первый экран = игра, ниже доскролл к ленте. Без пружинки. */}
      <div
        data-allow-scroll
        className="relative z-10 h-full overflow-y-auto overscroll-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <section className="relative flex min-h-full flex-col">
          {/* Заголовок и баланс убраны: сверху только история, всё поднято к плашке.
              Кнопка «Назад» — нативная Telegram. */}
          <div className="px-4 pb-1" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-white/50">{t("rocket.history")}</div>
            <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {(st?.history ?? []).map((m, i) => (
                <span
                  key={i}
                  className={
                    "shrink-0 rounded-md px-2 py-1 text-xs font-bold tabular-nums " +
                    (m >= 2000 ? "bg-emerald-500/25 text-emerald-200" : m >= 1500 ? "bg-amber-500/25 text-amber-100" : "bg-rose-500/25 text-rose-200")
                  }
                >
                  {fmtMult(m)}x
                </span>
              ))}
            </div>
          </div>

          {/* Сцена */}
          <div className="relative flex-1 overflow-hidden">
            {/* Ракета / взрыв */}
            {crashed ? (
              <RocketWreck key="wreck" bottom={BASE_BOTTOM + explodeRise} />
            ) : (
              // L1 позиция+подъём (покадрово) → L2 масштаб с якорем к низу (ножки на
              // месте при изменении размера) → L3 поворот вокруг центра. key="rocket" →
              // монтируется заново на BETTING сразу в REST_SCALE (без анимации роста).
              <div
                key="rocket"
                className="absolute left-1/2 z-0"
                style={{
                  bottom: BASE_BOTTOM,
                  transform: `translateX(-50%) translateY(${-rocketRise}px)`,
                  willChange: "transform",
                }}
              >
                <div style={{ transform: `scale(${rocketScale})`, transformOrigin: "50% 100%", transition: "transform 2400ms ease-in-out" }}>
                  <div style={{ transform: `rotate(${ROCKET_ROT}deg) translateZ(0)` }}>
                    <Lottie src="/lottie/rocket.json" className="h-40 w-40" autoplay={flying} />
                  </div>
                </div>
              </div>
            )}

            {/* Металлический пол. На земле уже на месте (без выезда); на взлёте уезжает
                вниз. Возврат — мгновенный (transition только при УХОДЕ), чтобы после
                взрыва пол просто стоял, а не «выезжал». */}
            <div
              aria-hidden
              className="absolute inset-x-0 bottom-0 z-20"
              style={{
                height: PAD_H,
                backgroundImage: METAL_URI,
                backgroundRepeat: "repeat",
                backgroundSize: "56px auto",
                imageRendering: "pixelated",
                transform: onGround ? "translateY(0)" : "translateY(135%)",
                transition: onGround ? "none" : "transform 600ms ease-in",
                boxShadow: "inset 0 7px 10px -6px rgba(255,255,255,0.35), inset 0 -6px 12px -6px rgba(0,0,0,0.6)",
              }}
            />
          </div>

          {/* Нижняя панель управления */}
          <div className="border-t border-white/10 bg-[#070b18] px-4 pt-3 pb-3">
            <ResultLine haveBet={haveBet} cashed={cashed} crashed={crashed} t={t} />
            {err && <p className="mb-2 text-center text-xs text-rose-400">{err}</p>}

            {phase === "FLYING" && haveBet && !cashed ? (
              <button
                onClick={cashout}
                disabled={busy}
                className="w-full rounded-2xl bg-gradient-to-r from-emerald-400 to-green-600 py-4 text-lg font-black text-white shadow-lg shadow-emerald-500/40 transition active:scale-[0.99] disabled:opacity-50"
              >
                {t("rocket.cashout")} · {fmtTon(((myBet?.stakeNano ?? 0) / 1e9 * displayMult) / 1000)} TON
              </button>
            ) : (
              <>
                <div className="mb-2 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] pl-3.5 pr-2">
                  <TonIcon size={18} />
                  <input
                    inputMode="decimal"
                    value={stake}
                    onChange={(e) => setStake(normStake(e.target.value))}
                    className="min-w-0 flex-1 bg-transparent py-3 text-base tabular-nums outline-none placeholder:text-white/30"
                    placeholder="0.0"
                    disabled={haveBet}
                  />
                  {/* Баланс справа: тап = поставить максимум (заменил пресеты тут). */}
                  <button
                    onClick={() => setStake(balanceTon > 0 ? String(Math.floor(balanceTon * 100) / 100) : "0")}
                    disabled={haveBet}
                    className="flex shrink-0 items-center gap-1 rounded-xl bg-white/10 px-2.5 py-1.5 text-sm font-bold tabular-nums text-white/80 active:scale-95 disabled:opacity-40"
                  >
                    <TonIcon size={13} />
                    {fmtTon(balanceTon)}
                  </button>
                </div>

                {/* Пресеты — под полем ввода, на всю ширину. */}
                <div className="mb-2.5 grid grid-cols-4 gap-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p}
                      onClick={() => setStake(String(p))}
                      disabled={haveBet}
                      className="rounded-xl border border-white/10 bg-white/[0.05] py-2.5 text-sm font-bold tabular-nums text-sky-300 active:scale-95 disabled:opacity-40"
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <button
                  onClick={placeBet}
                  disabled={busy || phase !== "BETTING" || haveBet}
                  className="w-full rounded-2xl bg-gradient-to-r from-sky-400 to-blue-600 py-4 text-base font-black text-white shadow-lg shadow-sky-500/30 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {haveBet
                    ? t("rocket.placed")
                    : phase === "BETTING"
                      ? `${t("rocket.place")} · ${fmtTon(Number(stake) || 0)} TON`
                      : t("rocket.waitNext")}
                </button>
              </>
            )}

            <div className="mt-2 flex items-center justify-center gap-1 text-[11px] font-medium text-white/40">
              {t("rocket.liveBets")}
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 animate-bounce" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </div>
          </div>

          {/* Множитель/отсчёт — на уровне секции (вне overflow-hidden сцены), иначе
              его glow обрезается краем сцены в «квадрат». */}
          <div className="pointer-events-none absolute inset-x-0 top-[16%] z-30 flex flex-col items-center">
            {phase === "BETTING" ? (
              <>
                <div className="text-sm font-semibold text-white/85">{t("rocket.starting")}</div>
                <div className="mt-1 text-5xl font-black tabular-nums text-white">
                  {Math.ceil((st?.time_left_ms ?? 0) / 1000)}
                </div>
              </>
            ) : (
              <div
                className={
                  "text-[64px] font-black leading-none tabular-nums transition-colors " +
                  (crashed ? "text-rose-400" : "text-white")
                }
              >
                {fmtMult(displayMult)}x
              </div>
            )}
            {crashed && <div className="mt-2 text-lg font-bold text-rose-300">{t("rocket.flyingAway")}</div>}
          </div>
        </section>

        {/* ── Лента ставок (доскролл вниз) ── */}
        <section className="bg-[#05060f] px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-2">
          <FeedList feed={feed} phase={phase} liveMult={Math.round(liveMult / 50) * 50} crash={st?.crash_milli} t={t} />
          <div className="mt-4 truncate text-center text-[10px] text-white/25">
            {t("rocket.fair")} · {st?.seed ? `🔓 ${st.seed.slice(0, 16)}…` : st?.seed_hash ? `🔒 ${st.seed_hash.slice(0, 16)}…` : ""}
          </div>
        </section>
      </div>
      </div>
    </div>
  );
}

// Обломки ракеты при крахе: две половины лотти, обрезанные по горизонтали (верх=нос /
// низ=корпус) через clip-path, лотти заморожен (autoplay=false → застывший кадр без
// пламени). Каждая половина — твёрдое тело с собственной физикой (rAF): взрыв
// подбрасывает её вверх и в сторону, гравитация тянет вниз, и половина кувыркается
// (нос и корпус крутятся в разные стороны) → падают боком по дуге, а не строго вниз.
// Слои на кусок: fly (полёт — translate по параболе) → spin (кувырок вокруг центра
// своей половины) → clip (обрезка) → scale/rotate лотти.
// memo: родитель тикает groundFactor ~60fps после краха; без memo React на каждом
// ре-рендере затирал бы наши прямые style-записи начальным transform из JSX.
const RocketWreck = memo(function RocketWreck({ bottom }: { bottom: number }) {
  const noseFly = useRef<HTMLDivElement>(null);
  const noseSpin = useRef<HTMLDivElement>(null);
  const bodyFly = useRef<HTMLDivElement>(null);
  const bodySpin = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const G = 1500; // гравитация, px/с²
    const dir = Math.random() < 0.5 ? 1 : -1; // зеркалим разлёт, чтобы нос не всегда влево
    // y растёт вниз; отрицательный vy = подброс вверх. Нос лёгкий — выше летит и в
    // сторону dir; корпус тяжёлый — слабее вверх, в другую сторону. Кувырок — в
    // противоположные стороны (va знак). Знаки va подобраны так, что верх каждой
    // половины уходит наружу — как будто их разорвало в середине.
    const pieces = [
      { fly: noseFly, spin: noseSpin, x: 0, y: 0, vx: dir * rnd(70, 140), vy: rnd(-360, -270), a: 0, va: -dir * rnd(150, 240) },
      { fly: bodyFly, spin: bodySpin, x: 0, y: 0, vx: -dir * rnd(70, 130), vy: rnd(-210, -120), a: 0, va: dir * rnd(140, 220) },
    ];
    let raf = 0;
    const t0 = performance.now();
    let prev = t0;
    const tick = () => {
      const now = performance.now();
      let dt = (now - prev) / 1000;
      prev = now;
      if (dt > 0.05) dt = 0.05; // клемп: возврат из фона не должен «телепортировать» куски
      const life = (now - t0) / 1000;
      const fade = life < 1.9 ? 1 : Math.max(0, 1 - (life - 1.9) / 0.6);
      for (const p of pieces) {
        p.vy += G * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.a += p.va * dt;
        if (p.fly.current) {
          p.fly.current.style.transform = `translate(calc(-50% + ${p.x.toFixed(1)}px), ${p.y.toFixed(1)}px)`;
          p.fly.current.style.opacity = fade.toFixed(2);
        }
        if (p.spin.current) p.spin.current.style.transform = `rotate(${p.a.toFixed(1)}deg)`;
      }
      if (life < 2.6) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <>
      {/* нос (верхняя половина) — кувырок вокруг центра видимой части (~29% по высоте) */}
      <div ref={noseFly} className="pointer-events-none absolute left-1/2 z-30" style={{ bottom, transform: "translateX(-50%)", willChange: "transform, opacity" }}>
        <div ref={noseSpin} className="h-40 w-40" style={{ transformOrigin: "50% 29%", willChange: "transform" }}>
          <div style={{ clipPath: "inset(0 0 50% 0)" }}>
            <div style={{ transform: `scale(${FLY_SCALE})`, transformOrigin: "50% 100%" }}>
              <div style={{ transform: `rotate(${ROCKET_ROT}deg)` }}>
                <Lottie src="/lottie/rocket.json" className="h-40 w-40" autoplay={false} />
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* корпус (нижняя половина) — кувырок вокруг центра видимой части (~77% по высоте) */}
      <div ref={bodyFly} className="pointer-events-none absolute left-1/2 z-30" style={{ bottom, transform: "translateX(-50%)", willChange: "transform, opacity" }}>
        <div ref={bodySpin} className="h-40 w-40" style={{ transformOrigin: "50% 77%", willChange: "transform" }}>
          <div style={{ clipPath: "inset(50% 0 0 0)" }}>
            <div style={{ transform: `scale(${FLY_SCALE})`, transformOrigin: "50% 100%" }}>
              <div style={{ transform: `rotate(${ROCKET_ROT}deg)` }}>
                <Lottie src="/lottie/rocket.json" className="h-40 w-40" autoplay={false} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
});

function ResultLine({ haveBet, cashed, crashed, t }: { haveBet: boolean; cashed: { mult: number; payout: number } | null; crashed: boolean; t: ReturnType<typeof useT> }) {
  if (cashed) {
    return (
      <div className="mb-2.5 rounded-xl bg-emerald-500/15 py-2 text-center text-sm font-bold text-emerald-300">
        {t("rocket.cashedOut", { m: `${fmtMult(cashed.mult)}x` })} · {t("rocket.youWon", { amount: fmtTon(cashed.payout / 1e9) })}
      </div>
    );
  }
  if (haveBet && crashed) {
    return <div className="mb-2.5 rounded-xl bg-rose-500/15 py-2 text-center text-sm font-bold text-rose-300">{t("rocket.youLost")}</div>;
  }
  return null;
}

const FeedList = memo(function FeedList({ feed, phase, liveMult, crash, t }: { feed: Fake[]; phase: string | undefined; liveMult: number; crash?: number; t: ReturnType<typeof useT> }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-white/45">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
        {t("rocket.liveBets")}
      </div>
      <div className="space-y-1.5">
        {feed.map((p, i) => {
          let status: "pending" | "won" | "lost" = "pending";
          if (phase === "FLYING" && liveMult >= p.target) status = "won";
          else if (phase === "CRASHED") status = crash != null && p.target <= crash ? "won" : "lost";
          const payout = (p.stake * p.target) / 1000;
          return (
            <div
              key={i}
              className={
                "flex items-center gap-2.5 rounded-xl px-3 py-2.5 " +
                (status === "won" ? "bg-emerald-500/10" : status === "lost" ? "bg-rose-500/10" : "bg-white/[0.04]")
              }
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 text-[11px] font-bold text-white/70">
                {(p.name.replace("@", "")[0] ?? "?").toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-white/80">{p.name}</span>
              <span className="flex items-center gap-1 text-sm tabular-nums text-white/50">
                <TonIcon size={12} />
                {p.stake}
              </span>
              <span
                className={
                  "w-24 text-right text-sm font-bold tabular-nums " +
                  (status === "won" ? "text-emerald-400" : status === "lost" ? "text-rose-400" : "text-white/30")
                }
              >
                {status === "won" ? `${fmtMult(p.target)}x · +${fmtTon(payout)}` : status === "lost" ? "✕" : "···"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

// memo: пропс opacity квантован (40 ступеней) → между кадрами обычно тот же → React
// пропускает реконсиляцию 50 звёзд. Меняется только на смене ступени.
const StarField = memo(function StarField({ opacity }: { opacity: number }) {
  const stars = useMemo(
    () =>
      Array.from({ length: 50 }, () => ({
        left: `${(Math.random() * 100).toFixed(2)}%`,
        top: `${(Math.random() * 85).toFixed(2)}%`,
        size: Math.random() < 0.3 ? 2 : 1,
        o: 0.3 + Math.random() * 0.6,
      })),
    [],
  );
  return (
    <div className="pointer-events-none absolute inset-0" style={{ opacity, willChange: "opacity" }}>
      {stars.map((s, i) => (
        <span key={i} className="absolute rounded-full bg-white" style={{ left: s.left, top: s.top, width: s.size, height: s.size, opacity: s.o }} />
      ))}
    </div>
  );
});
