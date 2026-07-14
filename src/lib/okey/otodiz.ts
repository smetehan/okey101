// ─────────────────────────────────────────────────────────────
// Otomatik dizme: eldeki taşlardan serileri/kütleri ve çiftleri
// kendiliğinden bulur, okey (joker) taşlarıyla eksikleri tamamlar.
// ─────────────────────────────────────────────────────────────
import { Tas, Renk, RENKLER, okeyMi, efektifTas } from "./tiles";
import { perKontrol, ciftMi, OkeyBilgi } from "./melds";

interface EfTas { tas: Tas; renk: Renk; sayi: number }

export interface OtoSonuc {
  gruplar: Tas[][];
  kalan: Tas[];
  toplam: number;
  ciftSayisi: number;
}

/** Eldeki serileri (aynı renk ardışık) ve kütleri (aynı sayı farklı renk) bulur */
export function serileriBul(el: Tas[], okey: OkeyBilgi): OtoSonuc {
  const jokerler = el.filter((t) => okeyMi(t, okey));
  const normal: EfTas[] = el
    .filter((t) => !okeyMi(t, okey))
    .map((t) => {
      const e = efektifTas(t, okey);
      return { tas: t, renk: e.renk, sayi: e.sayi };
    });

  // renk → sayı → taşlar (kopyalar dahil)
  const stok = new Map<Renk, Map<number, EfTas[]>>();
  for (const r of RENKLER) stok.set(r, new Map());
  for (const n of normal) {
    const m = stok.get(n.renk)!;
    if (!m.has(n.sayi)) m.set(n.sayi, []);
    m.get(n.sayi)!.push(n);
  }
  const var_ = (r: Renk, s: number) => (stok.get(r)!.get(s)?.length ?? 0) > 0;
  const al = (r: Renk, s: number) => stok.get(r)!.get(s)!.pop()!;
  const geriKoy = (t: EfTas) => stok.get(t.renk)!.get(t.sayi)!.push(t);

  const gruplar: Tas[][] = [];

  // Seri taraması: her renkte ardışık zincirler (12-13-1 dahil)
  const seriTara = () => {
    for (const r of RENKLER) {
      let s = 1;
      while (s <= 13) {
        if (!var_(r, s)) { s++; continue; }
        const zincir: EfTas[] = [];
        let v = s;
        while (v <= 13 && var_(r, v)) { zincir.push(al(r, v)); v++; }
        // 12-13'te bittiyse 1 ile uzat (12-13-1)
        if (v === 14 && zincir.length >= 2 && var_(r, 1)) zincir.push(al(r, 1));
        if (zincir.length >= 3) gruplar.push(zincir.map((z) => z.tas));
        else zincir.forEach(geriKoy);
        s = v;
      }
    }
  };

  // Küt taraması: aynı sayıdan 3-4 farklı renk
  const kutTara = () => {
    for (let s = 1; s <= 13; s++) {
      let renkler = RENKLER.filter((r) => var_(r, s));
      while (renkler.length >= 3) {
        gruplar.push(renkler.slice(0, 4).map((r) => al(r, s).tas));
        renkler = RENKLER.filter((r) => var_(r, s));
      }
    }
  };

  seriTara();
  kutTara();
  seriTara(); // küt sonrası açığa çıkan kopyalarla ikinci tur

  // Okey (joker) ile 2'lik parçaları tamamla — en yüksek puanlıyı seç
  const kalanlar = () => {
    const out: EfTas[] = [];
    for (const r of RENKLER) for (const arr of stok.get(r)!.values()) out.push(...arr);
    return out;
  };
  while (jokerler.length > 0) {
    const aday = kalanlar();
    let enIyi: { a: EfTas; b: EfTas; puan: number } | null = null;
    for (let i = 0; i < aday.length; i++)
      for (let j = i + 1; j < aday.length; j++) {
        const d = perKontrol([aday[i].tas, aday[j].tas, jokerler[0]], okey);
        if (d.gecerli && (!enIyi || d.puan > enIyi.puan))
          enIyi = { a: aday[i], b: aday[j], puan: d.puan };
      }
    if (!enIyi) break;
    const cikar = (t: EfTas) => {
      const arr = stok.get(t.renk)!.get(t.sayi)!;
      arr.splice(arr.indexOf(t), 1);
    };
    cikar(enIyi.a); cikar(enIyi.b);
    gruplar.push([enIyi.a.tas, enIyi.b.tas, jokerler.shift()!]);
  }

  return sonucla(el, gruplar, okey, "seri");
}

/** Eldeki çiftleri bulur — okey en değerli tek taşla eşleşir */
export function ciftleriBul(el: Tas[], okey: OkeyBilgi): OtoSonuc {
  const jokerler = el.filter((t) => okeyMi(t, okey));
  const normal = el.filter((t) => !okeyMi(t, okey));

  const kova = new Map<string, Tas[]>();
  for (const t of normal) {
    const e = efektifTas(t, okey);
    const k = `${e.renk}-${e.sayi}`;
    if (!kova.has(k)) kova.set(k, []);
    kova.get(k)!.push(t);
  }

  const gruplar: Tas[][] = [];
  const tekler: Tas[] = [];
  for (const arr of kova.values()) {
    while (arr.length >= 2) gruplar.push([arr.pop()!, arr.pop()!]);
    if (arr.length) tekler.push(arr[0]);
  }
  // Jokerler en değerli teklerle çift olur (çift puanı ×2 olduğundan)
  tekler.sort((a, b) => efektifTas(b, okey).sayi - efektifTas(a, okey).sayi);
  while (jokerler.length && tekler.length) gruplar.push([tekler.shift()!, jokerler.shift()!]);
  while (jokerler.length >= 2) gruplar.push([jokerler.shift()!, jokerler.shift()!]);

  return sonucla(el, gruplar, okey, "cift");
}

function sonucla(el: Tas[], gruplar: Tas[][], okey: OkeyBilgi, tip: "seri" | "cift"): OtoSonuc {
  let toplam = 0;
  const dogru: Tas[][] = [];
  for (const g of gruplar) {
    const s = tip === "cift" ? ciftMi(g, okey) : perKontrol(g, okey);
    if (s.gecerli) { toplam += s.puan; dogru.push(g); }
  }
  const kullanilan = new Set(dogru.flat().map((t) => t.id));
  return {
    gruplar: dogru,
    kalan: el.filter((t) => !kullanilan.has(t.id)),
    toplam,
    ciftSayisi: tip === "cift" ? dogru.length : 0,
  };
}
