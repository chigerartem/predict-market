import { useCallback, useEffect, useRef, useState, type SVGProps } from "react";
import { getMe, markOnboarded, type MeResponse } from "./api";
import Home from "./tabs/Home";
// Все вкладки и онбординг грузим в стартовом бандле (без lazy) и держим
// смонтированными — навигация мгновенная, без догрузки чанков/данных при первом
// заходе на вкладку. lottie-web попадает в основной бандл (грузится один раз на
// старте), дальше все анимации мгновенны.
import MyBets from "./tabs/MyBets";
import Games from "./tabs/Games";
import Profile from "./tabs/Profile";
import Onboarding from "./components/Onboarding";
import PixelGround from "./components/PixelGround";
import { useT, type TKey } from "./i18n";

type Tab = "home" | "bets" | "games" | "profile";
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
const BetsIcon: IconFC = (p) => (
  <IconStroke {...p}>
    <path d="M5 3.5h14v17l-2.5-1.5L14 20.5l-2-1.5-2 1.5-2.5-1.5L5 20.5z" />
    <path d="M9 8.5h6M9 12.5h4" />
  </IconStroke>
);
const GamesIcon: IconFC = (p) => (
  <IconStroke {...p}>
    <path d="M6 11h4M8 9v4" />
    <circle cx="15.5" cy="10" r="0.6" fill="currentColor" stroke="none" />
    <circle cx="17.5" cy="12.5" r="0.6" fill="currentColor" stroke="none" />
    <path d="M17.5 5.5H7a5 5 0 0 0-5 5l-.6 5.4A2.3 2.3 0 0 0 3.7 18.5c.9 0 1.7-.5 2.1-1.3L6.7 16h10.6l.9 1.2c.4.8 1.2 1.3 2.1 1.3a2.3 2.3 0 0 0 2.3-2.6L22 10.5a5 5 0 0 0-4.5-5z" />
  </IconStroke>
);
const ProfileIcon: IconFC = (p) => (
  <IconStroke {...p}>
    <circle cx="12" cy="8" r="3.6" />
    <path d="M4.5 20c0-3.6 3.4-6.2 7.5-6.2s7.5 2.6 7.5 6.2" />
  </IconStroke>
);

