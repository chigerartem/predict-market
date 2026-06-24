import { useEffect, useRef, useState } from "react";
import {
  getExchanges,
  type ExchangeBalance,
  type ExchangeInfo,
  type MeResponse,
} from "../api";
import UserAvatar, { tgHandle } from "../components/UserAvatar";
import { fmtUsd } from "../format";
import { useT } from "../i18n";
import bitunixLogo from "../assets/exchanges/bitunix_plain.png";

type Props = {
  me: MeResponse;
  onReload: () => void;
  onOpenReferral: () => void;
};

// Главная: только голубой герой (приветствие + баланс). Контент под героем убран.
export default function Home({ me }: Props) {
  const [exchanges, setExchanges] = useState<ExchangeInfo[] | null>(null);
  useEffect(() => {
    getExchanges()
      .then(setExchanges)
      .catch(() => setExchanges([]));
  }, []);

  const connectedSlugs = new Set(
    me.exchanges
      .filter((e) => e.status === "active" || e.status === "pending")
      .map((e) => e.exchange),
  );
  const visibleBalances = (me.balances || []).filter((b) => connectedSlugs.has(b.exchange));

  const tgU = window.Telegram?.WebApp?.initDataUnsafe?.user;
  const displayName = tgU?.first_name || tgU?.username || me.user.name;
  const userHandle = tgU?.username ? `@${tgU.username}` : tgHandle(me.user);
  const t = useT();

  return (
    <div>
      <div className="flex w-full flex-col bg-gradient-to-b from-[#5CCBFF] to-[#2E9BE6] pb-7 text-white">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-2.5">
            <UserAvatar name={displayName} size={38} />
            <div className="text-left leading-tight">
              <div className="text-[11px] text-white/75">{t("home.greeting")}</div>
              <div className="text-sm font-semibold">{displayName}</div>
            </div>
          </div>
          <div className="text-[11px] text-white/70">{userHandle}</div>
        </div>
        <div className="pt-3">
          <HeroBalanceSwiper balances={visibleBalances} catalog={exchanges} />
        </div>
      </div>
    </div>
  );
}

function HeroBalanceSwiper({
  balances,
  catalog,
}: {
  balances: ExchangeBalance[];
  catalog: ExchangeInfo[] | null;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);

  const onScroll = () => {
    const el = ref.current;
    if (!el || el.clientWidth === 0) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    setIdx((prev) => (prev === i ? prev : i));
  };

  if (balances.length === 0) {
    return (
      <div className="px-8 text-center">
        <div className="text-sm font-medium text-white/85">{t("home.yourCashback")}</div>
        <div className="mt-1 text-6xl font-extrabold tracking-tight tabular-nums">$0.00</div>
        <div className="mt-2 text-xs text-white/75">{t("home.connectToEarn")}</div>
      </div>
    );
  }

  return (
    <div className="relative w-full">
      <div
        ref={ref}
        onScroll={onScroll}
        className="flex w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
      >
        {balances.map((b) => {
          const m = catalog?.find((e) => e.slug === b.exchange);
          return (
            <div
              key={b.exchange}
              className="flex w-full shrink-0 snap-center flex-col items-center px-8 text-center"
            >
              <div className="text-sm font-medium text-white/85">{t("home.yourCashback")}</div>
              <div className="mt-1 text-6xl font-extrabold tracking-tight tabular-nums">
                {fmtUsd(b.native_credited_usd ?? "0")}
              </div>
              <div className="mt-2 flex items-center justify-center gap-1.5 text-xs text-white/75">
                <BalancePillLogo ex={m} fallbackName={b.exchange} />
                <span>{m?.name || b.exchange.toUpperCase()}</span>
                <span>· {m?.user_base_rate_pct ?? 30}%</span>
              </div>
            </div>
          );
        })}
      </div>

      {balances.length > 1 && (
        <div className="absolute inset-x-0 top-full mt-2 flex justify-center gap-1.5">
          {balances.map((b, i) => (
            <span
              key={b.exchange}
              className={
                "h-1.5 rounded-full transition-all " +
                (i === idx ? "w-5 bg-white" : "w-1.5 bg-white/40")
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BalancePillLogo({
  ex,
  fallbackName,
}: {
  ex: ExchangeInfo | null | undefined;
  fallbackName: string;
}) {
  const [idx, setIdx] = useState(0);
  if (ex?.slug === "bitunix") {
    return (
      <span className="grid h-4 w-4 shrink-0 place-items-center overflow-hidden rounded-full bg-[#0a0a0a]">
        <img src={bitunixLogo} alt="" className="h-3 w-3 object-contain" />
      </span>
    );
  }
  const url = ex?.logo_urls?.[idx];
  if (!url) {
    return (
      <span
        className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-[8px] font-bold text-white"
        style={{ background: ex?.brand_color || "#404040" }}
      >
        {(ex?.name || fallbackName)[0]?.toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      onError={() => setIdx((i) => i + 1)}
      className={"h-4 w-4 shrink-0 rounded-full object-cover " + (ex?.slug !== "binance" ? "bg-white" : "")}
    />
  );
}
