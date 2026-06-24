import tonUrl from "../assets/ton.svg";

type Props = { size?: number; className?: string };

// Официальный логотип TON (синий круг + белый кристалл) — SVG-файл из cryptologos.
export default function TonIcon({ size = 24, className }: Props) {
  return <img src={tonUrl} width={size} height={size} alt="" aria-hidden className={className} />;
}
