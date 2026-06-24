export interface Me {
  user_id: number;
  balance_nano: number;
}

export interface Outcome {
  id: number;
  title: string;
  odds_milli: number;
}

export interface Market {
  id: number;
  title: string;
  category: string;
  close_time: string | null;
  outcomes: Outcome[];
}

export interface Bet {
  id: number;
  market_id: number;
  outcome_id: number;
  stake_nano: number;
  odds_milli: number;
  payout_nano: number;
  status: string;
  placed_at: string;
}