const TABS: { id: Tab; labelKey: TKey; Icon: IconFC }[] = [
  { id: "home",    labelKey: "nav.home",    Icon: HomeIcon },
  { id: "bets",    labelKey: "nav.bets",    Icon: BetsIcon },
  { id: "games",   labelKey: "nav.games",   Icon: GamesIcon },
  { id: "profile", labelKey: "nav.profile", Icon: ProfileIcon },
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
  // Все вкладки смонтированы сразу и держатся в DOM (hidden при неактивности):
  // данные/лотти грузятся при старте, переключение мгновенно, состояние и скролл
  // вкладок сохраняются.
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
  // Открыта ли полноэкранная игра (RocketGame) на вкладке Games. Тогда фон вкладки —
  // тёмный (игра = тёмный космос), а НЕ голубой: иначе при закрытии клавиатуры голубой
  // фон Games проступал на кадр под тёмной игрой.
  const [gameOpen, setGameOpen] = useState(false);

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

  // Префетч всех lottie-анимаций при старте → открытие модалок/вкладок берёт их из
  // кэша браузера мгновенно, а не грузит JSON заново.
  useEffect(() => {
    for (const f of ["onb-predict", "onb-calc", "onb-connect", "onb-start", "money", "batman-mask", "gift", "star", "rocket", "gift-bee", "gift-corgi", "gift-capybara"]) {
      fetch(`/lottie/${f}.json`).catch(() => {});
    }
    // Эмодзи-дождь Games: декодируем PNG заранее (Image.decode), чтобы первый заход
    // на вкладку не тормозил на декоде сотен тайлов.
    for (const f of ["pumpkin", "cat"]) {
      const img = new Image();
      img.src = `/emoji/${f}.png`;
      img.decode?.().catch(() => {});
    }
  }, []);

  // Прячем нав, пока в фокусе текстовое поле (клавиатура открыта). focusin/focusout
  // всплывают до document, поэтому ловим любое поле в любом компоненте.
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    const isField = (el: EventTarget | null) =>
      el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
    const setBg = (c: string) => {
      try {
        tg?.setBackgroundColor?.(c);
      } catch {
        /* старый клиент без setBackgroundColor */
      }
    };
    const onIn = (e: FocusEvent) => {
      if (isField(e.target)) {
        setKeyboardOpen(true);
        setBg("#0A0E16"); // под клавиатурой — тёмный, иначе проступает голубой фон
      }
    };
    const onOut = (e: FocusEvent) => {
      if (isField(e.target)) {
        setKeyboardOpen(false);
        setBg("#5CCBFF"); // вернуть голубой (верхний overscroll вкладок)
      }
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

  // Цвет верхней плашки Telegram: на голубых вкладках (Home/Bets/Profile/Games) —
  // голубой (сливается с героем/фоном экрана), на остальных — тёмный фон темы.
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    // Когда открыта полноэкранная игра — плашкой/фоном управляет САМА игра (у каждой
    // свой цвет: Ракета — небо/космос, Кости — #1b2547 под верх градиента). App НЕ
    // вмешивается: иначе перетирал бы их своим тёмным #0A0E16 (баг Костей — плашка
    // уходила в тёмный, т.к. кости красят header один раз на маунте, а этот эффект —
    // позже). Возврат к цвету вкладки делает cleanup самой игры + этот эффект при
    // gameOpen→false.
    if (gameOpen) return;
    const blueTab = tab === "home" || tab === "bets" || tab === "profile";
    // #5CCBFF — верхний цвет голубого героя. Красим И плашку Telegram, И фон
    // viewport (виден при rubber-band overscroll ПОД плашкой — без него там
    // дефолтный чёрный Telegram). Делаем это СТАТИЧНО по вкладке, а НЕ на каждый
    // scroll: setBackgroundColor асинхронный, при резком свайпе он отстаёт и
    // сверху мелькает чёрным. Низ прикрыт нав-баром, поэтому один голубой цвет ок.
    const color = blueTab || tab === "games" ? "#5CCBFF" : "#0A0E16";
    try {
      tg?.setHeaderColor?.(color);
      // Фон viewport — в цвет вкладки (голубой сверху, виден при ВЕРХНЕМ
      // overscroll под плашкой). Снизу под нав-баром голубой прикрыт solid-navy
      // подложкой внутри самого nav (см. ниже), поэтому там голубой не проступает.
      tg?.setBackgroundColor?.(color);
    } catch {
      /* старый клиент без setHeaderColor/setBackgroundColor — некритично */
    }
  }, [tab, showOnboarding, gameOpen]);

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
    const blueTab = tab === "home" || tab === "bets" || tab === "profile" || (tab === "games" && !gameOpen);
    // Games — ПОЛНОСТЬЮ голубой экран (не только герой): и верхняя, и нижняя оттяжка
    // голубые, navy нигде не проступает. Но когда открыта игра (gameOpen) — тёмный.
    const fullBlue = tab === "games" && !gameOpen;
    // Games не скроллится: экран фиксированный (одна карточка + фоновый дождь),
    // прокрутка не нужна. На остальных вкладках возвращаем нативный скролл.
    el.style.overflowY = tab === "games" ? "hidden" : "";
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
      el.style.backgroundColor = fullBlue || (blueTab && el.scrollTop < 56) ? "#5CCBFF" : "#0A0E16";
    };
    apply();
    el.addEventListener("scroll", apply, { passive: true });
    return () => el.removeEventListener("scroll", apply);
  }, [tab, showOnboarding, gameOpen]);

  // Games — экран полностью зафиксирован, никакого скролла/оттяжки. overflow:hidden
  // на main не всегда держит на iOS/Telegram (тянется сам layout-viewport), поэтому
  // режем touchmove non-passive листенером (как scroll-lock в модалках). На Games нет
  // прокручиваемого контента, поэтому глушим любой touchmove целиком.
  useEffect(() => {
    if (tab !== "games" || showOnboarding) return;
    const block = (e: TouchEvent) => {
      // Разрешаем прокрутку внутри опт-ин областей (экран игры «Ракета» скроллится
      // к ленте ставок). Везде ещё на Games глушим touchmove как раньше.
      const el = e.target as HTMLElement | null;
      if (el && el.closest("[data-allow-scroll]")) return;
      e.preventDefault();
    };
    document.addEventListener("touchmove", block, { passive: false });
    return () => document.removeEventListener("touchmove", block);
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
        <div
          style={{
            // Games: ровно высота вьюпорта (без запаса +96px) → нечего скроллить/оттягивать.
            // Остальные вкладки: +96px для двухцветного bounce (см. apply выше).
            minHeight: tab === "games" ? "100%" : "calc(100% + 96px)",
            backgroundColor: tab === "games" && !gameOpen ? "#5CCBFF" : "#0A0E16",
          }}
        >
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
              <div hidden={tab !== "home"}><Home me={me ?? PLACEHOLDER_ME} onReload={reload} /></div>
              <div hidden={tab !== "bets"}><MyBets active={tab === "bets"} /></div>
              <div hidden={tab !== "games"}><Games onGameOpenChange={setGameOpen} /></div>
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
        <div
          className={
            // p-0.5 НЕ в базе: на Games рамка толще (border-[3px] vs 1px). Чтобы кнопки
            // стояли пиксель-в-пиксель как на других вкладках, держим суммарный отступ
            // border+padding одинаковым = 3px. Games: 3px border + 0 padding; остальные:
            // 1px border + 2px padding. Контент-бокс совпадает → меню не «прыгает».
            "relative flex w-full max-w-sm shadow-[0_12px_40px_-10px_rgba(0,0,0,0.8)] " +
            (tab === "games"
              ? // Games — пиксельный Minecraft-блок (трава/земля), резкие края, тёмная
                // кромка; текстуру рисует PixelGround под кнопками (overflow клипует углы).
                "overflow-hidden rounded-2xl border-[3px] border-[#241a10]"
              : // Остальные вкладки — лёгкое стекло с blur.
                "rounded-[34px] border border-white/15 bg-[#11151C]/45 backdrop-blur-2xl p-0.5")
          }
        >
          {tab === "games" && <PixelGround />}
          {/* Скользящая голубая плашка под активной вкладкой: ОДИН общий элемент,
              едет по X к индексу активного таба (transform-transition с лёгким
              пружинным ease) — переключение «перетекает», а не моргает. Ширина =
              1/4 трека (минус p-1.5 по бокам), translateX(index*100%) = свой размер
              на каждый шаг → ровно ложится на кнопку (кнопки flush, gap-0). */}
          <span
            aria-hidden
            className={
              "absolute transition-transform duration-300 ease-[cubic-bezier(0.34,1.4,0.64,1)] " +
              // Инсеты/ширина плашки следуют за padding контейнера (Games: 0, остальные:
              // 2px), чтобы она ложилась ровно на кнопку на любой вкладке.
              (tab === "games"
                ? // блочный «выделенный» квадрат во всю ячейку (padding 0)
                  "inset-y-0 left-0 rounded-md bg-white/20 ring-1 ring-white/25"
                : // голубая плашка с отступом 2px (padding 0.5)
                  "bottom-0.5 left-0.5 top-0.5 rounded-[30px] bg-gradient-to-r from-sky-500/30 to-blue-500/30 shadow-md shadow-sky-500/20")
            }
            style={{
              width: tab === "games" ? "25%" : "calc((100% - 4px) / 4)",
              transform: `translateX(${TABS.findIndex((x) => x.id === tab) * 100}%)`,
            }}
          />
          {TABS.map((item) => {
            const active = tab === item.id;
            const games = tab === "games";
            // На пиксельном блоке: кремово-белые иконки с тёмной «пиксельной» тенью
            // (читаются на траве/земле), активная — тёплый «факельный» жёлтый.
            const color = games
              ? active
                ? "text-amber-200"
                : "text-white/85"
              : active
                ? "text-sky-300"
                : "text-neutral-300";
            const pixelShadow = games ? "[text-shadow:1px_1px_0_rgba(0,0,0,0.7)] drop-shadow-[1px_1px_0_rgba(0,0,0,0.7)]" : "";
            return (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className="relative z-10 flex flex-1 flex-col items-center gap-1 py-1.5"
              >
                <item.Icon
                  className={
                    "h-[22px] w-[22px] transition-all duration-300 " +
                    (active ? "scale-110 " : "scale-100 ") + color + " " + pixelShadow
                  }
                />
                <span
                  className={
                    "text-[10px] font-medium tracking-wide transition-colors duration-300 " +
                    color + " " + pixelShadow
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
