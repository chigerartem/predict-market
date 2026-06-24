import { useEffect, useRef, useState } from "react";
import {
  disconnectExchange,
  getExchanges,
  getGlobalStats,
  type ExchangeBalance,
  type ExchangeInfo,
  type GlobalStats,
  type MeResponse,
} from "../api";
import ConnectExchangeModal from "../components/ConnectExchangeModal";
import UserAvatar, { tgHandle } from "../components/UserAvatar";
import { fmtUsd, fmtUsdCompact, fmtInt } from "../format";
import { useT } from "../i18n";
import bitunixLogo from "../assets/exchanges/bitunix_plain.png";

// VIP-надбавка за тир временно убрана из UI: показываем одну ставку (базовую,
// из user_base_rate_pct). Тиры вернём, привязав к обороту.

// Кэш домашних данных (SWR): при переоткрытии показываем мгновенно из прошлого
// снимка, потом обновляем фоном.
const CK_EXCH = "kopix_exchanges_v1";
// Витрина (числа сверху + последние выплаты) — per-бот: кешируем в namespace
// partner_id. Свой бот грузится мгновенно из кеша; данные чужого бота не
// подмешиваются — при переключении мелькнут максимум раз, потом запомнятся.
// last_partner — последний виденный бот, для синхронной гидрации ДО fetch.
const CK_LAST_PARTNER = "kopix_last_partner_v1";
const ckShowcase = (pid: string) => `kopix_showcase_${pid}_v1`;
type ShowcaseCache = { stats: GlobalStats };

function cacheGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function cacheSet<T>(key: string, val: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    /* localStorage недоступен/полон — некритично */
  }
}

// Синхронная гидрация витрины из кеша последнего виденного бота (до fetch).
function showcaseFromCache(): { stats: GlobalStats | null } {
  const pid = cacheGet<string>(CK_LAST_PARTNER);
  if (!pid) return { stats: null };
  const c = cacheGet<ShowcaseCache>(ckShowcase(pid));
  return { stats: c?.stats ?? null };
}

type Props = {
  me: MeResponse;
  onReload: () => void;
  onOpenReferral: () => void;
};

