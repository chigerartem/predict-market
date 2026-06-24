import { useEffect, useRef, useState } from "react";
import lottie, { type AnimationItem } from "lottie-web";
import type { MeResponse } from "../api";
import UserAvatar, { tgHandle } from "../components/UserAvatar";
import { useT } from "../i18n";

// Маска Бэтмена (public/lottie/batman-mask.json) поверх аватара: въезжает сверху,
// садится на лицо, по тапу отъезжает вбок на ~2с. Только герой; контент под ним убран.
const AVATAR = 88;
const MASK_W = 156;
const MASK_TOP = -97;
type MaskState = "hidden" | "resting" | "aside";
const MASK_TF: Record<MaskState, string> = {
  hidden: "translateY(-135%) scale(0.85)",
  resting: "translateY(0) scale(1)",
  aside: "translateX(118%) rotate(10deg)",
};

export default function Profile({ me, active }: { me: MeResponse; active: boolean }) {
  const t = useT();
  const [maskState, setMaskState] = useState<MaskState>("hidden");
  const maskBox = useRef<HTMLDivElement>(null);
  const maskAnim = useRef<AnimationItem | null>(null);
  const asideTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const el = maskBox.current;
    if (!el) return;
    const anim = lottie.loadAnimation({
      container: el,
      renderer: "svg",
      loop: true,
      autoplay: false,
      path: "/lottie/batman-mask.json",
    });
    maskAnim.current = anim;
    return () => {
      anim.destroy();
      maskAnim.current = null;
    };
  }, []);

  useEffect(() => {
    if (active) {
      maskAnim.current?.play();
      setMaskState("hidden");
      const r1 = requestAnimationFrame(() =>
        requestAnimationFrame(() => setMaskState("resting")),
      );
      return () => cancelAnimationFrame(r1);
    }
    maskAnim.current?.pause();
    setMaskState("hidden");
    clearTimeout(asideTimer.current);
  }, [active]);

  useEffect(() => () => clearTimeout(asideTimer.current), []);

  function tapMask() {
    if (maskState !== "resting") return;
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light");
    setMaskState("aside");
    clearTimeout(asideTimer.current);
    asideTimer.current = window.setTimeout(() => setMaskState("resting"), 2000);
  }

  return (
    <div>
      <div className="flex min-h-[218px] w-full flex-col justify-end bg-gradient-to-b from-[#5CCBFF] to-[#2E9BE6] px-5 pb-7 text-white">
        <div className="flex items-center justify-center gap-2">
          <div className="min-w-0 flex-1 truncate text-center text-lg font-semibold leading-tight">
            {me.user.name}
          </div>
          <div className="relative shrink-0" style={{ width: AVATAR, height: AVATAR }}>
            <UserAvatar name={me.user.name} size={AVATAR} />
            <button
              type="button"
              aria-label={t("profile.maskAria")}
              onClick={tapMask}
              className="absolute cursor-pointer will-change-transform"
              style={{
                width: MASK_W,
                height: MASK_W,
                left: "50%",
                marginLeft: -(MASK_W / 2),
                top: MASK_TOP,
                opacity: maskState === "hidden" ? 0 : 1,
                transform: MASK_TF[maskState],
                transition:
                  "transform 680ms cubic-bezier(0.30,1.75,0.55,1), opacity 420ms ease",
              }}
            >
              <div ref={maskBox} className="h-full w-full" />
            </button>
          </div>
          <div className="min-w-0 flex-1 truncate text-center text-sm leading-tight text-white/80">
            {tgHandle(me.user)}
          </div>
        </div>
      </div>
    </div>
  );
}
