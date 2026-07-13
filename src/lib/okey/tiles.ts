// ─────────────────────────────────────────────────────────────
// 101 Okey — Taş motoru
// Gerçek hayattaki gibi: 106 taş, kriptografik rastgele karıştırma.
// Hiçbir oyuncuya "iyi/kötü taş" yönlendirmesi YOKTUR.
// ─────────────────────────────────────────────────────────────

export type Renk = "kirmizi" | "siyah" | "mavi" | "sari";
export const RENKLER: Renk[] = ["kirmizi", "siyah", "mavi", "sari"];

export interface Tas {
  id: number;        // 0..105 benzersiz
  renk: Renk | null; // sahte okeyde null
  sayi: number;      // 1..13, sahte okeyde 0
  sahte: boolean;    // sahte okey mi
}

/** 106 taşlık tam takım üretir: 4 renk × 13 sayı × 2 kopya + 2 sahte okey */
export function tamTakim(): Tas[] {
  const taslar: Tas[] = [];
  let id = 0;
  for (let kopya = 0; kopya < 2; kopya++) {
    for (const renk of RENKLER) {
      for (let sayi = 1; sayi <= 13; sayi++) {
        taslar.push({ id: id++, renk, sayi, sahte: false });
      }
    }
  }
  taslar.push({ id: id++, renk: null, sayi: 0, sahte: true });
  taslar.push({ id: id++, renk: null, sayi: 0, sahte: true });
  return taslar; // 106
}

/**
 * Fisher–Yates + kriptografik rastgelelik.
 * Node tarafında crypto.randomInt yerine platformdan bağımsız
 * çalışması için Web Crypto (globalThis.crypto) kullanılır —
 * hem Node 20+ hem Edge runtime'da mevcuttur.
 */
export function kriptoKaristir<T>(dizi: T[]): T[] {
  const a = [...dizi];
  const buf = new Uint32Array(1);
  for (let i = a.length - 1; i > 0; i--) {
    // modulo bias'ı önlemek için rejection sampling
    const sinir = Math.floor(0x100000000 / (i + 1)) * (i + 1);
    let r: number;
    do {
      globalThis.crypto.getRandomValues(buf);
      r = buf[0];
    } while (r >= sinir);
    const j = r % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface Dagitim {
  eller: Tas[][];   // 4 el — başlayan 22, diğerleri 21 taş
  yigin: Tas[];     // ortadaki kapalı yığın
  gosterge: Tas;    // açılan gösterge taşı
  okey: { renk: Renk; sayi: number }; // okey taşının kimliği
  baslayan: number; // 0..3 koltuk
}

/** Gerçek okey kuralına göre dağıtım yapar. */
export function dagit(baslayan: number): Dagitim {
  const deste = kriptoKaristir(tamTakim());

  // Gösterge: sahte okey olmayan ilk taş (gerçekte de zar atılıp kırılan
  // yerden sahte olmayan taş açılır)
  let gostergeIdx = deste.findIndex((t) => !t.sahte);
  const gosterge = deste.splice(gostergeIdx, 1)[0];

  // Okey = göstergenin bir üstü, aynı renk (13 → 1'e döner)
  const okey = {
    renk: gosterge.renk as Renk,
    sayi: gosterge.sayi === 13 ? 1 : gosterge.sayi + 1,
  };

  const eller: Tas[][] = [[], [], [], []];
  // Başlayan 22, diğerleri 21 taş alır
  for (let k = 0; k < 4; k++) {
    const adet = k === baslayan ? 22 : 21;
    eller[k] = deste.splice(0, adet);
  }

  return { eller, yigin: deste, gosterge, okey, baslayan };
}

/** Bir taş okey mi? (sahte okey OKEY DEĞİLDİR — okeyin sayısını temsil eder) */
export function okeyMi(t: Tas, okey: { renk: Renk; sayi: number }): boolean {
  return !t.sahte && t.renk === okey.renk && t.sayi === okey.sayi;
}

/**
 * Taşın per hesabında temsil ettiği değer:
 * - okey taşı → joker (her şey olabilir)
 * - sahte okey → okeyin renk/sayısı
 * - normal taş → kendisi
 */
export function efektifTas(
  t: Tas,
  okey: { renk: Renk; sayi: number }
): { joker: boolean; renk: Renk; sayi: number } {
  if (okeyMi(t, okey)) return { joker: true, renk: t.renk as Renk, sayi: t.sayi };
  if (t.sahte) return { joker: false, renk: okey.renk, sayi: okey.sayi };
  return { joker: false, renk: t.renk as Renk, sayi: t.sayi };
}
