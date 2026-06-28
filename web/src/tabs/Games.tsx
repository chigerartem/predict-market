import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useT, type TKey } from "../i18n";
import Lottie from "../components/Lottie";
import RocketGame from "./RocketGame";
import DiceGame from "./DiceGame";
import CaseGame from "./CaseGame";

// Экран «Игры» — казино-раздел. Полностью голубой фон (см. App: blueTab+fullBlue),
// по нему рандомно падают эмодзи из паков (лягушка/гем/тыква/кот). Карточки —
// в стиле депозитных блоков (яркий градиент-тинт + крупная иконка слева).
// Заголовка экрана нет намеренно — раздел подписан в нижней менюшке.
type Game = {
  id: string;
  titleKey: TKey;
  descKey: TKey;
  icon: ReactNode;
  tint: string;
  ready: boolean;
};

const GAMES: Game[] = [
  {
    id: "rocket",
    titleKey: "games.rocketTitle",
    descKey: "games.rocketDesc",
    icon: <Lottie src="/lottie/rocket.json" className="h-full w-full" />,
    tint: "bg-gradient-to-br from-[#ff6a3d] to-[#e01e5a] shadow-rose-600/40",
    ready: true,
  },
  {
    id: "dice",
    titleKey: "games.diceTitle",
    descKey: "games.diceDesc",
    icon: <Lottie src="/lottie/dice-6.json" className="h-full w-full" />,
    tint: "bg-gradient-to-br from-[#f5a623] to-[#e8590c] shadow-orange-600/40",
    ready: true,
  },
  {
    id: "case",
    titleKey: "games.caseTitle",
    descKey: "games.caseDesc",
    icon: <Lottie src="/lottie/gift.json" className="h-full w-full" />,
    tint: "bg-gradient-to-br from-[#8b5cf6] to-[#d946ef] shadow-fuchsia-600/40",
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
const SRCS = ["/emoji/pumpkin.png", "/emoji/cat.png"];
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
  if (open === "rocket") return <RocketGame onClose={() => setOpen(null)} />;
  if (open === "dice") return <DiceGame onClose={() => setOpen(null)} />;
  if (open === "case") return <CaseGame onClose={() => setOpen(null)} />;
  return (
    <div className="relative min-h-[100dvh]">
      <FallingEmoji />
      <div className="relative z-10 space-y-3 px-4 pb-28 pt-9">
        {GAMES.map((g) => (
          <GameCard key={g.id} game={g} onOpen={() => setOpen(g.id)} />
        ))}
      </div>
    </div>
  );
}

function GameCard({ game, onOpen }: { game: Game; onOpen: () => void }) {
  const t = useT();
  return (
    <button
      onClick={onOpen}
      disabled={!game.ready}
      className={
        "flex w-full items-center gap-4 rounded-3xl p-5 text-left text-white shadow-lg transition active:scale-[0.98] " +
        game.tint
      }
    >
      <span className="grid h-[68px] w-[68px] shrink-0 place-items-center drop-shadow-md">{game.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-bold drop-shadow-sm">{t(game.titleKey)}</span>
        <span className="mt-0.5 block text-[13px] font-medium text-white/85">{t(game.descKey)}</span>
      </span>
      {game.ready && (
        <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-white/80" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
      )}
    </button>
  );
}
