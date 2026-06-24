// MOCK api for the cloned cashback UI shell. Returns canned demo data so every
// screen + animation renders without a backend. This is a temporary scaffold —
// to be replaced when we rework the UI into the prediction market (wire to the
// Go API at api.market.kopix.online).

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const ok = <T>(data: T): Promise<T> => Promise.resolve(data);
const tgUser = () => window.Telegram?.WebApp?.initDataUnsafe?.user;

// ── /api/me ────────────────────────────────────────────────────────────────

export type ExchangeAccount = {
  exchange: string;
  uid: string;
  status: "pending" | "active" | "revoked";
};

export type ExchangeBalance = {
  exchange: string;
  accrued_usd: string;
  paid_out_usd: string;
  reserved_usd: string;
  available_usd: string;
  native_credited_usd: string;
};

export type MeResponse = {
  user: {
    id: string;
    tg_id: number;
    tg_username: string | null;
    name: string;
    ref_code: string;
    vip_tier: string;
    language: string;
    onboarded: boolean;
  };
  partner_id: string | null;
  // Баланс пользователя в TON — основные «деньги» prediction-маркета: депозит
  // подарками/TON/Stars оценивается и кредитуется сюда. Формат уточнится с бэком
  // (вероятно наноTON-целые); пока mock — десятичная строка TON.
  ton_balance: string;
  balances: ExchangeBalance[];
  exchanges: ExchangeAccount[];
};

export const getMe = () =>
  ok<MeResponse>({
    user: {
      id: "demo",
      tg_id: tgUser()?.id ?? 0,
      tg_username: tgUser()?.username ?? null,
      name: tgUser()?.first_name || tgUser()?.username || "Гость",
      ref_code: "DEMO2026",
      vip_tier: "gold",
      language: "ru",
      onboarded: false,
    },
    partner_id: "demo",
    ton_balance: "1250.50",
    balances: [
      { exchange: "bingx", accrued_usd: "152.40", paid_out_usd: "80.00", reserved_usd: "0", available_usd: "72.40", native_credited_usd: "152.40" },
      { exchange: "bitunix", accrued_usd: "43.10", paid_out_usd: "0", reserved_usd: "0", available_usd: "43.10", native_credited_usd: "43.10" },
    ],
    exchanges: [
      { exchange: "bingx", uid: "81726354", status: "active" },
      { exchange: "bitunix", uid: "55512345", status: "active" },
    ],
  });

export const markOnboarded = () => ok<{ ok: true }>({ ok: true });

export type StatsEntry = {
  id: string;
  exchange: string;
  kind: "self" | "referral" | "partner";
  amount_usd: string;
  rate_applied: string | null;
  vip_tier_at_time: string | null;
  source_date: string | null;
  created_at: string;
};

export type StatsResponse = {
  period_days: number;
  exchange: string | null;
  total_cashback_usd: string;
  by_kind: Partial<Record<"self" | "referral" | "partner", string>>;
  daily: { date: string | null; amount_usd: string }[];
  entries: StatsEntry[];
};

export const getMyStats = (exchange?: string, days = 30) =>
  ok<StatsResponse>({
    period_days: days,
    exchange: exchange ?? null,
    total_cashback_usd: "195.50",
    by_kind: { self: "150.00", referral: "45.50" },
    daily: [
      { date: "2026-06-18", amount_usd: "12.50" },
      { date: "2026-06-19", amount_usd: "8.20" },
      { date: "2026-06-20", amount_usd: "21.00" },
      { date: "2026-06-21", amount_usd: "5.40" },
      { date: "2026-06-22", amount_usd: "33.10" },
      { date: "2026-06-23", amount_usd: "15.30" },
    ],
    entries: [
      { id: "e1", exchange: "bingx", kind: "self", amount_usd: "12.50", rate_applied: "0.30", vip_tier_at_time: "gold", source_date: "2026-06-23", created_at: "2026-06-23T10:00:00Z" },
      { id: "e2", exchange: "bingx", kind: "referral", amount_usd: "5.00", rate_applied: null, vip_tier_at_time: "gold", source_date: "2026-06-22", created_at: "2026-06-22T09:00:00Z" },
      { id: "e3", exchange: "bitunix", kind: "self", amount_usd: "9.90", rate_applied: "0.50", vip_tier_at_time: "gold", source_date: "2026-06-22", created_at: "2026-06-22T08:00:00Z" },
    ],
  });

// ── /api/exchanges ─────────────────────────────────────────────────────────

export type ExchangeFees = {
  spot_taker_pct: number;
  spot_maker_pct: number;
  perp_taker_pct: number;
  perp_maker_pct: number;
};

export type ExchangeInfo = {
  slug: string;
  name: string;
  brand_color: string;
  domain: string;
  logo_urls: string[];
  available: boolean;
  referral_url: string | null;
  status: "not_connected" | "pending" | "active" | "coming_soon";
  uid: string | null;
  fees: ExchangeFees;
  user_base_rate_pct: number;
  payout_mode: "pool" | "native";
};

const FEES: ExchangeFees = { spot_taker_pct: 0.1, spot_maker_pct: 0.1, perp_taker_pct: 0.05, perp_maker_pct: 0.02 };

