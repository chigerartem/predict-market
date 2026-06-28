import { useEffect, useRef } from "react";
import lottie from "lottie-web";

// Тонкая обёртка над lottie-web: грузит JSON-анимацию из /public/lottie и крутит её.
// Переиспользуется в модалках и героях (money.json, onb-*.json). Размер задаётся
// через className (h-/w-).
//
// onComplete — колбэк по завершении непрерывного проигрывания (только при loop=false);
// нужен «Костям», чтобы показать результат РОВНО когда анимация броска доиграла.
// freeze="last" — при autoplay=false замораживает кубик на ПОСЛЕДНЕМ кадре (готовая
// грань), а не на первом (кубик в полёте) → покоящийся кубик показывает выпавшее число.
export default function Lottie({
  src,
  className,
  loop = true,
  autoplay = true,
  onComplete,
  freeze,
  speed = 1,
}: {
  src: string;
  className?: string;
  loop?: boolean;
  autoplay?: boolean;
  onComplete?: () => void;
  freeze?: "last";
  speed?: number; // множитель скорости проигрывания (1 = норма; >1 быстрее, для авто-режима)
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cbRef = useRef(onComplete);
  cbRef.current = onComplete; // всегда свежий колбэк без перезапуска эффекта
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const anim = lottie.loadAnimation({
      container: el,
      renderer: "svg",
      loop,
      autoplay,
      path: src,
    });
    if (speed !== 1) anim.setSpeed(speed);
    const handleComplete = () => cbRef.current?.();
    anim.addEventListener("complete", handleComplete);
    let handleLoaded: (() => void) | undefined;
    if (freeze === "last") {
      handleLoaded = () => anim.goToAndStop(Math.max(0, Math.round(anim.totalFrames) - 1), true);
      anim.addEventListener("DOMLoaded", handleLoaded);
    }
    return () => {
      anim.removeEventListener("complete", handleComplete);
      if (handleLoaded) anim.removeEventListener("DOMLoaded", handleLoaded);
      anim.destroy();
    };
  }, [src, loop, autoplay, freeze, speed]);
  return <div ref={ref} className={className} aria-hidden />;
}
