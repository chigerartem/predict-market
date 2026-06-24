// Заглушка /api/me для оболочки Mini App: канонический user + баланс TON. Реальные
// данные приходят с Go API (api.market.kopix.online); здесь — демо-каркас, чтобы
// экраны рендерились без бэка. Cashback-эндпоинты (биржи/статы/рефералка/лидерборд)
// удалены вместе с их экранами при переходе на prediction-маркет.

const ok = <T>(data: T): Promise<T> => Promise.resolve(data);
const tgUser = () => window.Telegram?.WebApp?.initDataUnsafe?.user;

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
  });

export const markOnboarded = () => ok<{ ok: true }>({ ok: true });
