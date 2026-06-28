import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
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
  animationData,
  className,
  loop = true,
  autoplay = true,
  onComplete,
  onFrame,
  freeze,
  style,
  speed = 1,
}: {
  src: string;
  animationData?: object; // разобранные данные (из lottieCache) → рендер без сети, мгновенно
  className?: string;
  loop?: boolean;
  autoplay?: boolean;
  onComplete?: () => void;
  onFrame?: (progress: number) => void; // прогресс 0..1 на каждом кадре (для синхро-камеры)
  freeze?: "last" | number; // заморозить на ПОСЛЕДНЕМ или на ЗАДАННОМ кадре (статичная иконка)
  style?: CSSProperties; // напр. transform для центровки контента иконки
  speed?: number; // множитель скорости проигрывания (1 = норма; >1 быстрее, для авто-режима)
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cbRef = useRef(onComplete);
  cbRef.current = onComplete; // всегда свежий колбэк без перезапуска эффекта
  const frameRef = useRef(onFrame);
  frameRef.current = onFrame;
  // freeze="last": прячем контейнер, пока не встанем на последний кадр. Иначе до события
  // DOMLoaded lottie показывает кадр 0 (для кубиков — «кубик в полёте»), и при каждой
  // смене src (грани) это мелькает как лишняя прокрутка. Скрыт → виден ровно гранью.
  const [revealed, setRevealed] = useState(freeze === undefined);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (freeze !== undefined) setRevealed(false); // src сменился → снова прячем до постановки кадра
    // animationData (из кэша) → строится синхронно, без сетевой загрузки → грань стоит
    // сразу. Иначе грузим по path (асинхронно).
    const anim = animationData
      ? lottie.loadAnimation({ container: el, renderer: "svg", loop, autoplay, animationData })
      : lottie.loadAnimation({ container: el, renderer: "svg", loop, autoplay, path: src });
    if (speed !== 1) anim.setSpeed(speed);
    const handleComplete = () => cbRef.current?.();
    anim.addEventListener("complete", handleComplete);
    const handleFrame = () => {
      const total = anim.totalFrames || 1;
      frameRef.current?.(Math.min(1, anim.currentFrame / total));
    };
    anim.addEventListener("enterFrame", handleFrame);
    let handleLoaded: (() => void) | undefined;
    if (freeze !== undefined) {
      handleLoaded = () => {
        const ff = freeze === "last" ? Math.round(anim.totalFrames) - 1 : freeze;
        anim.goToAndStop(Math.max(0, ff), true);
        setRevealed(true);
      };
      anim.addEventListener("DOMLoaded", handleLoaded);
    }
    return () => {
      anim.removeEventListener("complete", handleComplete);
      anim.removeEventListener("enterFrame", handleFrame);
      if (handleLoaded) anim.removeEventListener("DOMLoaded", handleLoaded);
      anim.destroy();
    };
  }, [src, animationData, loop, autoplay, freeze, speed]);
  return <div ref={ref} className={className} aria-hidden style={revealed ? style : { ...style, opacity: 0 }} />;
}
