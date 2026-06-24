// Telegram WebApp haptics — tiny safe wrappers + one global tap delegate.
// All calls are best-effort: no-op on old clients / plain browser.

type ImpactStyle = "light" | "medium" | "heavy" | "rigid" | "soft";
type NotificationType = "success" | "warning" | "error";

function hf() {
  return window.Telegram?.WebApp?.HapticFeedback;
}

export function impact(style: ImpactStyle = "light"): void {
  try {
    hf()?.impactOccurred?.(style);
  } catch {
    /* old client / not Telegram */
  }
}

export function notify(type: NotificationType): void {
  try {
    hf()?.notificationOccurred?.(type);
  } catch {
    /* noop */
  }
}

let tapInstalled = false;

// One delegated listener gives every button/link a crisp tick on press.
export function installTapHaptics(): void {
  if (tapInstalled || typeof document === "undefined") return;
  tapInstalled = true;
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button > 0) return;
      const el = (e.target as Element | null)?.closest?.(
        'button, [role="button"], a[href], summary, .tappable',
      ) as HTMLElement | null;
      if (!el) return;
      if (el.hasAttribute("disabled")) return;
      if (el.getAttribute("aria-disabled") === "true") return;
      impact("light");
    },
    { capture: true, passive: true },
  );
}
