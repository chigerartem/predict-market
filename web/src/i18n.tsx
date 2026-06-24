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
  "nav.trading": "Calculator",
  "nav.community": "Community",
  "nav.profile": "Profile",
  "app.loadError":
    "Loading error: {error}. Open the app from the bot — the request won't go through without Telegram authorization.",

  // ── Общее ──────────────────────────────────────────────────────────────
  "common.close": "Close",
  "common.loading": "Loading…",
  "common.soon": "soon",
  "common.back": "Back",

  // ── Баланс / Пополнение / Вывод ────────────────────────────────────────
  "home.yourBalance": "Your balance",
  "home.deposit": "Deposit",
  "home.withdraw": "Withdraw",
  "home.events": "Events",
  "home.noEvents": "No open events yet",
  "home.search": "Search markets",
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
  "dep.youGet": "You get",
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

  // ── Главная (Home) ─────────────────────────────────────────────────────
  "home.greeting": "Hello,",
  "home.yourCashback": "Your cashback",
  "home.connectToEarn": "Connect an exchange below to start earning cashback",
  "home.statPaidOut": "Paid out",
  "home.statTraders": "Traders",
  "home.statVolume30d": "Volume 30d",
  "home.disconnectConfirm":
    "Disconnect {name}? Your cashback history stays, but new trades won't be counted until you reconnect the exchange.",
  "home.inviteFriends": "Invite friends 🎁",
  "home.inviteSubtitle":
    "Earn a % of your invitees' trading — levels and rewards grow with their volume.",
  "home.myExchanges": "My exchanges",
  "home.addExchange": "Add exchange",
  "home.connectExchange": "Connect exchange",
  "home.connectIntro":
    "Pick an exchange — and cashback from your trading will be credited automatically.",
  "home.vipBadge": "+ VIP on exchange",
  "home.statusActive": "Active",
  "home.statusAwaiting": "Awaiting confirmation",
  "home.statusConnected": "Connected",
  "home.statusPending": "Pending",
  "home.disconnectAria": "Disconnect {name}",
  "home.integrationWip": "Integration in progress",
  "home.pctCashback": "{pct}% cashback",
  "home.connectBtn": "Connect",

  // ── Калькулятор (Trading) ──────────────────────────────────────────────
  "trading.modeFuturesTaker": "Futures (taker)",
  "trading.modeFuturesTakerShort": "Fut. taker",
  "trading.modeFuturesMaker": "Futures (maker)",
  "trading.modeFuturesMakerShort": "Fut. maker",
  "trading.modeSpot": "Spot",
  "trading.yourSavings": "Your savings",
  "trading.perMonth": "per month",
  "trading.perDay": "per day",
  "trading.calcTitle": "Savings calculator",
  "trading.calcSubtitle":
    "Every exchange charges its own fee — calculate how much comes back to you.",
  "trading.exchange": "Exchange",
  "trading.tradeType": "Trade type",
  "trading.leverage": "Leverage",
  "trading.marginPerTrade": "Margin per trade",
  "trading.volumePerTrade": "Volume per trade",
  "trading.tradesPerDay": "Trades per day",
  "trading.comingSoonNote":
    "We'll add {name} soon — this is a preview of what you'll get.",
  "trading.calcA":
    "Position {position} × {fee}% {name} fee = {feePerTrade} per trade. {rate}% back — ",
  "trading.calcB": " to you.",

  // ── Комьюнити (Community) ──────────────────────────────────────────────
  "community.heroTitle": "Referral program",
  "community.heroSubtitle": "Invite traders — earn from their trading volume",
  "community.statInvited": "Invited",
  "community.statVolume": "Invitees' volume",
  "community.level": "Level {n}",
  "community.yourLevel": "Your level",
  "community.howItWorksQ": "How it works?",
  "community.firstInviteA": "Invite your first friend — unlock ",
  "community.levelN": "level {n}",
  "community.firstInviteB": " and claim ",
  "community.firstInviteC":
    " once your invitees' volume reaches {threshold}.",
  "community.toLevel": "To level {n}",
  "community.toFirstLevel": "To the first level",
  "community.volumeOf": "{vol} of {threshold} — invitees' volume",
  "community.maxLevel": "🏆 Max level reached",
  "community.rewardForLevel": "Level {n} reward",
  "community.claimVia": "Claim via @{contact}",
  "community.rewardsTitle": "Rewards for referral volume",
  "community.colVolume": "Referral volume",
  "community.colReward": "Reward",
  "community.yourLink": "Your referral link",
  "community.copied": "✓ Copied",
  "community.copy": "Copy",
  "community.share": "Share",
  "community.shareText":
    "I'm getting cashback for trading on exchanges with KopiX. Join in.",
  "community.howItWorks": "How it works",
  "community.step1": "Send your referral link to anyone who trades on exchanges",
  "community.step2": "They sign up through it and start trading",
  "community.step3":
    "Their trading volume adds up with others and fills your levels",
  "community.step4": "Reach a level — message us and claim your reward",

  // ── Профиль (Profile) ──────────────────────────────────────────────────
  "profile.supportPrefill": "Hello! I need help with cashback.",
  "profile.studioPrefill":
    "Hello! I'm interested in custom development (bot / app).",
  "profile.contactSupport": "Contact support",
  "profile.replyOnTelegram": "We'll reply on Telegram",
  "profile.howCashbackWorks": "How cashback works",
  "profile.theEssentials": "The essentials",
  "profile.terms": "Terms of Service",
  "profile.privacy": "Privacy Policy",
  "profile.language": "Language",
  "profile.studioA": "Made by ",
  "profile.studioB": " studio",
  "profile.studioTagline": "Custom bots and apps on demand —",
  "profile.version": "Version {v} · ID {id}",
  "profile.maskAria": "Take off or put on the mask",

  // FAQ
  "profile.faqQ1": "What is cashback?",
  "profile.faqA1":
    "Part of the fee you pay the exchange for trades comes back to you. Connect an exchange via the link in the app — and cashback is credited automatically.",
  "profile.faqQ2": "When does it arrive?",
  "profile.faqA2":
    "The exchange credits cashback itself as you trade. In the app you see the accumulated amount for each exchange on the home screen.",
  "profile.faqQ3": "How much will I get?",
  "profile.faqA3":
    "It depends on the exchange and your trading volume — the rate is shown for each exchange on the home screen.",
  "profile.faqQ4": "How do I invite friends?",
  "profile.faqA4":
    "On the Community tab — your referral link and rewards for your invitees' trading volume.",

  // Terms
  "profile.termsIntro":
    "KopiX (the “Service”) is a Telegram app that helps you earn cashback (a partial refund of trading fees) from connected crypto exchanges.",
  "profile.termsH1": "1. How it works",
  "profile.termsB1":
    "By connecting an exchange via a link in the Service, you activate a partial fee refund. Cashback is credited by the exchange itself under its own rules; the Service merely displays the accumulated amount.",
  "profile.termsH2": "2. Cashback amount",
  "profile.termsB2":
    "Depends on the exchange and your trading volume. The Service does not guarantee a specific amount and is not responsible for the exchange's crediting decisions.",
  "profile.termsH3": "3. Referral program",
  "profile.termsB3":
    "Rewards by level are provided for the trading volume of users you invite. Payout is manual after contacting support.",
  "profile.termsH4": "4. Risks",
  "profile.termsB4":
    "The Service is not an exchange, broker, or financial advisor and gives no investment advice. Crypto trading carries risk — you act at your own risk.",
  "profile.termsH5": "5. Accounts and keys",
  "profile.termsB5":
    "You connect exchange accounts voluntarily; use read-only keys only. You are responsible for keeping your data safe.",
  "profile.termsH6": "6. Changes",
  "profile.termsB6":
    "These terms may be updated. The current version is always in this section.",

  // Privacy
  "profile.privH1": "1. What data we use",
  "profile.privB1":
    "Telegram profile data (ID, name, username) — for identification; identifiers and read-only data of connected exchange accounts — for crediting cashback.",
  "profile.privH2": "2. Why",
  "profile.privB2":
    "Only to operate the Service: calculating and displaying cashback, the referral program, and support.",
  "profile.privH3": "3. Sharing with third parties",
  "profile.privB3":
    "We do not sell your data. Sharing happens only with exchanges via their API, to the extent needed to credit cashback.",
  "profile.privH4": "4. Retention",
  "profile.privB4": "Data is stored while you use the Service.",
  "profile.privH5": "5. Your rights",
  "profile.privB5":
    "You can request deletion of your data by contacting support.",

  // ── Модалка подключения (ConnectExchangeModal) ─────────────────────────
  "cem.emailError": "Enter a valid email for your {name} account",
  "cem.uidError": "UID must contain only digits (3–32 characters)",
  "cem.connectTitle": "Connect {name}",
  "cem.intro":
    "Sign up on {name} using our referral link — this lets you get back part of the fees on your trades.",
  "cem.vipIntroTitle": "VIP status on Bitunix",
  "cem.vipIntroA":
    "This is a gift not from KopiX but from Bitunix itself: the exchange ",
  "cem.vipIntroBold": "gives VIP for free",
  "cem.vipIntroB":
    " to everyone who signs up via our link — reduced fees and perks, on top of cashback.",
  "cem.openAndSignUp": "Open {name} and sign up",
  "cem.refNotSet": "The referral link isn't set up yet. Please contact support.",
  "cem.iSignedUp": "I signed up via your link →",
  "cem.enterEmail": "Enter the email of your {name} account",
  "cem.enterUid": "Enter your UID on {name}",
  "cem.emailPlaceholder": "e.g. you@example.com",
  "cem.uidPlaceholder": "e.g. 23845129",
  "cem.emailHint": "This is the email you used to sign up on {name} via our link.",
  "cem.uidHint":
    "Copy your UID from your {name} profile (top right) and paste it here.",
  "cem.checking": "Checking…",
  "cem.confirm": "Confirm",
  "cem.connected": "{name} connected",
  "cem.doneNote":
    "Cashback for trades appears on your balance the next day at 05:00 UTC.",
  "cem.vipDoneTitle": "One step left — activate VIP on the exchange",
  "cem.vipDoneA": "VIP status on Bitunix is granted ",
  "cem.vipDoneBold": "manually",
  "cem.vipDoneB":
    ". Message support — we'll activate reduced trading fees and perks on your account.",
  "cem.contactSupport": "Contact support",
  "cem.done": "Done",
  "cem.err503":
    "{name} integration is temporarily unavailable. Try again later or contact support.",
  "cem.err422":
    "{name} didn't confirm the link. Make sure the UID is correct and you signed up via our link.",
  "cem.errGeneric": "Error {status}",

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
  "nav.trading": "Калькулятор",
  "nav.community": "Комьюнити",
  "nav.profile": "Профиль",
  "app.loadError":
    "Ошибка загрузки: {error}. Откройте приложение из бота — без авторизации Telegram запрос не пройдёт.",

  // ── Общее ──────────────────────────────────────────────────────────────
  "common.close": "Закрыть",
  "common.loading": "Загрузка…",
  "common.soon": "скоро",
  "common.back": "Назад",

  // ── Баланс / Пополнение / Вывод ────────────────────────────────────────
  "home.yourBalance": "Ваш баланс",
  "home.deposit": "Пополнить",
  "home.withdraw": "Вывести",
  "home.events": "События",
  "home.noEvents": "Пока нет открытых событий",
  "home.search": "Поиск рынков",
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
  "dep.youGet": "Получите",
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

  // ── Главная (Home) ─────────────────────────────────────────────────────
  "home.greeting": "Здравствуйте,",
  "home.yourCashback": "Ваш кешбэк",
  "home.connectToEarn": "Подключите биржу ниже, чтобы получать кешбэк",
  "home.statPaidOut": "Начислено",
  "home.statTraders": "Трейдеров",
  "home.statVolume30d": "Объём 30д",
  "home.disconnectConfirm":
    "Отключить {name}? Кешбэк по ней останется в истории, но новые сделки учитываться не будут, пока биржа не будет подключена снова.",
  "home.inviteFriends": "Приглашайте друзей 🎁",
  "home.inviteSubtitle":
    "Получайте % с торговли приглашённых — уровни и награды растут с их объёмом.",
  "home.myExchanges": "Мои биржи",
  "home.addExchange": "Добавить биржу",
  "home.connectExchange": "Подключить биржу",
  "home.connectIntro":
    "Выберите биржу — и кешбэк с вашей торговли будет начисляться автоматически.",
  "home.vipBadge": "+ VIP на бирже",
  "home.statusActive": "Активна",
  "home.statusAwaiting": "Ожидает подтверждения",
  "home.statusConnected": "Подключена",
  "home.statusPending": "Ожидает",
  "home.disconnectAria": "Отключить {name}",
  "home.integrationWip": "Интеграция в разработке",
  "home.pctCashback": "{pct}% кешбэк",
  "home.connectBtn": "Подключить",

  // ── Калькулятор (Trading) ──────────────────────────────────────────────
  "trading.modeFuturesTaker": "Фьючерсы (taker)",
  "trading.modeFuturesTakerShort": "Фьюч. taker",
  "trading.modeFuturesMaker": "Фьючерсы (maker)",
  "trading.modeFuturesMakerShort": "Фьюч. maker",
  "trading.modeSpot": "Спот",
  "trading.yourSavings": "Ваша экономия",
  "trading.perMonth": "в месяц",
  "trading.perDay": "в день",
  "trading.calcTitle": "Калькулятор экономии",
  "trading.calcSubtitle":
    "Каждая биржа берёт свою комиссию — посчитайте, сколько вернётся именно у вас.",
  "trading.exchange": "Биржа",
  "trading.tradeType": "Тип сделки",
  "trading.leverage": "Плечо",
  "trading.marginPerTrade": "Маржа одной сделки",
  "trading.volumePerTrade": "Объём одной сделки",
  "trading.tradesPerDay": "Сделок в день",
  "trading.comingSoonNote":
    "{name} подключим в ближайшее время — это превью того, что вы получите.",
  "trading.calcA":
    "Позиция {position} × {fee}% комиссии {name} = {feePerTrade} за сделку. Возврат {rate}% — ",
  "trading.calcB": " вам.",

  // ── Комьюнити (Community) ──────────────────────────────────────────────
  "community.heroTitle": "Реферальная программа",
  "community.heroSubtitle":
    "Приглашайте трейдеров — зарабатывайте на их торговом объёме",
  "community.statInvited": "Приглашено",
  "community.statVolume": "Объём приглашённых",
  "community.level": "Уровень {n}",
  "community.yourLevel": "Ваш уровень",
  "community.howItWorksQ": "Как это работает?",
  "community.firstInviteA": "Пригласите первого друга — откройте ",
  "community.levelN": "уровень {n}",
  "community.firstInviteB": " и заберите ",
  "community.firstInviteC":
    ", когда оборот приглашённых достигнет {threshold}.",
  "community.toLevel": "До уровня {n}",
  "community.toFirstLevel": "До первого уровня",
  "community.volumeOf": "{vol} из {threshold} — объём приглашённых",
  "community.maxLevel": "🏆 Максимальный уровень достигнут",
  "community.rewardForLevel": "Награда за уровень {n}",
  "community.claimVia": "Забрать через @{contact}",
  "community.rewardsTitle": "Награды за объём рефералов",
  "community.colVolume": "Оборот рефералов",
  "community.colReward": "Награда",
  "community.yourLink": "Ваша реферальная ссылка",
  "community.copied": "✓ Скопировано",
  "community.copy": "Копировать",
  "community.share": "Поделиться",
  "community.shareText":
    "Получаю кешбэк за торговлю на биржах через KopiX. Подключайтесь.",
  "community.howItWorks": "Как это работает",
  "community.step1":
    "Отправляете свою реферальную ссылку любому, кто торгует на биржах",
  "community.step2": "Он регистрируется по ней и начинает торговать",
  "community.step3":
    "Его торговый объём суммируется с другими и заполняет ваши уровни",
  "community.step4": "Достигаете уровня — пишете нам и забираете награду",

  // ── Профиль (Profile) ──────────────────────────────────────────────────
  "profile.supportPrefill": "Здравствуйте! Нужна помощь по кэшбэку.",
  "profile.studioPrefill":
    "Здравствуйте! Интересует разработка под заказ (бот / приложение).",
  "profile.contactSupport": "Написать в поддержку",
  "profile.replyOnTelegram": "Ответим в Telegram",
  "profile.howCashbackWorks": "Как работает кэшбэк",
  "profile.theEssentials": "Коротко о главном",
  "profile.terms": "Условия использования",
  "profile.privacy": "Политика конфиденциальности",
  "profile.language": "Язык",
  "profile.studioA": "Сделано в студии ",
  "profile.studioB": "",
  "profile.studioTagline": "Разработка ботов и приложений на заказ —",
  "profile.version": "Версия {v} · ID {id}",
  "profile.maskAria": "Снять или надеть маску",

  // FAQ
  "profile.faqQ1": "Что такое кэшбэк?",
  "profile.faqA1":
    "Часть комиссии, которую вы платите бирже за сделки, возвращается вам. Подключаете биржу по ссылке из приложения — и кэшбэк начисляется автоматически.",
  "profile.faqQ2": "Когда он приходит?",
  "profile.faqA2":
    "Биржа начисляет кэшбэк сама, по мере вашей торговли. В приложении вы видите накопленную сумму по каждой бирже на главном экране.",
  "profile.faqQ3": "Сколько я получу?",
  "profile.faqA3":
    "Зависит от биржи и объёма вашей торговли — ставка показана у каждой биржи на главном экране.",
  "profile.faqQ4": "Как звать друзей?",
  "profile.faqA4":
    "На вкладке «Комьюнити» — ваша реферальная ссылка и награды за торговый объём приглашённых.",

  // Terms
  "profile.termsIntro":
    "KopiX (далее — «Сервис») — это Telegram-приложение, которое помогает получать кэшбэк (возврат части торговой комиссии) с подключённых криптобирж.",
  "profile.termsH1": "1. Как это работает",
  "profile.termsB1":
    "Подключая биржу по ссылке из Сервиса, вы активируете возврат части комиссии. Кэшбэк начисляет сама биржа по своим правилам; Сервис лишь показывает накопленную сумму.",
  "profile.termsH2": "2. Размер кэшбэка",
  "profile.termsB2":
    "Зависит от биржи и объёма вашей торговли. Сервис не гарантирует конкретную сумму и не отвечает за решения биржи по начислению.",
  "profile.termsH3": "3. Реферальная программа",
  "profile.termsB3":
    "За торговый объём приглашённых вами пользователей предусмотрены награды по уровням. Выплата — вручную после обращения в поддержку.",
  "profile.termsH4": "4. Риски",
  "profile.termsB4":
    "Сервис не является биржей, брокером или финансовым советником и не даёт инвестиционных рекомендаций. Торговля криптовалютой сопряжена с риском — вы действуете на свой страх и риск.",
  "profile.termsH5": "5. Аккаунты и ключи",
  "profile.termsB5":
    "Биржевые аккаунты вы подключаете добровольно; используйте ключи только с правами на чтение. Вы отвечаете за сохранность своих данных.",
  "profile.termsH6": "6. Изменения",
  "profile.termsB6":
    "Условия могут обновляться. Актуальная версия всегда в этом разделе.",

  // Privacy
  "profile.privH1": "1. Какие данные мы используем",
  "profile.privB1":
    "Данные Telegram-профиля (ID, имя, username) — для идентификации; идентификаторы и read-only данные подключённых биржевых аккаунтов — для начисления кэшбэка.",
  "profile.privH2": "2. Зачем",
  "profile.privB2":
    "Только для работы Сервиса: расчёт и показ кэшбэка, реферальная программа и поддержка.",
  "profile.privH3": "3. Передача третьим лицам",
  "profile.privB3":
    "Мы не продаём ваши данные. Обмен возможен только с биржами через их API в объёме, необходимом для начисления кэшбэка.",
  "profile.privH4": "4. Хранение",
  "profile.privB4": "Данные хранятся, пока вы пользуетесь Сервисом.",
  "profile.privH5": "5. Ваши права",
  "profile.privB5":
    "Вы можете запросить удаление своих данных, написав в поддержку.",

  // ── Модалка подключения (ConnectExchangeModal) ─────────────────────────
  "cem.emailError": "Введите корректный email вашего аккаунта {name}",
  "cem.uidError": "UID должен состоять только из цифр (3–32 символа)",
  "cem.connectTitle": "Подключить {name}",
  "cem.intro":
    "Зарегистрируйтесь на {name} по нашей реферальной ссылке — это позволит возвращать вам часть комиссий с ваших сделок.",
  "cem.vipIntroTitle": "VIP-статус на бирже Bitunix",
  "cem.vipIntroA": "Это подарок не от KopiX, а от самой Bitunix: биржа ",
  "cem.vipIntroBold": "бесплатно даёт VIP",
  "cem.vipIntroB":
    " всем, кто зарегистрировался по нашей ссылке — сниженные комиссии и привилегии, сверх кешбэка.",
  "cem.openAndSignUp": "Открыть {name} и зарегистрироваться",
  "cem.refNotSet":
    "Реферальная ссылка пока не настроена. Свяжитесь с поддержкой.",
  "cem.iSignedUp": "Я зарегистрировался по вашей ссылке →",
  "cem.enterEmail": "Укажите email вашего аккаунта {name}",
  "cem.enterUid": "Укажите ваш UID на {name}",
  "cem.emailPlaceholder": "напр. you@example.com",
  "cem.uidPlaceholder": "напр. 23845129",
  "cem.emailHint":
    "Это email, которым вы регистрировались на {name} по нашей ссылке.",
  "cem.uidHint":
    "Скопируйте свой UID в профиле {name} (справа вверху) и вставьте в поле.",
  "cem.checking": "Проверяем…",
  "cem.confirm": "Подтвердить",
  "cem.connected": "{name} подключён",
  "cem.doneNote":
    "Кешбэк за сделки появляется на балансе на следующий день в 05:00 UTC.",
  "cem.vipDoneTitle": "Остался шаг — активируйте VIP на бирже",
  "cem.vipDoneA": "VIP-статус на Bitunix присваивается ",
  "cem.vipDoneBold": "вручную",
  "cem.vipDoneB":
    ". Напишите в поддержку — мы активируем сниженные торговые комиссии и привилегии на вашем аккаунте.",
  "cem.contactSupport": "Написать в поддержку",
  "cem.done": "Готово",
  "cem.err503":
    "{name}-интеграция временно недоступна. Попробуйте позже или напишите в поддержку.",
  "cem.err422":
    "{name} не подтвердил привязку. Убедитесь, что UID указан верно и регистрация прошла по нашей ссылке.",
  "cem.errGeneric": "Ошибка {status}",

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
