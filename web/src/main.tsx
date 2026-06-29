import "./polyfills"; // ставит globalThis.Buffer до загрузки @ton/core — держать первым
import React from "react";
import ReactDOM from "react-dom/client";
import { TonConnectUIProvider } from "@tonconnect/ui-react";
import App from "./App";
import { installTapHaptics } from "./haptics";
import "./index.css";

// Demo build (GitHub Pages): render inside an iPhone-sized frame (see .demo-frame in
// index.css) so the Mini App shows at its real mobile width instead of stretching
// across a desktop screen. telegram-web-app.js defines window.Telegram.WebApp even in a
// plain browser, so in demo we also skip the TG branch below (it would set --app-h to
// the full window height and defeat the frame) — .demo-frame's CSS drives the height.
const DEMO_BUILD = import.meta.env.VITE_DEMO === "true";
if (DEMO_BUILD) {
  document.documentElement.classList.add("demo-frame");
}

// Манифест отдаётся nginx из web/public. URL абсолютный — его читает кошелёк (внешнее
// приложение), а не только наш фронт.
const TONCONNECT_MANIFEST = "https://market.kopix.online/tonconnect-manifest.json";

if (!DEMO_BUILD && window.Telegram?.WebApp) {
  const tg = window.Telegram.WebApp;
  tg.ready();
  tg.expand();

  // Сливаем шапку, фон Telegram и нижний бар с цветом темы TG.
  // Используем именованное значение 'bg_color' — оно гарантированно работает
  // на всех версиях TG, в отличие от hex (требует Bot API 6.9+).
  // Наш CSS body/html/main тоже использует var(--tg-theme-bg-color), который
  // TG задаёт автоматически. В итоге шапка, область за контентом и сам контент
  // имеют ровно один цвет — без разрыва на границе.
  try { tg.setHeaderColor?.("#0A0E16"); } catch { /* noop */ }
  try { tg.setBackgroundColor?.("#0A0E16"); } catch { /* noop */ }
  try { tg.setBottomBarColor?.("#0A0E16"); } catch { /* noop */ }

  // Подстраховка: вручную пробрасываем themeParams.bg_color в CSS-переменную.
  // Большинство версий TG это делают автоматически, но на старых WebView
  // переменная может оказаться не задана — тогда body/html/main свалятся
  // на fallback #0a0a0a, который отличается от цвета шапки TG.
  const syncThemeBg = () => {
    const bg = tg.themeParams?.bg_color;
    if (bg) {
      document.documentElement.style.setProperty("--tg-theme-bg-color", bg);
    }
  };
  syncThemeBg();
  tg.onEvent?.("themeChanged", syncThemeBg);

  // Жёстко фиксируем высоту приложения по Telegram-viewport, иначе на iOS
  // `100vh`/`100dvh` пересчитывается при инерции прокрутки и верх контента
  // уезжает за пределы видимой области без возможности доскроллить обратно.
  // Берём МАКСИМУМ из увиденного и НЕ подписываемся на viewportChanged: на iOS
  // Telegram при скролле сворачивает свою шапку и шлёт viewportChanged с меньшей
  // высотой — если переписать --app-h мид-скролл, контейнер сжимается и скролл
  // подвисает/обрезается (Профиль с лидербордом «не листался, пока не подёргаешь»).
  // Сразу после ready может прийти «compact» высота, через ~300ms — полная.
  let appliedHeight = 0;
  const applyHeight = () => {
    const h = tg.viewportStableHeight ?? tg.viewportHeight ?? window.innerHeight;
    if (h && Number.isFinite(h) && h > appliedHeight) {
      appliedHeight = h;
      document.documentElement.style.setProperty("--app-h", `${Math.round(h)}px`);
    }
  };
  applyHeight();
  setTimeout(applyHeight, 0);
  setTimeout(applyHeight, 300);
} else {
  // В обычном браузере фолбэк на 100dvh через CSS
}

// Блокируем pinch-to-zoom: Safari игнорирует viewport user-scalable=no
const blockGesture = (e: Event) => e.preventDefault();
document.addEventListener("gesturestart", blockGesture);
document.addEventListener("gesturechange", blockGesture);
document.addEventListener("gestureend", blockGesture);
document.addEventListener(
  "touchmove",
  (e) => {
    if ((e as TouchEvent).touches.length > 1) e.preventDefault();
  },
  { passive: false },
);
// Double-tap zoom — игнор повторного тапа в пределах 350ms
let lastTouchEnd = 0;
document.addEventListener(
  "touchend",
  (e) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 350) e.preventDefault();
    lastTouchEnd = now;
  },
  { passive: false },
);

// Глобальная тактильная отдача на нажатие любой кнопки/ссылки.
installTapHaptics();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TonConnectUIProvider
      manifestUrl={TONCONNECT_MANIFEST}
      // twaReturnUrl — куда кошелёк возвращает ПОСЛЕ подписи/коннекта. КРИТИЧНО: это
      // должна быть ссылка, которая переоткрывает САМ Mini App, а не чат бота. Голый
      // https://t.me/mmetricbot открывает ЧАТ — WebView не переоткрывался, и SDK не
      // до-забирал ответ кошелька с SSE-bridge (усыплённый WebView на iOS) → коннект
      // «висел» на «Connect». `?startapp=...` открывает Main Mini App бота напрямую
      // (он настроен в BotFather на market.kopix.online) → SDK переинициализируется,
      // переподключает bridge (хосты открыты в CSP nginx.conf) и финализирует коннект/
      // оплату. Значение startapp произвольное — start_param мы нигде не читаем.
      // returnStrategy 'back' — подстраховка для клиентов без TWA-возврата.
      actionsConfiguration={{
        returnStrategy: "back",
        twaReturnUrl: "https://t.me/mmetricbot?startapp=tonconnect",
      }}
    >
      <App />
    </TonConnectUIProvider>
  </React.StrictMode>,
);
