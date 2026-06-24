import { useEffect, useRef, useState } from "react";
import lottie from "lottie-web";
import { useT, type TKey } from "../i18n";

// Онбординг Mini App: 4 свайпаемых слайда при ПЕРВОМ входе. Показывается один
// раз — гейт в App.tsx (серверный user.onboarded + localStorage). Компонент
// чисто презентационный; побочки (запись флага) живут в App через onDone.
// Стиль — как весь апп: голубой герой на весь экран, Lottie-анимации, белая
// кнопка. Анимации лежат в public/lottie/onb-*.json (см. emoji-lib галерею).

type Slide = { key: string; lottie: string; titleKey: TKey; textKey: TKey };

const SLIDES: Slide[] = [
  {
    key: "what",
    lottie: "/lottie/onb-cashback.json",
    titleKey: "onb.slide1Title",
    textKey: "onb.slide1Text",
  },
  {
    key: "calc",
    lottie: "/lottie/onb-calc.json",
    titleKey: "onb.slide2Title",
    textKey: "onb.slide2Text",
  },
  {
    key: "connect",
    lottie: "/lottie/onb-connect.json",
    titleKey: "onb.slide3Title",
    textKey: "onb.slide3Text",
  },
  {
    key: "start",
    lottie: "/lottie/onb-start.json",
    titleKey: "onb.slide4Title",
    textKey: "onb.slide4Text",
  },
];

function LottieArt({ src }: { src: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const anim = lottie.loadAnimation({
      container: el,
      renderer: "svg",
      loop: true,
      autoplay: true,
      path: src,
    });
    return () => anim.destroy();
  }, [src]);
  return <div ref={ref} className="h-48 w-48" />;
}

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const t = useT();
  const trackRef = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const last = idx === SLIDES.length - 1;

  const goTo = (i: number) => {
    const el = trackRef.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(SLIDES.length - 1, i));
    el.scrollTo({ left: clamped * el.clientWidth, behavior: "smooth" });
    setIdx(clamped);
  };

  const onScroll = () => {
    const el = trackRef.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== idx) setIdx(i);
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-gradient-to-b from-[#5CCBFF] to-[#2E9BE6] text-white">
      <div className="flex justify-end px-5 pt-3">
        <button
          onClick={onDone}
          className="rounded-lg px-3 py-1.5 text-[13px] text-white/80 transition active:scale-95"
        >
          {t("onb.skip")}
        </button>
      </div>

      <div
        ref={trackRef}
        onScroll={onScroll}
        className="flex flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden"
      >
        {SLIDES.map((s) => (
          <section
            key={s.key}
            className="flex h-full w-full shrink-0 snap-center flex-col items-center"
          >
            {/* анимация занимает верх (растёт), внизу — текст: глаз идёт сверху вниз */}
            <div className="flex flex-1 items-center justify-center">
              <LottieArt src={s.lottie} />
            </div>
            {/* фикс. высота блока → заголовки на одной линии на всех слайдах */}
            <div className="px-8 text-center" style={{ minHeight: 148 }}>
              <h2
                className="flex min-h-[2.2em] items-center justify-center text-center text-[25px] font-bold leading-tight"
                style={{ textShadow: "0 2px 14px rgba(0,40,80,0.25)" }}
              >
                {t(s.titleKey)}
              </h2>
              <p className="mx-auto mt-3 max-w-[270px] text-[14px] leading-relaxed text-white/85">
                {t(s.textKey)}
              </p>
            </div>
          </section>
        ))}
      </div>

      <div
        className="px-8 pt-6"
        style={{ paddingBottom: "max(2.25rem, env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="mb-5 flex justify-center gap-2">
          {SLIDES.map((_, i) => (
            <span
              key={i}
              className={
                "h-1.5 rounded-full transition-all duration-300 " +
                (i === idx ? "w-6 bg-white" : "w-1.5 bg-white/35")
              }
            />
          ))}
        </div>
        <button
          onClick={() => (last ? onDone() : goTo(idx + 1))}
          className="w-full rounded-2xl bg-white py-3.5 text-[15px] font-semibold text-[#0b6aa8] shadow-lg shadow-black/10 transition active:scale-[0.99]"
        >
          {last ? t("onb.start") : t("onb.next")}
        </button>
      </div>
    </div>
  );
}
