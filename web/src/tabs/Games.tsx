import { useEffect, useState, type CSSProperties } from "react";
import { useT, type TKey } from "../i18n";
import { asset } from "../assets";
import Lottie from "../components/Lottie";
import RocketGame from "./RocketGame";
import DiceGame from "./DiceGame";
import CaseGame from "./CaseGame";
import BasketGame from "./BasketGame";

// Экран «Игры» — казино-раздел. Полностью голубой фон (см. App: blueTab+fullBlue),
// по нему рандомно падают эмодзи из паков (лягушка/гем/тыква/кот). Карточки —
// в стиле депозитных блоков (яркий градиент-тинт + крупная иконка слева).
// Заголовка экрана нет намеренно — раздел подписан в нижней менюшке.
type Game = {
  id: string;
  titleKey: TKey;
  descKey: TKey;
  iconSrc: string;
  iconFrame: number;        // кадр заморозки → чистая статичная иконка
  iconStyle: CSSProperties; // transform: центровка контента иконки (замерено по bbox кадра)
  tint: string;             // градиент карточки (контраст к доминирующему цвету иконки)
  ready: boolean;
};

// Цвета карточек — КОМПЛЕМЕНТАРНЫ цвету иконки (цветовой круг), чтобы иконка не сливалась:
// ракета (красно-оранж) → синяя; кубик (белый) → зелёная (казино-фетр); подарок (синий) →
// золото; мяч (оранж) → фиолетовая. iconStyle центрирует контент (у кубика/подарка он смещён
// вниз в своём кадре — отсюда было «кубик внизу»).
const GAMES: Game[] = [
  {
    id: "rocket",
    titleKey: "games.rocketTitle",
    descKey: "games.rocketDesc",
    iconSrc: "/lottie/rocket.json", iconFrame: 120, iconStyle: { transform: "translate(2.7%, 5.1%) scale(1.09)" },
    tint: "bg-gradient-to-br from-[#3b82f6] to-[#1d4ed8] shadow-blue-700/40",
    ready: true,
  },
  {
    id: "dice",
    titleKey: "games.diceTitle",
    descKey: "games.diceDesc",
    iconSrc: "/lottie/dice-6.json", iconFrame: 179, iconStyle: { transform: "translateY(-28.5%) scale(1.58)" },
    tint: "bg-gradient-to-br from-[#22c55e] to-[#15803d] shadow-green-700/40",
    ready: true,
  },
  {
    id: "case",
    titleKey: "games.caseTitle",
    descKey: "games.caseDesc",
    iconSrc: "/lottie/gift.json", iconFrame: 90, iconStyle: { transform: "translate(0.6%, -14.5%) scale(1.19)" },
    tint: "bg-gradient-to-br from-[#fbbf24] to-[#d97706] shadow-amber-700/40",
    ready: true,
  },
  {
    id: "basket",
    titleKey: "games.basketTitle",
    descKey: "games.basketDesc",
    iconSrc: "/lottie/basket-hit-1.json", iconFrame: 0, iconStyle: { transform: "translate(-0.7%, -2.1%) scale(0.98)" },
    tint: "bg-gradient-to-br from-[#a855f7] to-[#6d28d9] shadow-violet-700/40",
    ready: true,
  },
];

// Эмодзи-дождь из паков. Производительность: НЕ lottie (его RAF на десятках сложных
// SVG лагал), а статичные <img src=*.svg>. Браузер декодирует каждый уникальный src
// ОДИН раз и переиспользует растр для всех тайлов, а падение — чистый CSS-transform
// (композитится на GPU). Так тянем сотни тайлов без лагов.
//
// Раскладка — ДИАГОНАЛЬНАЯ ШАХМАТКА (как «5» на кубике / клетки шахматной доски).
// Ключ к виду «шашечки», а НЕ полос: вертикальный шаг между рядами ≈ ПОЛОВИНЕ
// горизонтального шага в ряду → диагонали идут под ~45°. Поэтому мало колонок
// (крупный горизонтальный шаг) и много рядов (мелкий вертикальный). Нечётные ряды
// сдвинуты вбок на полклетки. Тип тыква/кот тоже по (c+i)%2 → и позиция, и вид в шашечку.
// Горизонтальный шаг ≈ width/COLS; вертикальный ≈ 128vh/PER_COL (128vh = путь падения).
const COLS = 5; // мало колонок → крупный горизонтальный шаг
const PER_COL = 30; // много рядов → мелкий вертикальный шаг (≈ половина горизонтального)
const SIZE = 28; // px, одинаковый для всех
const DURATION = 24; // c, медленнее (спокойнее + меньше нагрузка на композитор)

type FallItem = { src: string; style: CSSProperties };

// PNG (а не SVG): декодируются мгновенно → нет лага при первом заходе на Games
// (сложный SVG тыквы парсился/растеризовался на лету и тормозил переключение вкладки).
const SRCS = [asset("emoji/pumpkin.png"), asset("emoji/cat.png")];
const NCOLS = COLS + 1; // +1 колонка → крайние эмодзи «утекают» за края (обрезаются)

