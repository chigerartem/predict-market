import { useEffect, useMemo, useRef, useState } from "react";
import lottie from "lottie-web";
import type { ExchangeInfo, MeResponse } from "../api";
import { getExchanges } from "../api";
import { useT } from "../i18n";

type Mode = "spot" | "perp_maker" | "perp_taker";

function feeRateFor(ex: ExchangeInfo, mode: Mode): number {
  switch (mode) {
    case "spot":
      return ex.fees.spot_taker_pct / 100;
    case "perp_maker":
      return ex.fees.perp_maker_pct / 100;
    case "perp_taker":
      return ex.fees.perp_taker_pct / 100;
  }
}

// Trading: только голубой герой со Статуей Свободы (liberty) + цифра.
// Калькулятор под героем убран; цифра считается по дефолтным параметрам.
export default function Trading({ me: _me }: { me: MeResponse }) {
  const t = useT();
  const [exchanges, setExchanges] = useState<ExchangeInfo[]>([]);
  useEffect(() => {
    getExchanges()
      .then(setExchanges)
      .catch(() => {});
  }, []);

  const selected =
    exchanges.find((e) => e.status === "active" || e.status === "pending") ??
    exchanges[0] ??
    null;

  const monthly = useMemo(() => {
    const volume = 500;
    const leverage = 10;
    const tradesPerDay = 5;
    const rate = (selected?.user_base_rate_pct ?? 30) / 100;
    const feeRate = selected ? feeRateFor(selected, "perp_taker") : 0.0005;
    return volume * leverage * feeRate * rate * tradesPerDay * 30;
  }, [selected]);

  return (
    <div>
      <div className="relative isolate flex min-h-[218px] w-full flex-col items-center justify-end overflow-hidden bg-gradient-to-b from-[#5CCBFF] to-[#2E9BE6] px-6 pb-7 text-center text-white">
        <LibertyLottie className="pointer-events-none absolute -z-10 bottom-0 right-0 h-40 w-40 translate-x-[40%] translate-y-[8%]" />
        {selected && (
          <div className="text-[11px] font-medium text-white/70">{selected.name}</div>
        )}
        <div className="mt-1 text-[12px] font-medium uppercase tracking-wider text-white/80">
          {t("trading.yourSavings")}
        </div>
        <div className="mt-1 text-6xl font-extrabold tracking-tight tabular-nums">
          {fmtMoney(monthly)}
        </div>
        <div className="mt-1 text-sm text-white/85">{t("trading.perMonth")}</div>
      </div>
    </div>
  );
}

function LibertyLottie({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const anim = lottie.loadAnimation({
      container: el,
      renderer: "svg",
      loop: true,
      autoplay: true,
      path: "/lottie/liberty.json",
    });
    return () => anim.destroy();
  }, []);
  return <div ref={ref} className={className} aria-hidden />;
}

function fmtMoney(v: number): string {
  if (v >= 1000) return "$" + Math.round(v).toLocaleString("en-US");
  if (v >= 10) return "$" + v.toFixed(0);
  if (v >= 1) return "$" + v.toFixed(2);
  return "$" + v.toFixed(3);
}
