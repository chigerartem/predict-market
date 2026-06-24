import { useEffect, useRef } from "react";

/**
 * Сажает fixed-контейнер модалки (с карточкой внизу, items-end) ровно над
 * клавиатурой. На iOS/Telegram `position:fixed` НЕ учитывает выезд софт-клавиатуры:
 * по высоте контейнер остаётся во весь экран, и карточка `items-end` оказывается за
 * клавиатурой.
 *
 * Вешаем возвращённый ref на контейнер (`fixed inset-x-0 top-0`). Пока внутри него
 * сфокусировано текстовое поле (клавиатура открыта), КАЖДЫЙ кадр (rAF) подгоняем
 * ТОЛЬКО height под `visualViewport.height` — низ контейнера встаёт ровно у верха
 * клавиатуры, и карточка садится впритык над ней.
 *
 * ВАЖНО: сдвиг по `offsetTop` (translateY) НЕ применяем. На целевом клиенте `top:0`
 * у fixed уже стоит в начале ВИДИМОЙ области, поэтому любой доп. сдвиг вниз только
 * мешает (раньше из-за него тёмная шторка оголяла полоску сверху). Достаточно высоты.
 *
 * rAF, а НЕ resize/scroll-события: на iOS они приходят с пропусками и устаревшими
 * значениями. Стиль пишем только при изменении высоты. Клавиатура закрыта →
 * стабильный window.innerHeight (vv.height на iOS «залипает» уменьшенным ещё какое-то
 * время после закрытия).
 */
export function useKeyboardInsetSheet(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    const vv = window.visualViewport;
    const el = ref.current;
    if (!vv || !el) return;

    let raf = 0;
    let lastH = -1;
    const loop = () => {
      // «Клавиатура открыта» = фокус на текстовом поле ВНУТРИ этого оверлея.
      // Тогда высота = visualViewport (видимая область над клавой); иначе —
      // стабильный innerHeight (vv.height на iOS после закрытия залипает).
      const a = document.activeElement;
      const focused =
        a instanceof HTMLElement &&
        (a.tagName === "INPUT" || a.tagName === "TEXTAREA") &&
        el.contains(a);
      const h = focused ? Math.round(vv.height) : Math.round(window.innerHeight);
      if (h !== lastH) {
        el.style.height = `${h}px`;
        lastH = h;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      el.style.height = "";
    };
  }, [active]);
  return ref;
}
