import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  tg.setHeaderColor?.("#0A0E16");
  tg.setBackgroundColor?.("#0A0E16");
  tg.setBottomBarColor?.("#0A0E16");

  const applyHeight = () => {
    const h = tg.viewportStableHeight ?? tg.viewportHeight ?? window.innerHeight;
    if (h && Number.isFinite(h)) {
      document.documentElement.style.setProperty("--app-h", `${Math.round(h)}px`);
    }
  };
  applyHeight();
  tg.onEvent?.("viewportChanged", applyHeight);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
