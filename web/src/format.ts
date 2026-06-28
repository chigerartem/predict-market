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
