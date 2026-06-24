import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// ── Лёгкий собственный i18n (без зависимостей) ───────────────────────────────
// Английский — язык по умолчанию по всему Mini App; пользователь может переключить
// на русский в профиле. Выбор хранится в localStorage (клиентский источник правды,
// бэкенд не участвует). Ключи плоские, с namespace через точку: t("home.greeting").
// Интерполяция через {placeholder}: t("home.disconnectConfirm", { name }).
//
// Парность словарей EN/RU гарантируется типами: ru объявлен как Record<Key, string>,
// где Key = ключи en, поэтому пропуск/опечатка ключа = ошибка компиляции.

export type Lang = "en" | "ru";

const LS_KEY = "kopix_lang_v1";

// Английский по умолчанию. Telegram language_code НЕ используем намеренно —
// дефолт всегда EN, пока пользователь явно не выберет русский в профиле.
function initialLang(): Lang {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v === "en" || v === "ru") return v;
  } catch {
    /* localStorage недоступен — дефолт EN */
  }
  return "en";
}

const en = {
  // ── Навигация (App) ────────────────────────────────────────────────────
  "nav.home": "Home",
  "nav.bets": "Bets",
  "nav.community": "Community",
  "nav.profile": "Profile",

  "bets.title": "My bets",
  "bets.empty": "No bets yet",
  "bets.emptyHint": "Pick an event on the home screen",
  "bets.statusPlaced": "Active",
  "bets.statusWon": "Won",
  "bets.statusLost": "Lost",
  "bets.statusVoid": "Refunded",
  "bets.stake": "Stake",
  "bets.toWin": "To win",
  "app.loadError":
    "Loading error: {error}. Open the app from the bot — the request won't go through without Telegram authorization.",

  // ── Общее ──────────────────────────────────────────────────────────────
  "common.close": "Close",
  "common.back": "Back",

  // ── Баланс / Пополнение / Вывод ────────────────────────────────────────
  "home.yourBalance": "Your balance",
  "home.deposit": "Deposit",
  "home.withdraw": "Withdraw",
  "home.noEvents": "No open events yet",
  "home.search": "Find an event",
  "home.noResults": "Nothing found",

  "dep.title": "Top up balance",
  "dep.subtitle": "Choose how to deposit",
  "dep.gifts": "Telegram Gifts",
  "dep.giftsDesc": "Send a gift to the bot — we value it and credit TON",
  "dep.ton": "TON",
  "dep.tonDesc": "Top up from any TON wallet",
  "dep.stars": "Telegram Stars",
  "dep.starsDesc": "Pay with Stars",
  "dep.gettingReady": "We're finishing this method — it goes live soon.",
  "dep.starsAmount": "Amount in Stars",
  "dep.pay": "Pay",
  "dep.processing": "Creating invoice…",
  "dep.payError": "Couldn't create the invoice. Try again.",
  "dep.minStars": "Minimum 50 ⭐",

  "wd.title": "Withdraw",
  "wd.available": "Available",
  "wd.amount": "Amount",
  "wd.max": "Max",
  "wd.address": "TON wallet address",
  "wd.addressPlaceholder": "Paste your TON address",
  "wd.submit": "Withdraw",
  "wd.soon": "Withdrawals open soon — this is a preview.",

  // ── Ставка (Bet) ───────────────────────────────────────────────────────
  "bet.title": "Place a bet",
  "bet.amount": "Stake",
  "bet.payout": "Payout if you win",
  "bet.available": "Available",
  "bet.place": "Place bet",
  "bet.min": "Minimum 0.1 TON",
  "bet.insufficient": "Not enough balance — top up first",
  "bet.placing": "Placing…",
  "bet.success": "Bet placed!",
  "bet.error": "Couldn't place the bet",

  // ── Главная (Home) ─────────────────────────────────────────────────────


  // ── Комьюнити (Community) ──────────────────────────────────────────────
  "community.heroTitle": "Referral program",
  "community.heroSubtitle": "Invite traders — earn from their trading volume",

  // ── Профиль (Profile) ──────────────────────────────────────────────────
  "profile.maskAria": "Take off or put on the mask",





  // ── Онбординг (Onboarding) ─────────────────────────────────────────────
  "onb.slide1Title": "Get back part of your trading fees",
  "onb.slide1Text": "Earn cashback on your crypto exchange trades.",
  "onb.slide2Title": "Up to 32% cashback",
  "onb.slide2Text": "Calculate in advance how much you can get back.",
  "onb.slide3Title": "Connect in a minute",
  "onb.slide3Text": "Pick an exchange, sign up via the link, and enter your UID.",
  "onb.slide4Title": "Start earning cashback",
  "onb.slide4Text": "Bitget, MEXC, Bitunix, BYDFi, and BingX are supported.",
  "onb.skip": "Skip",
  "onb.start": "Get started",
  "onb.next": "Next",
} as const;

export type TKey = keyof typeof en;

