import { useEffect, useRef } from "react";
import lottie from "lottie-web";
import type { MeResponse } from "../api";
import { useT } from "../i18n";

// Community: только голубой герой с крутящейся пачкой денег (money lottie) + текст.
// Рефералка/уровни/ссылка под героем убраны.
export default function Community({ me: _me }: { me: MeResponse }) {
  const t = useT();
  const animRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = animRef.current;
    if (!el) return;
    const anim = lottie.loadAnimation({
      container: el,
      renderer: "svg",
      loop: true,
      autoplay: true,
      path: "/lottie/money.json",
    });
    return () => anim.destroy();
  }, []);

  return (
    <div>
      <div className="relative flex w-full flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-[#5CCBFF] to-[#2E9BE6] px-6 pb-7 pt-7 text-center">
        <div ref={animRef} className="h-32 w-32" />
        <h1
          className="mt-4 text-[26px] font-bold leading-tight text-white"
          style={{ textShadow: "0 2px 12px rgba(0,40,80,0.3)" }}
        >
          {t("community.heroTitle")}
        </h1>
        <p
          className="mt-2 max-w-[300px] text-[13px] leading-relaxed text-white/85"
          style={{ textWrap: "balance" }}
        >
          {t("community.heroSubtitle")}
        </p>
      </div>
    </div>
  );
}
