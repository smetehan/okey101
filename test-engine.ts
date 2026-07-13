import { tamTakim, kriptoKaristir, dagit, okeyMi, Tas, Renk } from "./src/lib/okey/tiles";
import { perKontrol, ciftMi, acmaKontrol, elCezasi } from "./src/lib/okey/melds";

let ok = 0, fail = 0;
function test(ad: string, kosul: boolean, detay?: unknown) {
  if (kosul) { ok++; console.log(`  ✓ ${ad}`); }
  else { fail++; console.log(`  ✗ ${ad}`, detay ?? ""); }
}
const T = (renk: Renk | null, sayi: number, sahte = false): Tas =>
  ({ id: Math.floor(Math.random() * 1e6), renk, sayi, sahte });

console.log("— Takım ve dağıtım —");
const takim = tamTakim();
test("106 taş üretildi", takim.length === 106);
test("2 sahte okey var", takim.filter(t => t.sahte).length === 2);
test("her renk-sayı ikişer", RENK_SAYI_KONTROL(takim));
function RENK_SAYI_KONTROL(t: Tas[]) {
  const m = new Map<string, number>();
  for (const x of t) if (!x.sahte) m.set(`${x.renk}-${x.sayi}`, (m.get(`${x.renk}-${x.sayi}`) ?? 0) + 1);
  return [...m.values()].every(v => v === 2) && m.size === 52;
}

const d = dagit(2);
test("başlayan 22 taş aldı", d.eller[2].length === 22);
test("diğerleri 21 taş aldı", d.eller[0].length === 21 && d.eller[1].length === 21 && d.eller[3].length === 21);
test("yığın 20 taş kaldı", d.yigin.length === 106 - 1 - 22 - 63, d.yigin.length);
test("gösterge sahte değil", !d.gosterge.sahte);
test("okey = gösterge+1", d.okey.sayi === (d.gosterge.sayi === 13 ? 1 : d.gosterge.sayi + 1) && d.okey.renk === d.gosterge.renk);

// karıştırma dağılımı kaba testi
const sayac = new Array(10).fill(0);
for (let i = 0; i < 5000; i++) sayac[kriptoKaristir([0,1,2,3,4,5,6,7,8,9])[0]]++;
test("karıştırma kabaca uniform", Math.max(...sayac) < 700 && Math.min(...sayac) > 320, sayac);

console.log("— Per kontrol —");
const okey = { renk: "mavi" as Renk, sayi: 5 };
test("seri: kırmızı 3-4-5", perKontrol([T("kirmizi",3),T("kirmizi",4),T("kirmizi",5)], okey).gecerli);
test("seri puanı 3+4+5=12", perKontrol([T("kirmizi",3),T("kirmizi",4),T("kirmizi",5)], okey).puan === 12);
test("seri: 12-13-1 geçerli", perKontrol([T("sari",12),T("sari",13),T("sari",1)], okey).gecerli);
test("seri: 13-1-2 geçersiz", !perKontrol([T("sari",13),T("sari",1),T("sari",2)], okey).gecerli);
test("seri: farklı renk geçersiz", !perKontrol([T("sari",3),T("mavi",4),T("sari",5)], okey).gecerli);
test("seri: okey boşluk doldurur (7-okey-9)", perKontrol([T("siyah",7),T("mavi",5),T("siyah",9)], okey).gecerli);
test("küt: 3 renk aynı sayı", perKontrol([T("kirmizi",9),T("mavi",9),T("sari",9)], okey).gecerli);
test("küt puanı 9×3=27", perKontrol([T("kirmizi",9),T("mavi",9),T("sari",9)], okey).puan === 27);
test("küt: 4 renk geçerli", perKontrol([T("kirmizi",9),T("mavi",9),T("sari",9),T("siyah",9)], okey).gecerli);
test("küt: aynı renk tekrar geçersiz", !perKontrol([T("kirmizi",9),T("kirmizi",9),T("sari",9)], okey).gecerli);
test("küt: okey ile 2+1", perKontrol([T("kirmizi",9),T("sari",9),T("mavi",5)], okey).gecerli);
test("sahte okey = mavi 5 gibi davranır (mavi 4-5F-6... yani 4,sahte,6)",
  perKontrol([T("mavi",4),T(null,0,true),T("mavi",6)], okey).gecerli);
test("sahte okey kütte mavi 5", perKontrol([T(null,0,true),T("kirmizi",5),T("sari",5)], okey).gecerli);

console.log("— Çift —");
test("çift: aynı taş", ciftMi([T("sari",7),T("sari",7)], okey).gecerli);
test("çift: farklı geçersiz", !ciftMi([T("sari",7),T("mavi",7)], okey).gecerli);
test("çift: okey joker", ciftMi([T("sari",7),T("mavi",5)], okey).gecerli);
test("çift: sahte okey + mavi 5", ciftMi([T(null,0,true),T("mavi",5)], okey).gecerli);

console.log("— Açma —");
const yuzbirlik = [
  [T("kirmizi",11),T("kirmizi",12),T("kirmizi",13)], // 36
  [T("mavi",11),T("sari",11),T("siyah",11)],          // 33
  [T("sari",10),T("sari",11),T("sari",12)],           // 33  → 102
];
test("102 puanla açılır", acmaKontrol(yuzbirlik, okey).gecerli);
const dusuk = [[T("kirmizi",1),T("kirmizi",2),T("kirmizi",3)]];
test("6 puanla açılamaz", !acmaKontrol(dusuk, okey).gecerli);
const ciftler = [
  [T("sari",7),T("sari",7)],[T("mavi",3),T("mavi",3)],
  [T("kirmizi",13),T("kirmizi",13)],[T("siyah",1),T("siyah",1)],
];
test("4 çiftle açılır", acmaKontrol(ciftler, okey).gecerli);
test("3 çiftle açılamaz", !acmaKontrol(ciftler.slice(0,3), okey).gecerli);

console.log("— Ceza —");
test("açamayan 101 ceza", elCezasi([T("sari",1)], okey, false) === 101);
test("açan elindeki toplam", elCezasi([T("sari",4),T("mavi",10)], okey, true) === 14);

console.log(`\nSonuç: ${ok} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
