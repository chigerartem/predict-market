// Minecraft-стиль: статичный пиксельный блок «трава сверху, земля снизу».
// Используется как фон нижнего меню на экране Games. Рисуем сетку пиксельных
// <rect> шириной 16 «пикселей» (тайлится по горизонтали), а image-rendering:
// pixelated держит края резкими при растяжении по высоте бара. Никакой анимации.

const PAL: Record<string, string> = {
  k: "#2f7d1e", // трава — тёмная кромка
  g: "#46b62d", // трава — средняя
  G: "#63d83f", // трава — светлые блики
  e: "#7a4e2f", // земля — средняя
  E: "#5d3a22", // земля — тёмные пятна
  t: "#9a6643", // земля — светлые пятна
};

// Верх — трава (с бликами), затем «язычки» травы в землю, ниже — земля с пятнами.
const GRASS = [
  "kkkkkkkkkkkkkkkk",
  "gGgggGgggGgggGgg",
  "ggggGggggggGgggg",
  "gGgggggGgggggGgg",
  "gkggkggkggkggkgg",
];
const JAG = "eegeeegeeeegeege"; // зелёные язычки (g) свисают в первый ряд земли
const DIRT_ROWS = 6;

// Детерминированные «пятна» земли (без Math.random → стабильный вид и SSR-safe).
function dirtRow(r: number): string {
  let s = "";
  for (let c = 0; c < 16; c++) {
    const h = (c * 7 + r * 13) % 16;
    s += h < 2 ? "E" : h < 4 ? "t" : "e";
  }
  return s;
}

const ROWS = [...GRASS, JAG, ...Array.from({ length: DIRT_ROWS }, (_, r) => dirtRow(r))];

const W = 16;
const H = ROWS.length;
let rects = "";
ROWS.forEach((row, y) => {
  for (let x = 0; x < W; x++) {
    const col = PAL[row[x]];
    if (col) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${col}"/>`;
  }
});
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" shape-rendering="crispEdges">${rects}</svg>`;
const URI = `url("data:image/svg+xml,${encodeURIComponent(SVG)}")`;

export default function PixelGround() {
  return (
    <div
      aria-hidden
      className="absolute inset-0"
      style={{
        backgroundImage: URI,
        backgroundRepeat: "repeat-x",
        backgroundSize: "auto 100%", // высота = бар, ширина тайлится → пиксели квадратные
        imageRendering: "pixelated",
      }}
    />
  );
}
