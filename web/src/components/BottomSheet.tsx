import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { useKeyboardInsetSheet } from "../hooks/useKeyboardInsetSheet";

type Props = { open: boolean; onClose: () => void; children: ReactNode };

// Общий каркас всех всплывающих карточек (депозит / вывод / ставка). Карточка-лист
// снизу, тап по фону закрывает.
//
// Фон за карточкой отделяется СТАТИЧНЫМ размытием + затемнением: пока карточка
// открыта, на #root вешается класс .app-dimmed (filter: blur+brightness, см. index.css).
// Принципиально, что это filter НА КОНТЕНТЕ (#root), а НЕ position:fixed оверлей:
//   • контент стоит в обычном потоке с фиксированной высотой (--app-h), поэтому
//     затемнение не привязано к visualViewport и не «съезжает» при выезде клавиатуры;
//   • у него нет «фиксированной кромки», которая стыкуется с нативной шапкой Telegram,
//     поэтому нечему рваться/дёргаться (ровно это ломало прежний fixed-скрим).
// Сама карточка рендерится порталом в document.body — ВНЕ #root, — поэтому под фильтр
// не попадает и остаётся резкой.
export default function BottomSheet({ open, onClose, children }: Props) {
  useBodyScrollLock(open);
  const sheetRef = useKeyboardInsetSheet(open);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const root = document.getElementById("root");
    root?.classList.add("app-dimmed");
    return () => root?.classList.remove("app-dimmed");
  }, [open]);

  // Гасим iOS-«резинку» (overscroll) карточки: на самом верху тянут вниз / в самом
  // низу тянут вверх — это переоттяжка, она отрывала контент от закруглённого фона
  // (фон оставался, контент уезжал «с острыми углами»). preventDefault на границах
  // фиксит. Короткая (не скроллящаяся) карточка не тянется вовсе — atTop и atBottom
  // оба true. Слушатель non-passive, иначе preventDefault игнорируется.
  useEffect(() => {
    if (!open) return;
    const el = contentRef.current;
    if (!el) return;
    let startY = 0;
    const onStart = (e: TouchEvent) => {
      startY = e.touches[0]?.clientY ?? 0;
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const dy = e.touches[0].clientY - startY;
      const atTop = el.scrollTop <= 0;
      const atBottom = Math.ceil(el.scrollTop + el.clientHeight) >= el.scrollHeight;
      if ((dy > 0 && atTop) || (dy < 0 && atBottom)) e.preventDefault();
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    // Контейнер на весь экран ловит тап для закрытия. Высота синкается с visualViewport
    // (useKeyboardInsetSheet), чтобы карточка садилась впритык над клавиатурой.
    <div
      ref={sheetRef}
      className="fixed inset-x-0 top-0 z-50 flex h-full items-end justify-center"
      onClick={onClose}
    >
      <div
        ref={contentRef}
        className="relative z-10 max-h-full w-full max-w-md overflow-y-auto overflow-x-hidden overscroll-none rounded-t-3xl border-t border-white/10 bg-[#12141d] p-5 pb-8 text-white shadow-[0_-16px_50px_-12px_rgba(0,0,0,0.85)] sm:mb-4 sm:rounded-3xl sm:border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Мягкая цветная «аврора» вверху карточки — оживляет фон в тон ярким
            кнопкам, не мешая читаемости (сильно размыта, контент идёт поверх). */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-16 left-1/2 h-48 w-[130%] -translate-x-1/2 rounded-full bg-gradient-to-r from-sky-500/25 via-fuchsia-500/20 to-amber-400/25 blur-3xl"
        />
        <div className="relative">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