export default function Home({ me, onReload, onOpenReferral }: Props) {
  const t = useT();
  const [connectTarget, setConnectTarget] = useState<ExchangeInfo | null>(null);
  // Витрина — гидрируем из кеша последнего бота (синхронно, до fetch): свой бот
  // при переоткрытии показывается мгновенно, без мигания $0. exchanges — глобальный
  // список бирж, кешируется отдельно.
  const [stats, setStats] = useState<GlobalStats | null>(() => showcaseFromCache().stats);
  const [exchanges, setExchanges] = useState<ExchangeInfo[] | null>(() => cacheGet<ExchangeInfo[]>(CK_EXCH));

  useEffect(() => {
    // Витрина: числа сверху. Обновляем UI и кешируем в namespace бота (partner_id).
    getGlobalStats()
      .then((s) => {
        if (!s) return;
        setStats(s);
        if (s.partner_id) {
          cacheSet(CK_LAST_PARTNER, s.partner_id);
          cacheSet(ckShowcase(s.partner_id), { stats: s });
        }
      })
      .catch(() => {});
    getExchanges()
      .then((e) => { setExchanges(e); cacheSet(CK_EXCH, e); })
      .catch(() => setExchanges((p) => p ?? []));
  }, []);

  // Балансы, которые показываем: только биржи с подключённым (active/pending) аккаунтом.
  const connectedSlugs = new Set(
    me.exchanges
      .filter((e) => e.status === "active" || e.status === "pending")
      .map((e) => e.exchange),
  );
  const visibleBalances = (me.balances || []).filter((b) => connectedSlugs.has(b.exchange));

  const reloadExchanges = () => {
    getExchanges().then((e) => { setExchanges(e); cacheSet(CK_EXCH, e); }).catch(() => {});
    onReload();
  };

  // Имя и @handle — из живого Telegram-профиля (initDataUnsafe обновляется при
  // каждом открытии Mini App), фолбэк на значения из БД. Иначе после смены
  // имени/юзернейма в Telegram в шапке остаётся старое.
  const tgU = window.Telegram?.WebApp?.initDataUnsafe?.user;
  const displayName = tgU?.first_name || tgU?.username || me.user.name;
  const userHandle = tgU?.username ? `@${tgU.username}` : tgHandle(me.user);

  return (
    <div>
      {/* Голубой герой Главной: приветствие + крупная сумма кешбэка. Плашка
          Telegram голубая на этой вкладке (см. App.tsx) — бесшовно с фоном. */}
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

      <div className="min-h-screen space-y-5 bg-[#0A0E16] px-4 pb-32 pt-5">
      <div className="grid grid-cols-3 gap-2">
        <Stat label={t("home.statPaidOut")} value={fmtUsdCompact(stats?.total_paid_out_usd)} />
        <Stat label={t("home.statTraders")} value={fmtInt(stats?.total_traders)} />
        <Stat label={t("home.statVolume30d")} value={fmtUsdCompact(stats?.volume_30d_usd)} />
      </div>

      <ExchangesList
        exchanges={exchanges}
        onConnect={(ex) => setConnectTarget(ex)}
        onDisconnect={async (ex) => {
          const ok = window.confirm(t("home.disconnectConfirm", { name: ex.name }));
          if (!ok) return;
          try {
            await disconnectExchange(ex.slug);
            reloadExchanges();
          } catch (e: unknown) {
            alert(e instanceof Error ? e.message : String(e));
          }
        }}
      />

      <button
        onClick={onOpenReferral}
        className="flex w-full items-center gap-4 rounded-3xl border border-sky-400/25 bg-gradient-to-br from-sky-400/[0.12] to-sky-400/[0.03] p-5 text-left transition active:scale-[0.99]"
      >
        <div className="flex-1">
          <div className="text-base font-semibold">{t("home.inviteFriends")}</div>
          <div className="mt-0.5 text-sm leading-relaxed text-neutral-400">
            {t("home.inviteSubtitle")}
          </div>
        </div>
        <span className="shrink-0 text-xl text-sky-300">→</span>
      </button>
      </div>

      <ConnectExchangeModal
        open={connectTarget !== null}
        exchange={connectTarget}
        onClose={() => setConnectTarget(null)}
        onSuccess={reloadExchanges}
      />
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

  // Активный слайд определяем по позиции горизонтального скролла (нативный свайп
  // со snap). Без отдельного состояния-переключателя.
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
        <div className="mt-2 text-xs text-white/75">
          {t("home.connectToEarn")}
        </div>
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
              {/* Та же раскладка, что и в «не подключено» (ниже): label → сумма
                  text-6xl → подпись снизу — чтобы высота героя и размер шрифта НЕ
                  отличались между подключённым и неподключённым состоянием. */}
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

      {/* Точки-переключатели — ABSOLUTE (вне потока), плавают в нижнем отступе
          героя (pb-7). Так высота героя НЕ растёт при нескольких биржах и совпадает
          с состоянием «одна биржа» (Артём: герой не должен удлиняться). */}
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
  // Bitunix — локальный лого на тёмной подложке (см. ExchangeLogo).
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

function ExchangesList({
  exchanges,
  onConnect,
  onDisconnect,
}: {
  exchanges: ExchangeInfo[] | null;
  onConnect: (ex: ExchangeInfo) => void;
  onDisconnect: (ex: ExchangeInfo) => void;
}) {
  const t = useT();
  if (exchanges === null) {
    return <div className="text-sm text-neutral-500">{t("common.loading")}</div>;
  }

  const connected = exchanges.filter((e) => e.status === "active" || e.status === "pending");
  const addable = exchanges.filter((e) => e.status === "not_connected" && e.available);
  const soon = exchanges.filter((e) => e.status === "coming_soon");

  return (
    <div className="space-y-5">
      {connected.length > 0 && (
        <section className="rounded-3xl border border-white/[0.07] bg-white/[0.03] p-5">
          <h2 className="mb-3 text-base font-semibold">{t("home.myExchanges")}</h2>
          <ul className="space-y-2">
            {connected.map((ex) => (
              <li key={ex.slug}>
                <ConnectedRow ex={ex} onDisconnect={onDisconnect} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {(addable.length > 0 || soon.length > 0) && (
        <section className="rounded-3xl border border-white/[0.07] bg-white/[0.03] p-5">
          <h2 className="mb-1 text-base font-semibold">
            {connected.length > 0 ? t("home.addExchange") : t("home.connectExchange")}
          </h2>
          {connected.length === 0 && (
            <p className="mb-1 text-sm leading-relaxed text-neutral-400">
              {t("home.connectIntro")}
            </p>
          )}
          <ul className="mt-3 space-y-2">
            {addable.map((ex) => (
              <li key={ex.slug}>
                <AvailableRow ex={ex} onConnect={onConnect} />
              </li>
            ))}
            {soon.map((ex) => (
              <li key={ex.slug}>
                <AvailableRow ex={ex} onConnect={onConnect} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// Бейдж «+ VIP на бирже» (только Bitunix) — голубой, в стиле аппа. Сама корона
// (анимир. Lottie) живёт в модалке подключения у блока VIP-статуса, не тут.
function VipBadge() {
  const t = useT();
  return (
    <span
      className="shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[9px] font-semibold leading-none"
      style={{ background: "#5CCBFF26", color: "#5CCBFF" }}
    >
      {t("home.vipBadge")}
    </span>
  );
}

function ConnectedRow({
  ex,
  onDisconnect,
}: {
  ex: ExchangeInfo;
  onDisconnect: (ex: ExchangeInfo) => void;
}) {
  const t = useT();
  const isActive = ex.status === "active";
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white/[0.03] px-3 py-3 ring-1 ring-inset ring-white/[0.06]">
      <ExchangeLogo ex={ex} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{ex.name}</span>
        </div>
        <div className="truncate text-[11px] text-neutral-500">
          {isActive
            ? ex.uid
              ? ex.slug === "binance"
                ? maskEmail(ex.uid)
                : `UID ${maskUid(ex.uid)}`
              : t("home.statusActive")
            : t("home.statusAwaiting")}
        </div>
      </div>
      {/* Явный статус-чип вместо непонятной точки */}
      {isActive ? (
        <span className="inline-flex shrink-0 items-center rounded-full bg-[#5CCBFF]/10 px-2.5 py-1 text-[11px] font-medium text-[#5CCBFF] ring-1 ring-inset ring-[#5CCBFF]/25">
          {t("home.statusConnected")}
        </span>
      ) : (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-400/10 px-2.5 py-1 text-[11px] font-medium text-amber-300 ring-1 ring-inset ring-amber-400/20">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          {t("home.statusPending")}
        </span>
      )}
      {/* Явная корзина вместо троеточия — одно понятное действие «отключить»;
          подтверждение остаётся (см. onDisconnect), чтобы не снести случайно. */}
      <button
        onClick={() => onDisconnect(ex)}
        aria-label={t("home.disconnectAria", { name: ex.name })}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-neutral-500 transition hover:bg-rose-500/10 hover:text-rose-300"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      </button>
    </div>
  );
}

function AvailableRow({
  ex,
  onConnect,
}: {
  ex: ExchangeInfo;
  onConnect: (ex: ExchangeInfo) => void;
}) {
  const t = useT();
  const isComingSoon = ex.status === "coming_soon";
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white/[0.03] px-3 py-3 ring-1 ring-inset ring-white/[0.06]">
      <ExchangeLogo ex={ex} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{ex.name}</span>
          {ex.slug === "bitunix" && <VipBadge />}
        </div>
        <div className="truncate text-[11px] text-neutral-500">
          {isComingSoon
            ? t("home.integrationWip")
            : t("home.pctCashback", { pct: ex.user_base_rate_pct })}
        </div>
      </div>
      {isComingSoon ? (
        <span className="shrink-0 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] text-neutral-400">
          {t("common.soon")}
        </span>
      ) : (
        <button
          onClick={() => onConnect(ex)}
          className="shrink-0 rounded-xl bg-[#5CCBFF] px-3.5 py-1.5 text-xs font-semibold text-[#04243b] transition active:scale-95"
        >
          {t("home.connectBtn")}
        </button>
      )}
    </div>
  );
}

function ExchangeLogo({ ex }: { ex: ExchangeInfo }) {
  const [idx, setIdx] = useState(0);
  // Bitunix — локальный лого на тёмной подложке: грузится из бандла (без
  // перезагрузки google-favicon) и без bg-white (иначе тонкие белые углы у лого).
  if (ex.slug === "bitunix") {
    return (
      <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-[#0a0a0a]">
        <img src={bitunixLogo} alt={ex.name} className="h-7 w-7 object-contain" />
      </span>
    );
  }
  const url = ex.logo_urls?.[idx];
  if (!url) {
    return (
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-bold text-white"
        style={{ background: ex.brand_color }}
      >
        {ex.name[0]}
      </span>
    );
  }
  return (
    <span className={"block h-9 w-9 shrink-0 overflow-hidden rounded-lg " + (ex.slug !== "binance" ? "bg-white" : "")}>
      <img
        src={url}
        alt={ex.name}
        className="h-full w-full object-cover"
        referrerPolicy="no-referrer"
        onError={() => setIdx((i) => i + 1)}
      />
    </span>
  );
}

function maskUid(uid: string): string {
  if (uid.length <= 4) return uid;
  return uid.slice(0, 2) + "•••" + uid.slice(-3);
}

function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 0) return maskUid(email);
  const name = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = name.length <= 2 ? name.slice(0, 1) : name.slice(0, 2);
  return `${head}•••@${domain}`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] p-3 text-center">
      <div className="text-lg font-bold tabular-nums">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wider text-neutral-500">
        {label}
      </div>
    </div>
  );
}
