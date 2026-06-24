import { useEffect, useMemo, useRef, useState } from "react";
import lottie from "lottie-web";
import type { ExchangeInfo, MeResponse } from "../api";
import { getExchanges } from "../api";
import { makeSelectionTicker } from "../haptics";
import { useT, type TKey } from "../i18n";

const VOL_MIN = 5;
const VOL_MAX = 100_000;
const VOL_SLIDER_STEPS = 1000;

function sliderToVolume(s: number): number {
  const ratio = Math.max(0, Math.min(1, s / VOL_SLIDER_STEPS));
  const raw = VOL_MIN * Math.pow(VOL_MAX / VOL_MIN, ratio);
  return snapVolume(raw);
}

function volumeToSlider(v: number): number {
  const r = Math.log(v / VOL_MIN) / Math.log(VOL_MAX / VOL_MIN);
  return Math.round(VOL_SLIDER_STEPS * Math.max(0, Math.min(1, r)));
}

function snapVolume(v: number): number {
  if (v < 20) return Math.max(VOL_MIN, Math.round(v));
  if (v < 50) return Math.round(v / 5) * 5;
  if (v < 200) return Math.round(v / 10) * 10;
  if (v < 500) return Math.round(v / 25) * 25;
  if (v < 1000) return Math.round(v / 50) * 50;
  if (v < 5000) return Math.round(v / 100) * 100;
  if (v < 10_000) return Math.round(v / 250) * 250;
  if (v < 50_000) return Math.round(v / 500) * 500;
  return Math.round(v / 1000) * 1000;
}

// Сделок в день — логарифмическая шкала: 1-10 занимает первую половину ползунка
// (при ratio 0.5 → 10 сделок), 10-100 — вторую. Большинство юзеров делают 1-10
// сделок, поэтому им нужна точность на малых числах, а не равномерная шкала 1-100.
const TRADES_MIN = 1;
const TRADES_MAX = 100;
const TRADES_SLIDER_STEPS = 1000;

function sliderToTrades(s: number): number {
  const ratio = Math.max(0, Math.min(1, s / TRADES_SLIDER_STEPS));
  const raw = TRADES_MIN * Math.pow(TRADES_MAX / TRADES_MIN, ratio);
  return snapTrades(raw);
}

function tradesToSlider(v: number): number {
  const r = Math.log(v / TRADES_MIN) / Math.log(TRADES_MAX / TRADES_MIN);
  return Math.round(TRADES_SLIDER_STEPS * Math.max(0, Math.min(1, r)));
}

function snapTrades(v: number): number {
  if (v <= 10) return Math.max(TRADES_MIN, Math.round(v)); // 1..10 по одному
  if (v < 20) return Math.round(v / 2) * 2;                // 12,14,16,18
  if (v < 50) return Math.round(v / 5) * 5;                // 20,25,...,45
  return Math.round(v / 10) * 10;                          // 50,60,...,100
}

const LEVERAGES = [1, 5, 10, 25, 50, 100];

type Mode = "spot" | "perp_maker" | "perp_taker";

const MODES: { key: Mode; shortKey: TKey; usesLeverage: boolean }[] = [
  { key: "perp_taker", shortKey: "trading.modeFuturesTakerShort", usesLeverage: true  },
  { key: "perp_maker", shortKey: "trading.modeFuturesMakerShort", usesLeverage: true  },
  { key: "spot",       shortKey: "trading.modeSpot",              usesLeverage: false },
];

function feeRateFor(ex: ExchangeInfo, mode: Mode): number {
  switch (mode) {
    case "spot": return ex.fees.spot_taker_pct / 100;
    case "perp_maker": return ex.fees.perp_maker_pct / 100;
    case "perp_taker": return ex.fees.perp_taker_pct / 100;
  }
}

