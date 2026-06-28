// ── Лёгкий собственный i18n (EN-only, без зависимостей) ──────────────────────
// Язык приложения — только английский (локализации и переключателя нет намеренно).
// Ключи плоские, с namespace через точку: t("bet.title"). Интерполяция через
// {placeholder}: t("wd.min", { min }). useT() возвращает статическую функцию перевода
// (без контекста/провайдера — словарь один, ре-рендерить на смену языка нечего).

const dict = {
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
  "home.alreadyBet": "Bet placed",

  "dep.title": "Top up balance",
  "dep.subtitle": "Choose how to deposit",
  "dep.ton": "TON",
  "dep.tonDesc": "Top up from any TON wallet",
  "dep.stars": "Telegram Stars",
  "dep.starsDesc": "Pay with Stars",
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
  "wd.methStars": "Telegram Stars",
  "wd.methStarsDesc": "Manual payout — message the admin",
  "wd.starsTitle": "Withdraw in Stars",
  "wd.starsText": "Stars payouts are handled manually. Tap below to message us — we'll send your Stars.",
  "wd.starsContact": "Message @LinkerFlugel",
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
  "bet.already": "You already bet on this event",
  "bet.resolves": "How it resolves",
  "bet.preview": "Match preview",
  "bet.more": "More",
  "bet.less": "Less",

  // ── Игры (Games) ───────────────────────────────────────────────────────
  "games.rocketTitle": "Rocket",
  "games.rocketDesc": "Cash out before it crashes",
  "games.diceTitle": "Dice",
  "games.diceDesc": "Roll two dice, beat the odds",
  "games.caseTitle": "Cases",
  "games.caseDesc": "Open a case, win up to 200×",
  "games.basketTitle": "Basketball",
  "games.basketDesc": "Shoot, hit the basket, win",
  "rocket.starting": "Starts in",
  "rocket.flyingAway": "Flew away!",
  "rocket.place": "Place bet",
  "rocket.placed": "In the round",
  "rocket.cashout": "Cash out",
  "rocket.cashedOut": "Cashed out {m}",
  "rocket.youWon": "You won {amount} TON",
  "rocket.youLost": "Crashed — bet lost",
  "rocket.min": "Min 0.1 TON",
  "rocket.insufficient": "Not enough TON",
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
  "case.auto": "Auto-spin",
  "case.stop": "Stop auto-spin",
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
  "profile.stats": "Your stats",
  "profile.statBets": "Total bets",
  "profile.statWinRate": "Win rate",
  "profile.statPnl": "Net P&L",
  "profile.statWagered": "Wagered",
  "profile.fairTitle": "Provably fair",
  "profile.fairText":
    "Every game outcome comes from a server seed committed before you play and revealed after — results can't be altered and each one is verifiable. Event bets settle automatically from public Polymarket results.",
  "profile.support": "Support",
  "profile.supportText": "Questions, or a Stars withdrawal? Message us directly.",
  "profile.supportBtn": "Contact @LinkerFlugel",

  // ── Онбординг (Onboarding) ─────────────────────────────────────────────
  "onb.slide1Title": "Predict real-world events",
  "onb.slide1Text": "Sports, crypto, politics — bet on the outcome and win.",
  "onb.slide2Title": "Pick a side, win if you're right",
  "onb.slide2Text": "Choose Yes or No. Correct predictions pay out in TON.",
  "onb.slide3Title": "Top up in seconds",
  "onb.slide3Text": "Top up with TON or Telegram Stars.",
  "onb.slide4Title": "Cash out anytime",
  "onb.slide4Text": "Withdraw your winnings straight to your TON wallet.",
  "onb.skip": "Skip",
  "onb.start": "Get started",
  "onb.next": "Next",
} as const;

export type TKey = keyof typeof dict;
export type Vars = Record<string, string | number>;
export type TFunc = (key: TKey, vars?: Vars) => string;

function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k: string) =>
    k in vars ? String(vars[k]) : `{${k}}`,
  );
}

const t: TFunc = (key, vars) => interpolate(dict[key], vars);

/** Хук перевода: const t = useT(); t("bet.title"). */
export function useT(): TFunc {
  return t;
}
