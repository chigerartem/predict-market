import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installTapHaptics } from "./haptics";
import "./index.css";

if (window.Telegram?.WebApp) {
  const tg = window.Telegram.WebApp;
  tg.ready();
  tg.expand();
  try {
    tg.setHeaderColor?.("#0A0E16");
  } catch {
    /* noop */
  }
  try {
    tg.setBackgroundColor?.("#0A0E16");
  } catch {
    /* noop */
  }
  try {
    tg.setBottomBarColor?.("#0A0E16");
  } catch {
    /* noop */
  }
  tg.disableVerticalSwipes?.();

  // Lock app height to the Telegram viewport (iOS inertial-scroll fix). Take the
  // max seen; don't subscribe to viewportChanged (mid-scroll shrink breaks scroll).
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
}

installTapHaptics();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
