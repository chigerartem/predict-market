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
  "nav.games": "Games",
  "nav.profile": "Profile",

  "bets.title": "My bets",
  "bets.statActive": "Active",
  "bets.statInPlay": "In play",
  "bets.statPnl": "Profit",
  "bets.empty": "No bets yet",
  "bets.emptyHint": "Pick an event on the home screen",
  "bets.statusPlaced": "Active",
  "bets.statusWon": "Won",
  "bets.statusLost": "Lost",
  "bets.statusVoid": "Refunded",
  "bets.stake": "Stake",
  "bets.toWin": "To win",
  "bets.detailTitle": "Bet",
  "bets.profit": "Profit",
  "bets.placedAt": "Placed",
  "bets.starts": "Starts",
  "bets.closes": "Closes",
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
  "dep.tonAmount": "Amount in TON",
  "dep.tonMin": "Minimum 0.1 TON",
  "dep.tonUnavailable": "TON deposit is unavailable right now",
  "dep.tonConnect": "Connect wallet",
  "dep.tonWallet": "Wallet",
  "dep.tonSwitchWallet": "Change wallet",
  "dep.tonPay": "Pay",
  "dep.tonConfirm": "Confirm in your wallet…",
  "dep.tonRejected": "Transaction cancelled.",
  "dep.tonSendError": "Couldn’t send the transaction. Try again.",
  "dep.tonWaiting": "Waiting for the transfer… your balance will update automatically.",

  "wd.title": "Withdraw",
  "wd.subtitle": "Choose how to withdraw",
  "wd.methTon": "TON",
  "wd.methTonDesc": "Send to any TON wallet",
  "wd.methGifts": "Telegram Gift",
  "wd.methGiftsDesc": "Swap your TON for a gift you pick",
  "wd.comingSoon": "We're finishing this method — it goes live soon.",
  "wd.available": "Available",
  "wd.amount": "Amount",
  "wd.max": "Max",
  "wd.address": "TON wallet address",
  "wd.addressPlaceholder": "Paste your TON address",
  "wd.submit": "Withdraw",
  "wd.submitting": "Sending…",
  "wd.min": "Minimum {min} TON",
  "wd.fee": "Network fee",
  "wd.receive": "You'll receive",
  "wd.success": "Done! The payout is on its way — your balance is updated.",
  "wd.unavailable": "Withdrawals are unavailable right now.",

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
  "bet.resolves": "How it resolves",
  "bet.preview": "Match preview",
  "bet.more": "More",
  "bet.less": "Less",

  // ── Главная (Home) ─────────────────────────────────────────────────────


  // ── Игры (Games) ───────────────────────────────────────────────────────
  "games.title": "Games",
  "games.subtitle": "Quick games on your TON balance",
  "games.rocketTitle": "Rocket",
  "games.rocketDesc": "Cash out before it crashes",
  "games.diceTitle": "Dice",
  "games.diceDesc": "Roll two dice, beat the odds",
  "games.caseTitle": "Cases",
  "games.caseDesc": "Open a case, win up to 200×",
  "games.basketTitle": "Basketball",
  "games.basketDesc": "Shoot, hit the basket, win",
  "games.comingSoon": "Coming soon",
  "rocket.close": "Back",
  "rocket.starting": "Starts in",
  "rocket.waiting": "Waiting for round",
  "rocket.flyingAway": "Flew away!",
  "rocket.place": "Place bet",
  "rocket.placing": "Placing…",
  "rocket.placed": "In the round",
  "rocket.cashout": "Cash out",
  "rocket.cashedOut": "Cashed out {m}",
  "rocket.youWon": "You won {amount} TON",
  "rocket.youLost": "Crashed — bet lost",
  "rocket.amount": "Bet amount",
  "rocket.min": "Min 0.1 TON",
  "rocket.insufficient": "Not enough TON",
  "rocket.balance": "Balance",
  "rocket.history": "Last rounds",
  "rocket.liveBets": "Live bets",
  "rocket.fair": "Provably fair",
  "rocket.waitNext": "Wait for the next round",
  "dice.history": "Last rolls",
  "dice.noRolls": "No rolls yet",
  "dice.tapToRoll": "Pick a bet and roll",
  "dice.rolling": "Rolling…",
  "dice.roll": "Roll",
  "dice.low": "Under 7",
  "dice.high": "Over 7",
  "dice.seven": "Exactly 7",
  "dice.exactSum": "Exact sum",
  "dice.chance": "Chance",
  "dice.min": "Min 0.1 TON",
  "dice.insufficient": "Not enough TON",
  "dice.noLuck": "No luck — try again",
  "dice.fair": "Provably fair",
  "dice.auto": "Auto-roll",
  "dice.stop": "Stop auto-roll",
  "case.open": "Spin",
  "case.opening": "Spinning…",
  "case.history": "Last drops",
  "case.noSpins": "No drops yet",
  "case.min": "Min {n} TON",
  "case.insufficient": "Not enough TON",
  "case.contents": "What's inside",
  "case.empty": "Empty — try again",
  "case.youWon": "You won",
  "case.tapToOpen": "Set a stake and spin",
  "case.fair": "Provably fair",
  "basket.history": "Last shots",
  "basket.noThrows": "No shots yet",
  "basket.throw": "Shoot",
  "basket.throwing": "Shooting…",
  "basket.chance": "Chance",
  "basket.score": "Score!",
  "basket.miss": "Missed — try again",
  "basket.min": "Min {n} TON",
  "basket.insufficient": "Not enough TON",
  "basket.tapToThrow": "Set a stake and shoot",
  "basket.fair": "Provably fair",
  "basket.auto": "Auto-shoot",
  "basket.stop": "Stop auto-shoot",

  // ── Профиль (Profile) ──────────────────────────────────────────────────
  "profile.maskAria": "Take off or put on the mask",





  // ── Онбординг (Onboarding) ─────────────────────────────────────────────
  "onb.slide1Title": "Predict real-world events",
  "onb.slide1Text": "Sports, crypto, politics — bet on the outcome and win.",
  "onb.slide2Title": "Pick a side, win if you're right",
  "onb.slide2Text": "Choose Yes or No. Correct predictions pay out in TON.",
  "onb.slide3Title": "Top up in seconds",
  "onb.slide3Text": "Deposit with Telegram Gifts, TON, or Stars.",
  "onb.slide4Title": "Cash out anytime",
  "onb.slide4Text": "Withdraw your winnings straight to your TON wallet.",
  "onb.skip": "Skip",
  "onb.start": "Get started",
  "onb.next": "Next",
} as const;

