import { useEffect, useRef, useState, type SVGProps } from "react";
import lottie from "lottie-web";

type Tab = "home" | "markets" | "profile";
type IconFC = (p: SVGProps<SVGSVGElement>) => JSX.Element;

const IconStroke = (props: SVGProps<SVGSVGElement>) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    {...props}
  />
);
const HomeIcon: IconFC = (p) => (
  <IconStroke {...p}>
    <path d="M3 11.5 12 4l9 7.5" />
    <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" />
  </IconStroke>
);
const MarketsIcon: IconFC = (p) => (
  <IconStroke {...p}>
    <path d="M3 17l6-6 4 4 8-9" />
    <path d="M14 6h7v7" />
  </IconStroke>
);
const ProfileIcon: IconFC = (p) => (
  <IconStroke {...p}>
    <circle cx="12" cy="8" r="3.6" />
    <path d="M4.5 20c0-3.6 3.4-6.2 7.5-6.2s7.5 2.6 7.5 6.2" />
  </IconStroke>
);

const TABS: { id: Tab; label: string; Icon: IconFC }[] = [
  { id: "home", label: "Главная", Icon: HomeIcon },
  { id: "markets", label: "Рынки", Icon: MarketsIcon },
  { id: "profile", label: "Профиль", Icon: ProfileIcon },
];

// Reusable lottie player (loads JSON from /public/lottie at runtime).
function Lottie({ src, className }: { src: string; className?: string }) {
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
  return <div ref={ref} className={className} aria-hidden />;
}

function Screen({ src, title, subtitle }: { src: string; title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center px-6 pt-8 text-center">
      <Lottie src={src} className="h-60 w-60" />
      <h1 className="mt-2 text-2xl font-bold">{title}</h1>
      <p className="mt-2 max-w-xs text-sm leading-relaxed text-neutral-400">{subtitle}</p>
      <span className="mt-6 rounded-full bg-white/[0.06] px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-neutral-400">
        Скоро
      </span>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  const u = window.Telegram?.WebApp?.initDataUnsafe?.user;
  const name = u?.first_name || u?.username || "Гость";

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2.5 px-4 py-3">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-sky-400/15 text-sm font-bold text-sky-300">
          {name[0]?.toUpperCase() || "?"}
        </span>
        <div className="leading-tight">
          <div className="text-[11px] text-neutral-500">KopiX Predict</div>
          <div className="text-sm font-semibold">{name}</div>
        </div>
      </header>

      <main className="flex-1 overflow-y-scroll overscroll-y-none">
        <div className="min-h-[calc(100%+96px)] pb-32">
          {tab === "home" && (
            <Screen
              src="/lottie/onb-cashback.json"
              title="Рынок прогнозов"
              subtitle="Предсказывай исходы реальных событий и забирай выигрыш — прямо в Telegram."
            />
          )}
          {tab === "markets" && (
            <Screen
              src="/lottie/liberty.json"
              title="Рынки"
              subtitle="Скоро здесь появятся события: спорт, крипта, политика и не только."
            />
          )}
          {tab === "profile" && (
            <Screen
              src="/lottie/vip-crown.json"
              title={name}
              subtitle="Баланс, история ставок и статистика прогнозиста."
            />
          )}
        </div>
      </main>

      <BottomNav tab={tab} setTab={setTab} />
    </div>
  );
}

function BottomNav({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const idx = TABS.findIndex((x) => x.id === tab);
  return (
    <nav
      className="fixed inset-x-0 z-40 flex justify-center px-5"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 10px)" }}
    >
      <div className="relative flex w-full max-w-sm rounded-[26px] border border-white/10 bg-[#11151C]/85 p-1.5 shadow-[0_12px_40px_-10px_rgba(0,0,0,0.8)] backdrop-blur-2xl">
        <span
          aria-hidden
          className="absolute bottom-1.5 left-1.5 top-1.5 rounded-[20px] bg-sky-400/15 transition-transform duration-300 ease-[cubic-bezier(0.34,1.4,0.64,1)]"
          style={{
            width: "calc((100% - 12px) / 3)",
            transform: `translateX(${idx * 100}%)`,
          }}
        />
        {TABS.map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className="relative z-10 flex flex-1 flex-col items-center gap-1 py-1.5"
            >
              <item.Icon
                className={
                  "h-[22px] w-[22px] transition-all duration-300 " +
                  (active ? "scale-110 text-sky-300" : "scale-100 text-neutral-500")
                }
              />
              <span
                className={
                  "text-[10px] font-medium tracking-wide transition-colors duration-300 " +
                  (active ? "text-sky-300" : "text-neutral-500")
                }
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
