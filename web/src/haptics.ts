// Тактильная отдача Telegram WebApp — крошечная безопасная обёртка + один глобальный
// делегат «нажатия». Все вызовы best-effort: на старых клиентах и в обычном браузере
// просто no-op. Философия Emil Kowalski: отдача на момент нажатия (pointerdown), как у
// физической клавиши.

type ImpactStyle = "light" | "medium" | "heavy" | "rigid" | "soft";

function hf() {
  return window.Telegram?.WebApp?.HapticFeedback;
}

function impact(style: ImpactStyle = "light"): void {
  try {
    hf()?.impactOccurred?.(style);
  } catch {
    /* старый клиент / не Telegram — игнор */
  }
}

let tapInstalled = false;

// Один делегированный слушатель даёт КАЖДОЙ кнопке/ссылке чёткий тик на нажатии
// — не нужно дёргать onClick в каждом компоненте. pointerdown = момент нажатия.
export function installTapHaptics(): void {
  if (tapInstalled || typeof document === "undefined") return;
  tapInstalled = true;
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button > 0) return; // только основная кнопка / тач
      const el = (e.target as Element | null)?.closest?.(
        'button, [role="button"], a[href], summary, .tappable',
      ) as HTMLElement | null;
      if (!el) return;
      if (el.hasAttribute("disabled")) return;
      if (el.getAttribute("aria-disabled") === "true") return;
      if (el.dataset.noHaptic !== undefined) return;
      impact("light");
    },
    { capture: true, passive: true },
  );
}