const FALL_LAYER: FallItem[] = Array.from({ length: NCOLS * PER_COL }, (_, n) => {
  const c = Math.floor(n / PER_COL); // 0..COLS
  const i = n % PER_COL;
  const phase = (i / PER_COL) * DURATION; // одинаковая фаза по колонкам → ровные ряды
  // Чётные ряды ровно по сетке (центр на 0% и 100% → крайние режутся ПОПОЛАМ боками),
  // нечётные сдвинуты на полклетки → шашечка (относительный сдвиг 0.5 ячейки).
  const x = (c + (i % 2 === 0 ? 0 : 0.5)) / COLS;
  return {
    src: SRCS[i % SRCS.length], // цвет по чётности ряда → на staggered-решётке это правильная шашечка (по вертикали P-C-P-C, все диагональные соседи противоположны)
    style: {
      left: `${(x * 100).toFixed(3)}%`,
      width: `${SIZE}px`,
      height: `${SIZE}px`,
      marginLeft: `-${SIZE / 2}px`, // центрируем по точке колонки
      animationDuration: `${DURATION}s`,
      animationDelay: `-${phase.toFixed(2)}s`, // отрицательный → поток уже заполнен на старте
    } as CSSProperties,
  };
});

function FallingEmoji() {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
      // opacity на контейнере → весь дождь полупрозрачный по всему экрану (фон, не
      // акцент), одной композиторной группой. Сверху ещё растушёвка маской: эмодзи
      // мягко проявляются у шапки TG, а не возникают резко.
      style={{
        opacity: 0.4,
        maskImage: "linear-gradient(to bottom, transparent 0, #000 80px)",
        WebkitMaskImage: "linear-gradient(to bottom, transparent 0, #000 80px)",
      }}
    >
      {FALL_LAYER.map((it, i) => (
        <img
          key={i}
          src={it.src}
          alt=""
          decoding="async"
          className="absolute top-0 will-change-transform"
          style={{ ...it.style, animationName: "gamesFall", animationTimingFunction: "linear", animationIterationCount: "infinite" }}
        />
      ))}
    </div>
  );
}

export default function Games({ onGameOpenChange }: { onGameOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  // Сообщаем App, открыта ли полноэкранная игра → App гасит голубой фон вкладки Games
  // (иначе он мелькал под тёмной игрой при закрытии клавиатуры).
  useEffect(() => { onGameOpenChange?.(open !== null); }, [open, onGameOpenChange]);
  const close = () => setOpen(null);
  // Меню НЕ размонтируем при открытии игры (было early-return). Иначе при выходе из игры
  // все 4 лотти-иконки + эмодзи-дождь строятся заново → видимая «прогрузка». Прячем через
  // hidden (display:none — скрытое поддерево не анимируется/не композитится, нагрузки во
  // время игры нет), держим в DOM. Игру рендерим поверх. Возврат = меню уже готово, мгновенно.
  return (
    <>
      <div hidden={open !== null} className="relative min-h-[100dvh]">
        <FallingEmoji />
        <div className="relative z-10 space-y-3 px-4 pb-28 pt-9">
          <HeroCard game={GAMES[0]} onOpen={() => setOpen(GAMES[0].id)} />
          <div className="grid grid-cols-3 gap-3">
            {GAMES.slice(1).map((g) => (
              <TileCard key={g.id} game={g} onOpen={() => setOpen(g.id)} />
            ))}
          </div>
        </div>
      </div>
      {open === "rocket" && <RocketGame onClose={close} />}
      {open === "dice" && <DiceGame onClose={close} />}
      {open === "case" && <CaseGame onClose={close} />}
      {open === "basket" && <BasketGame onClose={close} />}
    </>
  );
}

// Иконка-лотти: заморожена на кадре iconFrame (статичная) + transform центрирует её контент.
function GameIcon({ game }: { game: Game }) {
  return (
    <Lottie
      src={game.iconSrc}
      freeze={game.iconFrame}
      autoplay={false}
      loop={false}
      className="h-full w-full"
      style={game.iconStyle}
    />
  );
}

// «Герой» — широкая плашка (Ракета): крупная иконка слева + название/описание.
function HeroCard({ game, onOpen }: { game: Game; onOpen: () => void }) {
  const t = useT();
  return (
    <button
      onClick={onOpen}
      disabled={!game.ready}
      className={"relative flex w-full items-center gap-3 overflow-hidden rounded-3xl p-5 text-left text-white shadow-lg transition active:scale-[0.98] " + game.tint}
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-white/10" />
      <span className="relative grid h-20 w-20 shrink-0 place-items-center drop-shadow-md">
        <GameIcon game={game} />
      </span>
      <span className="relative min-w-0 flex-1">
        <span className="block text-[20px] font-black drop-shadow-sm">{t(game.titleKey)}</span>
        <span className="mt-0.5 block text-[13px] font-medium text-white/85">{t(game.descKey)}</span>
      </span>
      {game.ready && (
        <svg viewBox="0 0 24 24" className="relative h-5 w-5 shrink-0 text-white/80" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
      )}
    </button>
  );
}

// Квадратная плитка: иконка по центру + название снизу.
function TileCard({ game, onOpen }: { game: Game; onOpen: () => void }) {
  const t = useT();
  return (
    <button
      onClick={onOpen}
      disabled={!game.ready}
      className={"relative flex aspect-square w-full flex-col items-center justify-center gap-1.5 overflow-hidden rounded-2xl p-2 text-white shadow-lg transition active:scale-[0.97] " + game.tint}
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-white/10" />
      <span className="relative grid h-14 w-14 place-items-center drop-shadow-md">
        <GameIcon game={game} />
      </span>
      <span className="relative text-[13px] font-bold drop-shadow-sm">{t(game.titleKey)}</span>
    </button>
  );
}
