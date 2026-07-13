"use client";
import { Tas } from "@/lib/okey/tiles";

const RENK_CSS: Record<string, string> = {
  kirmizi: "var(--tas-kirmizi)",
  siyah: "var(--tas-siyah)",
  mavi: "var(--tas-mavi)",
  sari: "var(--tas-sari)",
};

export function Tile({
  tas, secili, kucuk, onClick,
}: {
  tas: Tas;
  secili?: boolean;
  kucuk?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`tas ${kucuk ? "tas--kucuk" : ""} ${secili ? "tas--secili" : ""}`}
      style={{ color: tas.sahte ? "var(--tas-siyah)" : RENK_CSS[tas.renk ?? "siyah"] }}
      aria-label={tas.sahte ? "Sahte okey" : `${tas.renk} ${tas.sayi}`}
    >
      <span className="tas__sayi">{tas.sahte ? "★" : tas.sayi}</span>
      <span className="tas__nokta" />
    </button>
  );
}

/** Kapalı taş sırtı (yığın, rakip elleri) */
export function KapaliTas({ kucuk }: { kucuk?: boolean }) {
  return <span className={`tas tas--kapali ${kucuk ? "tas--kucuk" : ""}`} aria-hidden />;
}