const ru: Record<TKey, string> = {
  // ── Навигация (App) ────────────────────────────────────────────────────
  "nav.home": "Главная",
  "nav.bets": "Ставки",
  "nav.community": "Комьюнити",
  "nav.profile": "Профиль",

  "bets.title": "Мои ставки",
  "bets.empty": "Ставок пока нет",
  "bets.emptyHint": "Выберите событие на главной",
  "bets.statusPlaced": "Активна",
  "bets.statusWon": "Выиграла",
  "bets.statusLost": "Проиграла",
  "bets.statusVoid": "Возврат",
  "bets.stake": "Ставка",
  "bets.toWin": "Выплата",
  "app.loadError":
    "Ошибка загрузки: {error}. Откройте приложение из бота — без авторизации Telegram запрос не пройдёт.",

  // ── Общее ──────────────────────────────────────────────────────────────
  "common.close": "Закрыть",
  "common.back": "Назад",

  // ── Баланс / Пополнение / Вывод ────────────────────────────────────────
  "home.yourBalance": "Ваш баланс",
  "home.deposit": "Пополнить",
  "home.withdraw": "Вывести",
  "home.noEvents": "Пока нет открытых событий",
  "home.search": "Найти событие",
  "home.noResults": "Ничего не найдено",

  "dep.title": "Пополнить баланс",
  "dep.subtitle": "Выберите способ пополнения",
  "dep.gifts": "Telegram-подарки",
  "dep.giftsDesc": "Отправьте подарок боту — оценим и зачислим TON",
  "dep.ton": "TON",
  "dep.tonDesc": "Пополнить с любого TON-кошелька",
  "dep.stars": "Telegram Stars",
  "dep.starsDesc": "Оплатить звёздами",
  "dep.gettingReady": "Дорабатываем этот способ — скоро включим.",
  "dep.starsAmount": "Сумма в звёздах",
  "dep.pay": "Оплатить",
  "dep.processing": "Создаём счёт…",
  "dep.payError": "Не удалось создать счёт. Попробуйте ещё раз.",
  "dep.minStars": "Минимум 50 ⭐",

  "wd.title": "Вывести",
  "wd.available": "Доступно",
  "wd.amount": "Сумма",
  "wd.max": "Макс",
  "wd.address": "Адрес TON-кошелька",
  "wd.addressPlaceholder": "Вставьте ваш TON-адрес",
  "wd.submit": "Вывести",
  "wd.soon": "Вывод откроется скоро — это превью.",

  // ── Ставка (Bet) ───────────────────────────────────────────────────────
  "bet.title": "Сделать ставку",
  "bet.amount": "Сумма ставки",
  "bet.payout": "Выплата при выигрыше",
  "bet.available": "Доступно",
  "bet.place": "Поставить",
  "bet.min": "Минимум 0.1 TON",
  "bet.insufficient": "Недостаточно средств — пополните баланс",
  "bet.placing": "Ставим…",
  "bet.success": "Ставка принята!",
  "bet.error": "Не удалось поставить ставку",

  // ── Главная (Home) ─────────────────────────────────────────────────────


  // ── Комьюнити (Community) ──────────────────────────────────────────────
  "community.heroTitle": "Реферальная программа",
  "community.heroSubtitle":
    "Приглашайте трейдеров — зарабатывайте на их торговом объёме",

  // ── Профиль (Profile) ──────────────────────────────────────────────────
  "profile.maskAria": "Снять или надеть маску",





  // ── Онбординг (Onboarding) ─────────────────────────────────────────────
  "onb.slide1Title": "Возвращайте часть торговых комиссий",
  "onb.slide1Text": "Получайте кэшбэк за сделки на криптобиржах.",
  "onb.slide2Title": "До 32% кэшбэка",
  "onb.slide2Text":
    "Посчитайте заранее, сколько сможете вернуть с помощью калькулятора.",
  "onb.slide3Title": "Подключение за минуту",
  "onb.slide3Text": "Выберите биржу, зарегистрируйтесь по ссылке и укажите UID.",
  "onb.slide4Title": "Начните получать кэшбэк",
  "onb.slide4Text": "Поддерживаются Bitget, MEXC, Bitunix, BYDFi и BingX.",
  "onb.skip": "Пропустить",
  "onb.start": "Начать",
  "onb.next": "Далее",
};

const DICTS: Record<Lang, Record<TKey, string>> = { en, ru };

export type Vars = Record<string, string | number>;
export type TFunc = (key: TKey, vars?: Vars) => string;

function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k: string) =>
    k in vars ? String(vars[k]) : `{${k}}`,
  );
}

type I18nValue = { lang: Lang; setLang: (l: Lang) => void; t: TFunc };

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(LS_KEY, l);
    } catch {
      /* localStorage недоступен — выбор продержится в рамках сессии */
    }
  }, []);

  const value = useMemo<I18nValue>(() => {
    const dict = DICTS[lang];
    const t: TFunc = (key, vars) =>
      interpolate(dict[key] ?? DICTS.en[key] ?? key, vars);
    return { lang, setLang, t };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

/** Хук перевода: const t = useT(); t("home.greeting"). */
export function useT(): TFunc {
  return useI18n().t;
}

/** Текущий язык и сеттер — для переключателя в профиле. */
export function useLang(): [Lang, (l: Lang) => void] {
  const { lang, setLang } = useI18n();
  return [lang, setLang];
}
