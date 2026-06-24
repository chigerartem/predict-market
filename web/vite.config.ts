import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// command === "build" → прод-сборка. Режем то, что раскрывает внутреннюю кухню
// через DevTools:
//   • sourcemap:false — без карт исходников оригинальный TS с комментариями
//     (в т.ч. про экономику/атрибуцию) не читается в консоли браузера;
//   • drop console/debugger — отладочные логи не попадают в прод-бандл.
// В dev (command === "serve") всё остаётся — отладка не страдает.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: false,
    // minify по умолчанию esbuild (минификация + mangle имён) — не переопределяем.
  },
  esbuild: command === "build" ? { drop: ["console", "debugger"] } : {},
  server: { host: "0.0.0.0", port: 5173 },
}));
