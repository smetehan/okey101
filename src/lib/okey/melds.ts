// ─────────────────────────────────────────────────────────────
// 101 Okey — Per (seri / küt / çift) doğrulama ve puanlama
// ─────────────────────────────────────────────────────────────
import { Tas, Renk, efektifTas, okeyMi } from "./tiles";

export interface OkeyBilgi {
  renk: Renk;
  sayi: number;
}

export type PerTipi = "seri" | "kut" | "cift";

export interface PerSonuc {
  gecerli: boolean;
  tip?: PerTipi;
  puan: number;
  hata?: string;
}

/**
 * Bir taş grubunun geçerli per olup olmadığını kontrol eder.
 * - seri: aynı renk, ardışık en az 3 sayı (12-13-1 olur, 13-1-2 olmaz)
 * - küt : aynı sayı, farklı renk, 3 veya 4 taş
 * Okey taşı joker olarak boşluk doldurur. Sahte okey, okeyin
 * renk/sayısını taşıyan normal taş gibi davranır.
 */
export function perKontrol(taslar: Tas[], okey: OkeyBilgi): PerSonuc {
  if (taslar.length < 3) return { gecerli: false, puan: 0, hata: "En az 3 taş gerekir" };

  const efektif = taslar.map((t) => efektifTas(t, okey));
  const jokerSayisi = efektif.filter((e) => e.joker).length;
  const sabitler = efektif.filter((e) => !e.joker);

  // ── Küt denemesi: aynı sayı, farklı renkler ──
  if (taslar.length <= 4) {
    const sayilar = new Set(sabitler.map((s) => s.sayi));
    const renkler = sabitler.map((s) => s.renk);
    const renkTekrar = new Set(renkler).size !== renkler.length;
    if (sayilar.size <= 1 && !renkTekrar && sabitler.length + jokerSayisi === taslar.length) {
      const sayi = sabitler.length ? sabitler[0].sayi : okey.sayi;
      // jokerlerin alabileceği yeterli farklı renk kalmış mı
      const bosRenk = 4 - new Set(renkler).size;
      if (jokerSayisi <= bosRenk || sabitler.length === 0) {
        return { gecerli: true, tip: "kut", puan: sayi * taslar.length };
      }
    }
  }

  // ── Seri denemesi: aynı renk, ardışık ──
  const seriPuan = seriDene(sabitler, jokerSayisi, taslar.length);
  if (seriPuan !== null) return { gecerli: true, tip: "seri", puan: seriPuan };

  return { gecerli: false, puan: 0, hata: "Geçerli seri veya küt değil" };
}

/**
 * Seri kontrolü. Jokerler boşluklara veya uçlara yerleşebilir.
 * 1 taşı serinin başında 1, 12-13-1 dizilişinde 14 puan sayılır
 * (yaygın 101 kuralı: 12-13-1 = 12+13+14... bazı masalarda 12+13+1.
 *  Burada 1 = 1 puan olarak sayıyoruz; SABITLER.birUcteOnDort ile değiştirilebilir).
 */
function seriDene(
  sabitler: { renk: Renk; sayi: number }[],
  joker: number,
  toplamUzunluk: number
): number | null {
  if (sabitler.length === 0) {
    // tamamı joker — teorik, en düşük değerle kabul etme: reddet
    return null;
  }
  const renk = sabitler[0].renk;
  if (!sabitler.every((s) => s.renk === renk)) return null;

  const sayilar = sabitler.map((s) => s.sayi).sort((a, b) => a - b);
  if (new Set(sayilar).size !== sayilar.length) return null; // aynı sayı iki kez olamaz

  // Normal ardışıklık: tüm pencere başlangıçlarını dene, EN YÜKSEK puanlıyı seç
  let enIyi: number | null = null;
  for (let baslangic = 1; baslangic <= 14 - toplamUzunluk + (sayilar.includes(1) ? 1 : 0); baslangic++) {
    // pencere: baslangic .. baslangic+len-1 ; 14 = "1" (12-13-1 için)
    let gerekliJoker = 0;
    let uyuyor = true;
    const pencere: number[] = [];
    for (let i = 0; i < toplamUzunluk; i++) {
      const v = baslangic + i;
      if (v > 14) { uyuyor = false; break; }
      pencere.push(v === 14 ? 1 : v);
    }
    if (!uyuyor) continue;
    // 14 sadece son eleman olabilir (12-13-1)
    const kalan = [...sayilar];
    for (const v of pencere) {
      const idx = kalan.indexOf(v);
      if (idx >= 0) kalan.splice(idx, 1);
      else gerekliJoker++;
    }
    if (kalan.length === 0 && gerekliJoker === joker) {
      // puan: penceredeki değerlerin toplamı (1 uçtaysa 1 puan)
      const puan = pencere.reduce((t, v) => t + v, 0);
      if (enIyi === null || puan > enIyi) enIyi = puan;
    }
  }
  return enIyi;
}