export default function Trading({ me }: { me: MeResponse }) {
  const t = useT();
  const [leverage, setLeverage] = useState(10);
  const [volume, setVolume] = useState(500);
  const [tradesPerDay, setTradesPerDay] = useState(5);
  const [mode, setMode] = useState<Mode>("perp_taker");
  const [exchanges, setExchanges] = useState<ExchangeInfo[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  useEffect(() => {
    getExchanges().then((list) => {
      setExchanges(list);
      // Prefer the user's connected exchange; otherwise first available.
      const connected = list.find((e) => e.status === "active" || e.status === "pending");
      setSelectedSlug(connected?.slug || list.find((e) => e.available)?.slug || list[0]?.slug || null);
    }).catch(() => {});
  }, []);

  const selected = useMemo(
    () => exchanges.find((e) => e.slug === selectedSlug) ?? null,
    [exchanges, selectedSlug],
  );

  const modeObj = MODES.find((m) => m.key === mode)!;

  // Ставка кешбэка = базовая ставка выбранной биржи (bitunix 40%, bingx/mexc 33%).
  // VIP-надбавка за тир временно убрана (вернём по обороту) — ставка одна, без «+%».
  const baseRate = (selected?.user_base_rate_pct ?? 30) / 100;
  const curRate = baseRate;

  const effectiveLeverage = modeObj.usesLeverage ? leverage : 1;
  const feeRate = selected ? feeRateFor(selected, mode) : 0;

  const calc = useMemo(() => {
    const position = volume * effectiveLeverage;
    const feePerTrade = position * feeRate;
    const userCbPerTrade = feePerTrade * curRate;
    const daily = userCbPerTrade * tradesPerDay;
    const monthly = daily * 30;
    return { position, feePerTrade, userCbPerTrade, daily, monthly };
  }, [volume, effectiveLeverage, tradesPerDay, curRate, feeRate]);

  // Чипы бирж сортируем по АБСОЛЮТНОМУ кэшбэку юзеру (не по %): комиссия биржи за
  // выбранный режим × ставка (база биржи + VIP). Больше реальных денег → левее. Так
  // биржа с бОльшими комиссиями при меньшем % может стоять выше. Зависит от режима
  // (комиссии разные) и от ставки — при их смене порядок пересчитывается. Доступные
  // биржи всегда впереди «скоро».
  const sortedExchanges = useMemo(() => {
    const absCashback = (ex: ExchangeInfo) =>
      feeRateFor(ex, mode) * ((ex.user_base_rate_pct ?? 0) / 100);
    return [...exchanges].sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      return absCashback(b) - absCashback(a);
    });
  }, [exchanges, mode]);

  return (
    <div>
      {/* Голубой герой: ЖИВОЙ результат расчёта (обновляется от инпутов ниже).
          Плашка Telegram голубая на этой вкладке (App.tsx). */}
      <div className="relative isolate flex min-h-[218px] w-full flex-col items-center justify-end overflow-hidden bg-gradient-to-b from-[#5CCBFF] to-[#2E9BE6] px-6 pb-7 text-center text-white">
        {/* Статуя Свободы (Lottie, эмодзи GiftsRO#38) — выглядывает из-за ПРАВОГО
            края экрана и машет факелом. translate-x прячет ~половину за краем,
            overflow-hidden её срезает; -z-10 + isolate держат её ПОЗАДИ текста
            героя, но над голубым градиентом. pointer-events-none — не ловит тапы.
            bottom-0 + translate-y-[8%] сдвигают вниз так, чтобы НОГИ встали на нижний
            край героя (у эмодзи снизу прозрачное поле — оно уходит под край и режется). */}
        <LibertyLottie className="pointer-events-none absolute -z-10 bottom-0 right-0 h-40 w-40 translate-x-[40%] translate-y-[8%]" />
        {selected && (
          <div className="text-[11px] font-medium text-white/70">{selected.name} · {t(modeObj.shortKey)}</div>
        )}
        <div className="mt-1 text-[12px] font-medium uppercase tracking-wider text-white/80">{t("trading.yourSavings")}</div>
        <div className="mt-1 text-6xl font-extrabold tracking-tight tabular-nums">{fmtMoney(calc.monthly)}</div>
        <div className="mt-1 text-sm text-white/85">
          {t("trading.perMonth")} · <span className="font-semibold tabular-nums">{fmtMoney(calc.daily)}</span> {t("trading.perDay")}
        </div>
      </div>

      <div className="min-h-screen space-y-4 bg-[#0A0E16] px-4 pb-32 pt-5">
        {/* ── Калькулятор ────────────────────────────────────── */}
        <section className="rounded-3xl border border-white/[0.07] bg-white/[0.03] p-5">
          <h2 className="text-base font-semibold">{t("trading.calcTitle")}</h2>
          <p className="mt-1 text-xs text-neutral-500">
            {t("trading.calcSubtitle")}
          </p>

          {/* Exchange selector */}
          <div className="mt-4">
            <div className="text-xs uppercase tracking-wider text-neutral-500">{t("trading.exchange")}</div>
            <div
              className="mt-2 grid gap-1.5"
              style={{
                gridTemplateColumns: `repeat(${Math.min(Math.max(exchanges.length, 1), 5)}, minmax(0, 1fr))`,
              }}
            >
              {sortedExchanges.map((ex) => {
                const active = selectedSlug === ex.slug;
                return (
                  <button
                    key={ex.slug}
                    onClick={() => setSelectedSlug(ex.slug)}
                    className={
                      "relative flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[10px] transition " +
                      (active
                        ? "bg-[#5CCBFF] text-[#04243b] font-medium"
                        : "bg-white/[0.04] text-neutral-300")
                    }
                  >
                    <ExchangeLogo ex={ex} active={active} />
                    <span className="leading-tight">{ex.name}</span>
                    {!ex.available && (
                      <span className="absolute -top-1 -right-1 rounded-full bg-amber-500 px-1 text-[8px] font-bold uppercase leading-tight text-black">
                        soon
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Mode selector */}
          <div className="mt-4">
            <div className="text-xs uppercase tracking-wider text-neutral-500">{t("trading.tradeType")}</div>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {MODES.map((m) => (
                <button
                  key={m.key}
                  onClick={() => setMode(m.key)}
                  className={
                    "rounded-xl py-2 text-xs transition " +
                    (mode === m.key
                      ? "bg-[#5CCBFF] text-[#04243b] font-medium"
                      : "bg-white/[0.04] text-neutral-300")
                  }
                >
                  {t(m.shortKey)}
                </button>
              ))}
            </div>
          </div>

          {modeObj.usesLeverage && (
            <div className="mt-4">
              <div className="text-xs uppercase tracking-wider text-neutral-500">{t("trading.leverage")}</div>
              <div className="mt-2 grid grid-cols-6 gap-1.5">
                {LEVERAGES.map((l) => (
                  <button
                    key={l}
                    onClick={() => setLeverage(l)}
                    className={
                      "rounded-xl py-2 text-sm transition " +
                      (leverage === l
                        ? "bg-[#5CCBFF] text-[#04243b] font-medium"
                        : "bg-white/[0.04] text-neutral-300")
                    }
                  >
                    {l}x
                  </button>
                ))}
              </div>
            </div>
          )}

          <LogSlider
            label={modeObj.usesLeverage ? t("trading.marginPerTrade") : t("trading.volumePerTrade")}
            value={volume}
            onChange={setVolume}
            toSlider={volumeToSlider}
            toValue={sliderToVolume}
            steps={VOL_SLIDER_STEPS}
            ticks={[fmtMoney(VOL_MIN), "$100", "$1K", "$10K", fmtMoney(VOL_MAX)]}
            fmt={fmtMoney}
          />

          <LogSlider
            label={t("trading.tradesPerDay")}
            value={tradesPerDay}
            onChange={setTradesPerDay}
            toSlider={tradesToSlider}
            toValue={sliderToTrades}
            steps={TRADES_SLIDER_STEPS}
            ticks={["1", "5", "10", "30", "100"]}
            fmt={(v) => String(v)}
          />

          {selected && !selected.available && (
            <div className="mt-4 rounded-xl bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
              {t("trading.comingSoonNote", { name: selected.name })}
            </div>
          )}

          {selected && (
            <div className="mt-4 border-t border-white/[0.08] pt-3 text-[11px] leading-relaxed text-neutral-500">
              {t("trading.calcA", {
                position: fmtMoney(calc.position),
                fee: (feeRate * 100).toFixed(3),
                name: selected.name,
                feePerTrade: fmtMoney(calc.feePerTrade),
                rate: (curRate * 100).toFixed(0),
              })}
              <b className="text-sky-300">{fmtMoney(calc.userCbPerTrade)}</b>
              {t("trading.calcB")}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// Анимированная Статуя Свободы из эмодзи-библиотеки (GiftsRO#38 → liberty.json),
// выглядывает из-за края экрана на экране калькулятора.
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

function ExchangeLogo({ ex, active }: { ex: ExchangeInfo; active: boolean }) {
  const [idx, setIdx] = useState(0);
  const url = ex.logo_urls[idx];
  if (!url) {
    return (
      <div
        className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold"
        style={{ background: ex.brand_color, color: "white" }}
      >
        {ex.name[0]}
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={ex.name}
      onError={() => setIdx((i) => i + 1)}
      className={
        "h-7 w-7 rounded-full object-cover " +
        (ex.slug !== "binance" ? "bg-white " : "") +
        (!ex.available && !active ? "opacity-50" : "")
      }
    />
  );
}

function LogSlider({
  label,
  value,
  onChange,
  toSlider,
  toValue,
  steps,
  ticks,
  fmt,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  toSlider: (v: number) => number;
  toValue: (s: number) => number;
  steps: number;
  ticks: string[];
  fmt: (v: number) => string;
}) {
  const tick = useRef(makeSelectionTicker()).current;
  return (
    <div className="mt-5">
      <div className="flex items-baseline justify-between">
        <div className="text-xs uppercase tracking-wider text-neutral-500">{label}</div>
        <div className="text-sm text-neutral-200">{fmt(value)}</div>
      </div>
      <input
        type="range"
        min={0}
        max={steps}
        step={1}
        value={toSlider(value)}
        onChange={(e) => {
          const v = toValue(Number(e.target.value));
          onChange(v);
          tick(v);
        }}
        className="range mt-2"
      />
      <div className="mt-1 flex justify-between text-[10px] text-neutral-500">
        {ticks.map((t, i) => (
          <span key={i}>{t}</span>
        ))}
      </div>
    </div>
  );
}

function fmtMoney(v: number): string {
  if (v >= 1000) {
    return "$" + Math.round(v).toLocaleString("en-US");
  }
  if (v >= 10) return "$" + v.toFixed(0);
  if (v >= 1) return "$" + v.toFixed(2);
  return "$" + v.toFixed(3);
}