export const getExchanges = () =>
  ok<ExchangeInfo[]>([
    { slug: "bingx", name: "BingX", brand_color: "#2A5BD7", domain: "bingx.com", logo_urls: [], available: true, referral_url: "https://bingx.com", status: "active", uid: "81726354", fees: FEES, user_base_rate_pct: 30, payout_mode: "pool" },
    { slug: "bitunix", name: "Bitunix", brand_color: "#111827", domain: "bitunix.com", logo_urls: [], available: true, referral_url: "https://bitunix.com", status: "active", uid: "55512345", fees: FEES, user_base_rate_pct: 50, payout_mode: "pool" },
    { slug: "binance", name: "Binance", brand_color: "#F0B90B", domain: "binance.com", logo_urls: [], available: true, referral_url: null, status: "not_connected", uid: null, fees: FEES, user_base_rate_pct: 5, payout_mode: "pool" },
    { slug: "mexc", name: "MEXC", brand_color: "#1972F5", domain: "mexc.com", logo_urls: [], available: false, referral_url: null, status: "coming_soon", uid: null, fees: FEES, user_base_rate_pct: 40, payout_mode: "pool" },
  ]);

export type ConnectResult = {
  status: "pending" | "active";
  uid: string;
  direct_invitation?: boolean;
};

export const connectExchange = (_slug: string, uid: string) =>
  ok<ConnectResult>({ status: "pending", uid });

export const connectBingx = (uid: string) => connectExchange("bingx", uid);

export const disconnectExchange = (slug: string) =>
  ok<{ deleted: true; slug: string }>({ deleted: true, slug });

export type BingxStatus =
  | { status: "not_connected" }
  | { status: "pending" | "active"; uid: string };

export const getBingxStatus = () => ok<BingxStatus>({ status: "active", uid: "81726354" });

// ── /api/referral ──────────────────────────────────────────────────────────

export type ReferralLevel = {
  level: number;
  threshold_usd: number;
  reward_usd: number;
};

export type ReferralInfo = {
  ref_code: string;
  ref_url: string;
  invited_count: number;
  invitee_volume_usd: string;
  levels: ReferralLevel[];
  current_level: number;
  claimable_usd: string;
  next_level: ReferralLevel | null;
  claim_contact: string;
};

export const getReferral = () =>
  ok<ReferralInfo>({
    ref_code: "DEMO2026",
    ref_url: "https://t.me/kopix_predict_bot?start=DEMO2026",
    invited_count: 7,
    invitee_volume_usd: "18400",
    levels: [
      { level: 1, threshold_usd: 1000, reward_usd: 10 },
      { level: 2, threshold_usd: 5000, reward_usd: 50 },
      { level: 3, threshold_usd: 20000, reward_usd: 250 },
    ],
    current_level: 2,
    claimable_usd: "60",
    next_level: { level: 3, threshold_usd: 20000, reward_usd: 250 },
    claim_contact: "@kopix_support",
  });

// ── /api/stats ─────────────────────────────────────────────────────────────

export type GlobalStats = {
  partner_id: string | null;
  total_paid_out_usd: string;
  total_traders: number;
  volume_30d_usd: string;
};

export const getGlobalStats = () =>
  ok<GlobalStats>({ partner_id: "demo", total_paid_out_usd: "284530", total_traders: 6240, volume_30d_usd: "4120000" });

export type RecentWithdrawal = {
  id: string;
  amount_usd: string;
  destination_type: "internal_uid" | "internal_email" | "internal_address" | "trc20" | "bep20";
  destination_masked: string;
  completed_at: string | null;
};

export const getRecentWithdrawals = (limit = 20) => {
  const rows: RecentWithdrawal[] = [
    { id: "w1", amount_usd: "120.00", destination_type: "trc20", destination_masked: "TQ•••x7a", completed_at: "2026-06-23T12:00:00Z" },
    { id: "w2", amount_usd: "64.50", destination_type: "internal_uid", destination_masked: "UID 55•••345", completed_at: "2026-06-22T16:30:00Z" },
    { id: "w3", amount_usd: "210.00", destination_type: "bep20", destination_masked: "0x•••9f2", completed_at: "2026-06-21T08:10:00Z" },
  ];
  return ok(rows.slice(0, limit));
};

export type LeaderboardEntry = {
  rank: number;
  name: string;
  vip_tier: string;
  earned_usd: string;
};

export const getLeaderboard = (_period: "all" | "30d" = "all", limit = 50) =>
  ok<LeaderboardEntry[]>(
    [
      { rank: 1, name: "Alex", vip_tier: "diamond", earned_usd: "4210.00" },
      { rank: 2, name: "Marina", vip_tier: "gold", earned_usd: "3180.50" },
      { rank: 3, name: "Dmitry", vip_tier: "gold", earned_usd: "2740.00" },
      { rank: 4, name: "Sofia", vip_tier: "silver", earned_usd: "1990.20" },
      { rank: 5, name: "Igor", vip_tier: "bronze", earned_usd: "1450.00" },
    ].slice(0, limit),
  );