/** Çift kontrolü: birebir aynı taş (renk+sayı) veya taş+joker */
export function ciftMi(taslar: Tas[], okey: OkeyBilgi): PerSonuc {
  if (taslar.length !== 2) return { gecerli: false, puan: 0, hata: "Çift 2 taştan oluşur" };
  const [a, b] = taslar.map((t) => efektifTas(t, okey));
  if (a.joker || b.joker) {
    const sabit = a.joker ? b : a;
    return { gecerli: true, tip: "cift", puan: sabit.joker ? okey.sayi * 2 : sabit.sayi * 2 };
  }
  if (a.renk === b.renk && a.sayi === b.sayi) {
    return { gecerli: true, tip: "cift", puan: a.sayi * 2 };
  }
  return { gecerli: false, puan: 0, hata: "Taşlar aynı değil" };
}

export const SABITLER = {
  ACMA_PUANI: 101,        // ilk açılışta perlerin toplamı en az bu olmalı
  MIN_CIFT_ACMA: 4,       // çiftten açmak için en az kaç çift
  ACAMAYAN_CEZA: 101,     // el bittiğinde hiç açamamış oyuncunun cezası
  ELDEN_BITME_BONUS: -101,// tek seferde tüm eli açıp bitirme (elden bitme)
  OKEY_ATARAK_BITME_CARPAN: 2, // okey atarak bitirme ceza çarpanı
  BITIS_SINIRI: 5,        // toplam cezası bu el sayısı sonunda en düşük olan kazanır — null: süresiz
};

export interface AcmaSonuc {
  gecerli: boolean;
  toplamPuan: number;
  tip: "normal" | "cift" | null;
  hata?: string;
}

/**
 * İlk açma denetimi:
 * - normal: seçilen perlerin (seri/küt) puan toplamı ≥ 101
 * - çift  : en az MIN_CIFT_ACMA geçerli çift
 * Karma (per + çift) ilk açılışta kabul edilmez.
 */
export function acmaKontrol(gruplar: Tas[][], okey: OkeyBilgi): AcmaSonuc {
  if (gruplar.length === 0)
    return { gecerli: false, toplamPuan: 0, tip: null, hata: "Per seçilmedi" };

  const ciftler = gruplar.map((g) => ciftMi(g, okey));
  if (ciftler.every((c) => c.gecerli)) {
    if (gruplar.length >= SABITLER.MIN_CIFT_ACMA) {
      const toplam = ciftler.reduce((t, c) => t + c.puan, 0);
      return { gecerli: true, toplamPuan: toplam, tip: "cift" };
    }
    return {
      gecerli: false, toplamPuan: 0, tip: null,
      hata: `Çiftten açmak için en az ${SABITLER.MIN_CIFT_ACMA} çift gerekir`,
    };
  }

  let toplam = 0;
  for (const g of gruplar) {
    const s = perKontrol(g, okey);
    if (!s.gecerli)
      return { gecerli: false, toplamPuan: 0, tip: null, hata: s.hata };
    toplam += s.puan;
  }
  if (toplam < SABITLER.ACMA_PUANI)
    return {
      gecerli: false, toplamPuan: toplam, tip: null,
      hata: `Toplam ${toplam} puan — en az ${SABITLER.ACMA_PUANI} gerekir`,
    };
  return { gecerli: true, toplamPuan: toplam, tip: "normal" };
}

/** El bittiğinde bir oyuncunun elinde kalan taşların ceza puanı */
export function elCezasi(el: Tas[], okey: OkeyBilgi, acmisMi: boolean): number {
  if (!acmisMi) return SABITLER.ACAMAYAN_CEZA;
  return el.reduce((t, tas) => {
    if (okeyMi(tas, okey)) return t + okey.sayi * 2; // elde kalan okey ağır cezalıdır (yaygın: 101? masaya göre değişir — burada 2×sayı)
    const e = efektifTas(tas, okey);
    return t + e.sayi;
  }, 0);
}
