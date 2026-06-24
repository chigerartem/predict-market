import { useState } from "react";
import type { MeResponse } from "../api";
import { fmtTon } from "../format";
import { useT } from "../i18n";
import TonIcon from "../components/TonIcon";
import DepositModal from "../components/DepositModal";
import WithdrawModal from "../components/WithdrawModal";

type Props = {
  me: MeResponse;
  onReload: () => void;
  onOpenReferral: () => void;
};

// Главная prediction-маркета: голубой герой с балансом в TON и кнопками
// Пополнить / Вывести. Приветствие/профиль из cashback-форка убраны — герой
// целиком отдан балансу. Контента под героем пока нет.
export default function Home({ me }: Props) {
  const t = useT();
  const [deposit, setDeposit] = useState(false);
  const [withdraw, setWithdraw] = useState(false);
  const balance = me.ton_balance ?? "0";

  return (
    <div>
      <div className="flex w-full flex-col items-center bg-gradient-to-b from-[#5CCBFF] to-[#2E9BE6] px-6 pb-9 pt-12 text-center text-white">
        <div className="text-sm font-medium text-white/85">{t("home.yourBalance")}</div>

        <div className="mt-2 flex items-center justify-center gap-2.5">
          <TonIcon size={38} />
          <span className="text-6xl font-extrabold tracking-tight tabular-nums">
            {fmtTon(balance)}
          </span>
        </div>
        <div className="mt-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-white/70">
          TON
        </div>

        <div className="mt-7 flex w-full max-w-xs items-center gap-3">
          <button
            onClick={() => setDeposit(true)}
            className="flex-1 rounded-2xl bg-white py-3 text-sm font-semibold text-[#1E9BE6] shadow-sm transition active:scale-[0.98]"
          >
            {t("home.deposit")}
          </button>
          <button
            onClick={() => setWithdraw(true)}
            className="flex-1 rounded-2xl border border-white/60 bg-white/10 py-3 text-sm font-semibold text-white transition active:scale-[0.98]"
          >
            {t("home.withdraw")}
          </button>
        </div>
      </div>

      <DepositModal open={deposit} onClose={() => setDeposit(false)} />
      <WithdrawModal open={withdraw} onClose={() => setWithdraw(false)} balanceTon={balance} />
    </div>
  );
}