export type TKey = keyof typeof en;

const ru: Record<TKey, string> = {
  // ── Навигация (App) ────────────────────────────────────────────────────
  "nav.home": "Главная",
  "nav.bets": "Ставки",
  "nav.games": "Игры",
  "nav.profile": "Профиль",

  "bets.title": "Мои ставки",
  "bets.statActive": "Активные",
  "bets.statInPlay": "В игре",
  "bets.statPnl": "Прибыль",
  "bets.empty": "Ставок пока нет",
  "bets.emptyHint": "Выберите событие на главной",
  "bets.statusPlaced": "Активна",
  "bets.statusWon": "Выиграла",
  "bets.statusLost": "Проиграла",
  "bets.statusVoid": "Возврат",
  "bets.stake": "Ставка",
  "bets.toWin": "Выплата",
  "bets.detailTitle": "Ставка",
  "bets.profit": "Прибыль",
  "bets.placedAt": "Поставлено",
  "bets.starts": "Начало",
  "bets.closes": "Закрытие",
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
  "dep.tonAmount": "Сумма в TON",
  "dep.tonMin": "Минимум 0.1 TON",
  "dep.tonUnavailable": "Пополнение TON сейчас недоступно",
  "dep.tonConnect": "Подключить кошелёк",
  "dep.tonWallet": "Кошелёк",
  "dep.tonSwitchWallet": "Сменить кошелёк",
  "dep.tonPay": "Оплатить",
  "dep.tonConfirm": "Подтвердите в кошельке…",
  "dep.tonRejected": "Транзакция отменена.",
  "dep.tonSendError": "Не удалось отправить транзакцию. Попробуйте снова.",
  "dep.tonWaiting": "Ждём перевод… баланс пополнится автоматически.",

  "wd.title": "Вывести",
  "wd.subtitle": "Выберите способ вывода",
  "wd.methTon": "TON",
  "wd.methTonDesc": "На любой TON-кошелёк",
  "wd.methGifts": "Подарок Telegram",
  "wd.methGiftsDesc": "Обменяйте TON на выбранный подарок",
  "wd.comingSoon": "Дорабатываем этот способ — скоро включим.",
  "wd.available": "Доступно",
  "wd.amount": "Сумма",
  "wd.max": "Макс",
  "wd.address": "Адрес TON-кошелька",
  "wd.addressPlaceholder": "Вставьте ваш TON-адрес",
  "wd.submit": "Вывести",
  "wd.submitting": "Отправляем…",
  "wd.min": "Минимум {min} TON",
  "wd.fee": "Комиссия сети",
  "wd.receive": "К получению",
  "wd.success": "Готово! Выплата в пути — баланс обновлён.",
  "wd.unavailable": "Вывод сейчас недоступен.",

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
  "bet.resolves": "Как определяется исход",
  "bet.preview": "Превью матча",
  "bet.more": "Ещё",
  "bet.less": "Свернуть",

  // ── Главная (Home) ─────────────────────────────────────────────────────


  // ── Игры (Games) ───────────────────────────────────────────────────────
  "games.title": "Игры",
  "games.subtitle": "Быстрые игры на ваш баланс TON",
  "games.rocketTitle": "Ракета",
  "games.rocketDesc": "Успей забрать до взрыва",
  "games.diceTitle": "Кости",
  "games.diceDesc": "Брось два кубика, угадай сумму",
  "games.caseTitle": "Кейсы",
  "games.caseDesc": "Открой кейс, выиграй до 200×",
  "games.basketTitle": "Баскетбол",
  "games.basketDesc": "Бросай, попадай в корзину, выигрывай",
  "games.comingSoon": "Скоро",
  "rocket.close": "Назад",
  "rocket.starting": "Старт через",
  "rocket.waiting": "Ждём раунд",
  "rocket.flyingAway": "Улетела!",
  "rocket.place": "Поставить",
  "rocket.placing": "Ставим…",
  "rocket.placed": "В раунде",
  "rocket.cashout": "Забрать",
  "rocket.cashedOut": "Забрал {m}",
  "rocket.youWon": "Выигрыш {amount} TON",
  "rocket.youLost": "Взрыв — ставка сгорела",
  "rocket.amount": "Сумма ставки",
  "rocket.min": "Минимум 0.1 TON",
  "rocket.insufficient": "Недостаточно TON",
  "rocket.balance": "Баланс",
  "rocket.history": "Последние раунды",
  "rocket.liveBets": "Ставки",
  "rocket.fair": "Честная игра",
  "rocket.waitNext": "Дождись следующего раунда",
  "dice.history": "Последние броски",
  "dice.noRolls": "Бросков ещё нет",
  "dice.tapToRoll": "Выбери ставку и брось",
  "dice.rolling": "Бросаем…",
  "dice.roll": "Бросить",
  "dice.low": "Меньше 7",
  "dice.high": "Больше 7",
  "dice.seven": "Ровно 7",
  "dice.exactSum": "Точная сумма",
  "dice.chance": "Шанс",
  "dice.min": "Минимум 0.1 TON",
  "dice.insufficient": "Недостаточно TON",
  "dice.noLuck": "Не повезло — ещё раз",
  "dice.fair": "Честная игра",
  "dice.auto": "Авто-броски",
  "dice.stop": "Остановить",
  "case.open": "Крутить",
  "case.opening": "Крутим…",
  "case.history": "Последние дропы",
  "case.noSpins": "Дропов ещё нет",
  "case.min": "Минимум {n} TON",
  "case.insufficient": "Недостаточно TON",
  "case.contents": "Что внутри",
  "case.empty": "Пусто — ещё раз",
  "case.youWon": "Твой дроп",
  "case.tapToOpen": "Поставь и крути",
  "case.fair": "Честная игра",
  "basket.history": "Последние броски",
  "basket.noThrows": "Бросков ещё нет",
  "basket.throw": "Бросить",
  "basket.throwing": "Бросаем…",
  "basket.chance": "Шанс",
  "basket.score": "Попал!",
  "basket.miss": "Мимо — ещё раз",
  "basket.min": "Минимум {n} TON",
  "basket.insufficient": "Недостаточно TON",
  "basket.tapToThrow": "Поставь и бросай",
  "basket.fair": "Честная игра",
  "basket.auto": "Авто-броски",
  "basket.stop": "Остановить",

  // ── Профиль (Profile) ──────────────────────────────────────────────────
  "profile.maskAria": "Снять или надеть маску",





  // ── Онбординг (Onboarding) ─────────────────────────────────────────────
  "onb.slide1Title": "Предсказывайте реальные события",
  "onb.slide1Text": "Спорт, крипта, политика — ставьте на исход и выигрывайте.",
  "onb.slide2Title": "Выберите сторону — угадали, выиграли",
  "onb.slide2Text": "Да или Нет. Верный прогноз выплачивается в TON.",
  "onb.slide3Title": "Пополнение за секунды",
  "onb.slide3Text": "Депозит подарками Telegram, через TON или звёздами.",
  "onb.slide4Title": "Выводите в любой момент",
  "onb.slide4Text": "Забирайте выигрыш прямо на свой TON-кошелёк.",
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
