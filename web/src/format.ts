/** Парсит строку/число → выводит "$0.00" с разделителями. NaN/null/"" → "$0.00". */
export function fmtUsd(v: string | number | null | undefined): string {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  if (!Number.isFinite(n)) return "$0.00";
  return "$" + n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Парсит строку/число TON → "1,250.50" (без символа — "TON"/иконку ставит UI).
 *  NaN/null/"" → "0.00". Формат значения уточнится с бэком (вероятно наноTON). */
export function fmtTon(v: string | number | null | undefined): string {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Компактный формат: $1.5K, $25M. Под цифры на статах. */
export function fmtUsdCompact(v: string | number | null | undefined): string {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  if (!Number.isFinite(n)) return "$0";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 10_000) return "$" + Math.round(n / 1_000) + "K";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return "$" + Math.round(n);
}

/** Целое число для счётчиков (трейдеров, рефералов). */
export function fmtInt(v: string | number | null | undefined): string {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("en-US");
}

/** Человекочитаемая метка способа вывода (destination_type). */
export function destTypeLabel(t: string): string {
  switch (t) {
    case "internal_uid":
      return "UID биржи";
    case "internal_email":
      return "Email биржи";
    case "trc20":
      return "TRC-20";
    case "bep20":
      return "BEP-20";
    case "bingx_uid": // legacy-записи до перехода на internal_*
      return "BingX UID";
    default:
      return t;
  }
}
