import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installTapHaptics } from "./haptics";
import "./index.css";

const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  tg.disableVerticalSwipes?.();

  // Header/background tinted to the hero blue so the top blends seamlessly.
  const applyColors = () => {
    try {
      tg.setHeaderColor?.("#5CCBFF");
      tg.setBackgroundColor?.("#5CCBFF");
    } catch {
      /* old client */
    }
  };
  applyColors();
  requestAnimationFrame(applyColors);

  const applyHeight = () => {
    const h = tg.viewportStableHeight ?? tg.viewportHeight ?? window.innerHeight;
    if (h && Number.isFinite(h)) {
      document.documentElement.style.setProperty("--app-h", `${Math.round(h)}px`);
    }
  };
  applyHeight();
  tg.onEvent?.("viewportChanged", applyHeight);
}

installTapHaptics();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
