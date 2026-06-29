import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// command === "build" → прод-сборка. Режем то, что раскрывает внутреннюю кухню
// через DevTools:
//   • sourcemap:false — без карт исходников оригинальный TS с комментариями
//     (в т.ч. про экономику/атрибуцию) не читается в консоли браузера;
//   • drop console/debugger — отладочные логи не попадают в прод-бандл.
// В dev (command === "serve") всё остаётся — отладка не страдает.
export default defineConfig(({ command, mode }) => ({
  plugins: [react()],
  // `--mode demo` (loads .env.demo → VITE_DEMO=true) builds the GitHub Pages demo:
  // it serves under /predict-market/ and routes the API to the in-browser mock.
  // Prod (Telegram Mini App on market.kopix.online) serves at root, real backend.
  base: mode === "demo" ? "/predict-market/" : "/",
  // @ton/core (сборка memo-коммента для TON-депозита) и часть TON Connect ссылаются на
  // Node-овский `global`; в браузере его нет → маппим на globalThis. Buffer ставит
  // src/polyfills.ts. Без этого сборка проходит, но падает в рантайме «global is not defined».
  define: { global: "globalThis" },
  build: {
    outDir: "dist",
    sourcemap: false,
    // minify по умолчанию esbuild (минификация + mangle имён) — не переопределяем.
  },
  esbuild: command === "build" ? { drop: ["console", "debugger"] } : {},
  server: { host: "0.0.0.0", port: 5173 },
}));
