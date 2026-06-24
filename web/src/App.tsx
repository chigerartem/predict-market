import { useCallback, useEffect, useRef, useState, type SVGProps } from "react";
import { getMe, markOnboarded, type MeResponse } from "./api";
import Home from "./tabs/Home";
import Trading from "./tabs/Trading";
import Community from "./tabs/Community";
import Profile from "./tabs/Profile";
import Onboarding from "./components/Onboarding";
import { useT, type TKey } from "./i18n";

type Tab = "home" | "trading" | "community" | "profile";
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
const TradingIcon: IconFC = (p) => (
  <IconStroke {...p}>
    <path d="M3 17l6-6 4 4 8-9" />
    <path d="M14 6h7v7" />
  </IconStroke>
);
const CommunityIcon: IconFC = (p) => (
  <IconStroke {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M2.5 19c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5" />
    <circle cx="17" cy="8.5" r="2.5" />
    <path d="M17 13.5c2.6 0 4.5 1.5 4.5 4" />
  </IconStroke>
);
const ProfileIcon: IconFC = (p) => (
  <IconStroke {...p}>
    <circle cx="12" cy="8" r="3.6" />
    <path d="M4.5 20c0-3.6 3.4-6.2 7.5-6.2s7.5 2.6 7.5 6.2" />
  </IconStroke>
);

const TABS: { id: Tab; labelKey: TKey; Icon: IconFC }[] = [
  { id: "home",      labelKey: "nav.home",      Icon: HomeIcon },
  { id: "trading",   labelKey: "nav.trading",   Icon: TradingIcon },
  { id: "community", labelKey: "nav.community", Icon: CommunityIcon },
  { id: "profile",   labelKey: "nav.profile",   Icon: ProfileIcon },
];

const ME_CACHE_KEY = "kopix_me_v1";
// Набор partner_id, в чьих ботах юзер уже прошёл онбординг. Онбординг —
// per-partner (в боте каждого партнёра по разу), а localStorage общий на origin
// (все партнёрские боты = один фронт), поэтому различить «приложения» на клиенте
// можно только namespace'ом по partner_id. Сервер (user_onboardings) — источник
// правды; набор лишь убирает мелькание онбординга до ответа /api/me.
const ONBOARDED_KEY = "kopix_onboarded_partners_v2";

// LinkerFlugel (владелец) всегда видит онбординг при каждом открытии — для теста,
// чтобы проверять, как он работает. В рамках сессии закрывается кнопкой.
const DEV_ALWAYS_ONBOARDING_TG = 1363016153;

// Каркас на самый первый запуск (нет кэша и getMe ещё не вернулся) — чтобы
// показать главный экран сразу, без блокирующей «Загрузки…». Реальные данные
// подменят его, как только придёт ответ. Home устойчив к пустым balances/
// exchanges (рисует состояния «нет данных»), имя берётся из Telegram initData.
const PLACEHOLDER_ME: MeResponse = {
  user: { id: "", tg_id: 0, tg_username: null, name: "", ref_code: "", vip_tier: "bronze", language: "en", onboarded: true },
  partner_id: null,
  ton_balance: "0",
  balances: [],
  exchanges: [],
};

function loadCachedMe(): MeResponse | null {
  try {
    const raw = localStorage.getItem(ME_CACHE_KEY);
    return raw ? (JSON.parse(raw) as MeResponse) : null;
  } catch {
    return null;
  }
}

function loadOnboardedPartners(): Set<string> {
  try {
    const raw = localStorage.getItem(ONBOARDED_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? (arr as string[]) : []);
  } catch {
    return new Set();
  }
}

function rememberOnboardedPartner(prev: Set<string>, pid: string): Set<string> {
  if (prev.has(pid)) return prev;
  const next = new Set(prev).add(pid);
  try {
    localStorage.setItem(ONBOARDED_KEY, JSON.stringify([...next]));
  } catch {
    /* localStorage недоступен — некритично, серверный флаг подстрахует */
  }
  return next;
}

export default function App() {
  const t = useT();
  const [tab, setTab] = useState<Tab>("home");
  // Инициализируемся из кэша: при переоткрытии показываем прошлые данные сразу.
  const [me, setMe] = useState<MeResponse | null>(() => loadCachedMe());
  const [error, setError] = useState<string | null>(null);
  // Пришёл ли СВЕЖИЙ ответ /api/me. Кэшированный me (из localStorage) может
  // содержать устаревший onboarded (напр. true с прошлого захода, после сброса
  // флага) — до свежего ответа им НЕ подавляем онбординг, иначе при первом
  // входе мелькает главный экран, а онбординг всплывает через пару секунд.
  const [meLoaded, setMeLoaded] = useState(false);
  // Онбординг — per партнёр: в боте каждого партнёра показывается по разу.
  // Источник правды — сервер (me.user.onboarded для активного партнёра);
  // локальный набор пройденных partner_id дублирует его, чтобы не мигало до
  // ответа /api/me и работало при сбое сети.
  const [onboardedPartners, setOnboardedPartners] = useState<Set<string>>(
    () => loadOnboardedPartners(),
  );
  // Владелец видит онбординг при каждом открытии; в рамках одной сессии его можно
  // закрыть кнопкой, при переоткрытии Mini App покажется снова.
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  // Открыта ли клавиатура (есть ли в фокусе текстовое поле). Тогда полностью прячем
  // нижний нав: на iOS Telegram fixed-нав иначе всплывает над клавиатурой. Детект по
  // focusin/focusout — надёжнее viewport-эвристик, которые в Telegram не срабатывали.
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  const finishOnboarding = useCallback(() => {
    setOnboardingDismissed(true);
    const pid = me?.partner_id ?? null;
    if (pid) setOnboardedPartners((prev) => rememberOnboardedPartner(prev, pid));
    markOnboarded().catch(() => {
      /* best-effort: при сбое покажем снова на след. входе (записи в БД нет) */
    });
  }, [me]);

  const reload = useCallback(() => {
    getMe()
      .then((m) => {
        setMe(m);
        setMeLoaded(true);
        setError(null);
        // Зеркалим серверную правду в локальный набор: сервер сказал «онбординг
        // в боте этого партнёра пройден» → запоминаем партнёра, чтобы при
        // следующих входах в этот бот онбординг не мелькнул до ответа /api/me.
        if (m.user.onboarded && m.partner_id) {
          const pid = m.partner_id;
          setOnboardedPartners((prev) => rememberOnboardedPartner(prev, pid));
        }
        try {
          localStorage.setItem(ME_CACHE_KEY, JSON.stringify(m));
        } catch {
          /* localStorage недоступен/переполнен — некритично */
        }
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    tg?.ready?.();
    tg?.expand?.();
    tg?.disableVerticalSwipes?.();
    // Красим плашку и фон viewport (стартовая вкладка — home, голубая). Без этого
    // при ПЕРВОМ показе главного фон viewport ещё дефолтный (чёрный) — поэтому
    // первый раз чёрный разрыв, а после смены вкладки уже голубой. Самый первый
    // вызов на холодном старте Telegram иногда «проглатывает», поэтому повторяем
    // после первого кадра, когда WebApp точно готов принять цвет.
    const applyInitialColors = () => {
      try {
        tg?.setHeaderColor?.("#5CCBFF");
        tg?.setBackgroundColor?.("#5CCBFF");
      } catch {
        /* старый клиент — некритично */
      }
    };
    applyInitialColors();
    requestAnimationFrame(applyInitialColors);
    reload();
  }, [reload]);

  // Прячем нав, пока в фокусе текстовое поле (клавиатура открыта). focusin/focusout
  // всплывают до document, поэтому ловим любое поле в любом компоненте.
  useEffect(() => {
    const isField = (el: EventTarget | null) =>
      el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
    const onIn = (e: FocusEvent) => {
      if (isField(e.target)) setKeyboardOpen(true);
    };
    const onOut = (e: FocusEvent) => {
      if (isField(e.target)) setKeyboardOpen(false);
    };
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, []);

  // ── Гейт онбординга. Вычисляем ДО color/scroll-эффектов: пока показан
  //    онбординг, <main> не смонтирован, и эффекты должны перезапуститься, когда
  //    он появится (иначе фон main останется дефолтным тёмным — чёрный разрыв на
  //    главном после закрытия онбординга, до первой смены вкладки). ──
  const activePartner = me?.partner_id ?? null;
  const onboardedLocally = activePartner !== null && onboardedPartners.has(activePartner);
  // Владелец (DEV_ALWAYS_ONBOARDING_TG) видит онбординг при каждом открытии, пока
  // не закроет его в этой сессии. tg_id берём из Telegram initData СИНХРОННО (не
  // из /api/me) — иначе владельцу сперва мелькнёт главный.
  const tgUserId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
  const forceOnboarding =
    tgUserId === DEV_ALWAYS_ONBOARDING_TG && !onboardingDismissed;
  const showOnboarding =
    forceOnboarding ||
    (!onboardedLocally && !error && (!meLoaded || me?.user.onboarded === false));

  // Цвет верхней плашки Telegram: на вкладке «Комьюнити» — голубой (сливается с
  // голубым героем экрана), на остальных вкладках — тёмный фон темы.
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    const blueTab = tab === "community" || tab === "home" || tab === "trading" || tab === "profile";
    // #5CCBFF — верхний цвет голубого героя. Красим И плашку Telegram, И фон
    // viewport (виден при rubber-band overscroll ПОД плашкой — без него там
    // дефолтный чёрный Telegram). Делаем это СТАТИЧНО по вкладке, а НЕ на каждый
    // scroll: setBackgroundColor асинхронный, при резком свайпе он отстаёт и
    // сверху мелькает чёрным. Низ прикрыт нав-баром, поэтому один голубой цвет ок.
    const color = blueTab ? "#5CCBFF" : "#0A0E16";
    try {
      tg?.setHeaderColor?.(color);
      // Фон viewport — в цвет вкладки (голубой сверху, виден при ВЕРХНЕМ
      // overscroll под плашкой). Снизу под нав-баром голубой прикрыт solid-navy
      // подложкой внутри самого nav (см. ниже), поэтому там голубой не проступает.
      tg?.setBackgroundColor?.(color);
    } catch {
      /* старый клиент без setHeaderColor/setBackgroundColor — некритично */
    }
  }, [tab, showOnboarding]);

  // Двухцветный bounce без двух контейнеров: фон скролла = голубой, когда юзер у
  // самого верха (top-overscroll показывает голубой, как герой), и navy, когда
  // пролистал вниз (bottom-overscroll = navy). Фон main виден ТОЛЬКО в зоне
  // перетягивания, поэтому переключение по скроллу глазу незаметно. Голубой —
  // только на вкладках с голубым героем.
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    el.scrollTop = 0; // при смене вкладки всегда показываем верх новой страницы
    const blueTab = tab === "community" || tab === "home" || tab === "trading" || tab === "profile";
    // Фон main (виден при ВНУТРЕННЕМ rubber-band): голубой у верха, navy при
    // листании. Фон viewport Telegram задан статично по вкладке (см. эффект выше).
    const apply = () => {
      // Голубой, пока юзер у верха (scrollTop < 56): верхняя оттяжка сливается с
      // голубым героем/плашкой. Прокрутил ниже → navy, поэтому нижняя оттяжка =
      // тёмный корпус аппа. Порог 56, а НЕ 0: при верхнем rubber-band scrollTop
      // дёргается около нуля (0↔неск. px), и на пороге 0 фон мерцал navy↔голубой
      // (поймано на видео Артёма). Запас в 56px перекрывает дрожь → верх стабильно
      // голубой. Низ стабильно navy, т.к. обёртка гарантирует скролл > порога
      // (min-h +96px ниже). Контент непрозрачный → смену цвета при обычной
      // прокрутке не видно, только в зонах оттяжки. Фон viewport Telegram
      // (голубой, статично по вкладке) снизу прикрыт navy-фоном main.
      el.style.backgroundColor = blueTab && el.scrollTop < 56 ? "#5CCBFF" : "#0A0E16";
    };
    apply();
    el.addEventListener("scroll", apply, { passive: true });
    return () => el.removeEventListener("scroll", apply);
  }, [tab, showOnboarding]);

  if (showOnboarding) {
    return <Onboarding onDone={finishOnboarding} />;
  }

  return (
    <div className="flex h-full flex-col">
      <main ref={mainRef} className="flex-1 overflow-y-scroll overscroll-y-none bg-[#0A0E16]">
        {/* Фон main переключается по позиции скролла (эффект выше): голубой у
            самого верха → top-bounce голубой; navy при листании → bottom-bounce
            navy. Виден только в зоне перетягивания, переключение незаметно. */}
        {/* min-h calc(100%+96px) держит iOS scroll-context активным И гарантирует,
            что даже короткий таб скроллится больше порога двухцветного bounce (56px,
            см. apply выше) — иначе на коротком экране нижняя оттяжка осталась бы
            голубой. 96px — это navy-фон обёртки (не пустой цветной разрыв), на
            длинных табах не виден (контент выше min-h). Навбар-клиренс даёт
            собственный pb-28 каждого таба — отдельный pb тут НЕ ставим. */}
        <div className="min-h-[calc(100%+96px)] bg-[#0A0E16]">
          {/* Ошибку показываем, только если данных нет вообще (ни кэша, ни
              свежих) — это случай «открыли вне Telegram» / отказ авторизации.
              Если кэш есть, фоновый сбой обновления молча игнорируем. */}
          {error && !me && (
            <div className="m-4 rounded-lg bg-red-900/40 p-4 text-sm text-red-200">
              {t("app.loadError", { error: error ?? "" })}
            </div>
          )}
          {!(error && !me) && (
            <>
              <div hidden={tab !== "home"}><Home me={me ?? PLACEHOLDER_ME} onReload={reload} onOpenReferral={() => setTab("community")} /></div>
              <div hidden={tab !== "trading"}><Trading me={me ?? PLACEHOLDER_ME} /></div>
              <div hidden={tab !== "community"}><Community me={me ?? PLACEHOLDER_ME} /></div>
              <div hidden={tab !== "profile"}><Profile me={me ?? PLACEHOLDER_ME} active={tab === "profile"} /></div>
            </>
          )}
        </div>
      </main>

      {/* Нижнее меню — плавающий островок: оторван от краёв (отступы по бокам +
          над home-indicator через safe-area), скруглён, стекло navy с тенью.
          Контент проглядывает по бокам и снизу под ним — отсюда вид «острова».
          Полноширинная подложка home-indicator не нужна: вокруг острова виден
          navy-фон контента/main (низ всегда тёмный, см. apply). */}
      <nav
        className={
          "fixed inset-x-0 z-40 flex justify-center px-5 transition-opacity duration-150 " +
          (keyboardOpen ? "pointer-events-none opacity-0" : "opacity-100")
        }
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 10px)" }}
      >
        <div className="relative flex w-full max-w-sm rounded-[26px] border border-white/10 bg-[#11151C]/85 p-1.5 shadow-[0_12px_40px_-10px_rgba(0,0,0,0.8)] backdrop-blur-2xl">
          {/* Скользящая голубая плашка под активной вкладкой: ОДИН общий элемент,
              едет по X к индексу активного таба (transform-transition с лёгким
              пружинным ease) — переключение «перетекает», а не моргает. Ширина =
              1/4 трека (минус p-1.5 по бокам), translateX(index*100%) = свой размер
              на каждый шаг → ровно ложится на кнопку (кнопки flush, gap-0). */}
          <span
            aria-hidden
            className="absolute bottom-1.5 left-1.5 top-1.5 rounded-[20px] bg-sky-400/15 transition-transform duration-300 ease-[cubic-bezier(0.34,1.4,0.64,1)]"
            style={{
              width: "calc((100% - 12px) / 4)",
              transform: `translateX(${TABS.findIndex((x) => x.id === tab) * 100}%)`,
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
                  {t(item.labelKey)}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
