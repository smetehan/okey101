import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { dagit, okeyMi, Tas } from "@/lib/okey/tiles";
import { acmaKontrol, perKontrol, ciftMi, elCezasi, SABITLER, OkeyBilgi } from "@/lib/okey/melds";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ action: string }> };

const hata = (mesaj: string, kod = 400) =>
  NextResponse.json({ ok: false, hata: mesaj }, { status: kod });

export async function POST(req: NextRequest, ctx: Ctx) {
  const { action } = await ctx.params;
  const db = supabaseAdmin();
  const body = await req.json().catch(() => ({}));

  // Durumları oku (tek masa: id=1)
  const [{ data: pub }, { data: prv }] = await Promise.all([
    db.from("game_public").select("*").eq("id", 1).single(),
    db.from("game_private").select("*").eq("id", 1).single(),
  ]);
  if (!pub || !prv) return hata("Masa bulunamadı — schema.sql çalıştırıldı mı?", 500);

  // ── GİRİŞ ──────────────────────────────────────────────
  if (action === "giris") {
    const { ad, sifre } = body as { ad?: string; sifre?: string };
    if (!ad?.trim()) return hata("Kullanıcı adı gerekli");
    if (sifre !== process.env.MASA_SIFRESI) return hata("Şifre yanlış", 401);

    const adT = ad.trim().slice(0, 16);
    const oyuncular: { koltuk: number; ad: string }[] = pub.oyuncular ?? [];
    const tokenlar: Record<string, string> = prv.tokenlar ?? {};

    // Aynı adla dönen oyuncu → koltuğunu geri ver (yeniden bağlanma)
    let koltuk = oyuncular.find((o) => o.ad === adT)?.koltuk ?? -1;
    if (koltuk === -1) {
      const dolu = new Set(oyuncular.map((o) => o.koltuk));
      koltuk = [0, 1, 2, 3].find((k) => !dolu.has(k)) ?? -1;
      if (koltuk === -1) return hata("Masa dolu (4/4)", 409);
      oyuncular.push({ koltuk, ad: adT });
    }
    const token = globalThis.crypto.randomUUID();
    tokenlar[String(koltuk)] = token;

    await Promise.all([
      db.from("game_public").update({ oyuncular }).eq("id", 1),
      db.from("game_private").update({ tokenlar }).eq("id", 1),
    ]);
    return NextResponse.json({ ok: true, token, koltuk, ad: adT });
  }

  // ── Diğer tüm aksiyonlar token ister ───────────────────
  const token = req.headers.get("x-oyuncu-token") ?? body.token;
  const koltukStr = Object.entries(prv.tokenlar ?? {}).find(([, t]) => t === token)?.[0];
  if (koltukStr === undefined) return hata("Oturum geçersiz — tekrar giriş yapın", 401);
  const koltuk = Number(koltukStr);

  const eller: Tas[][] = prv.eller;
  const yigin: Tas[] = prv.yigin;
  const okey: OkeyBilgi | null = pub.okey;
  const olay = (tip: string, mesaj: string) => ({ tip, koltuk, mesaj, ts: Date.now() });

  // ── DURUM: kendi elini getir ───────────────────────────
  if (action === "durum") {
    return NextResponse.json({ ok: true, koltuk, el: eller[koltuk] ?? [] });
  }

  // ── SIFIRLA: masayı tamamen sıfırla (herkes lobiye) ────
  if (action === "sifirla") {
    await Promise.all([
      db.from("game_public").update({
        faz: "lobi", sira: null, cekti: false, gosterge: null, okey: null,
        yigin_sayisi: 0, el_sayilari: [0, 0, 0, 0], atilanlar: [[], [], [], []],
        acilan_perler: [], acanlar: [false, false, false, false],
        skorlar: [0, 0, 0, 0], el_no: 0, oyuncular: [],
        son_olay: olay("sifirla", "Masa sıfırlandı"),
      }).eq("id", 1),
      db.from("game_private").update({
        yigin: [], eller: [[], [], [], []], tokenlar: {},
      }).eq("id", 1),
    ]);
    return NextResponse.json({ ok: true });
  }

  // ── BAŞLA: yeni el dağıt ───────────────────────────────
  if (action === "basla") {
    if ((pub.oyuncular ?? []).length < 4) return hata("4 oyuncu gerekli");
    if (pub.faz === "oyun") return hata("El zaten devam ediyor");

    // İlk eli rastgele oyuncu, sonrakileri sırayla bir sonraki başlatır
    const baslayan =
      pub.el_no === 0
        ? Number((globalThis.crypto.getRandomValues(new Uint32Array(1))[0]) % 4)
        : ((pub.baslayan ?? 0) + 1) % 4;

    const d = dagit(baslayan);
    await Promise.all([
      db.from("game_public").update({
        faz: "oyun", sira: baslayan, cekti: true, // başlayan 22 taşla başlar, çekmiş sayılır
        baslayan, gosterge: d.gosterge, okey: d.okey,
        yigin_sayisi: d.yigin.length,
        el_sayilari: d.eller.map((e) => e.length),
        atilanlar: [[], [], [], []], acilan_perler: [],
        acanlar: [false, false, false, false],
        el_no: (pub.el_no ?? 0) + 1,
        son_olay: olay("basla", `El ${(pub.el_no ?? 0) + 1} başladı`),
      }).eq("id", 1),
      db.from("game_private").update({ yigin: d.yigin, eller: d.eller }).eq("id", 1),
    ]);
    return NextResponse.json({ ok: true });
  }

  // Bundan sonrası aktif el ve sıra kontrolü ister
  if (pub.faz !== "oyun" || !okey) return hata("Aktif el yok");
  if (pub.sira !== koltuk) return hata("Sıra sizde değil");
  const el = eller[koltuk];

  // ── ÇEK: yığından veya önceki oyuncunun attığından ─────
  if (action === "cek") {
    if (pub.cekti) return hata("Bu tur zaten taş çektiniz");
    const kaynak = body.kaynak as "yigin" | "atilan";
    let tas: Tas | undefined;
    const atilanlar: Tas[][] = pub.atilanlar;

    if (kaynak === "yigin") {
      tas = yigin.pop();
      if (!tas) {
        // Yığın bitti → el berabere kapanır
        await db.from("game_public").update({
          faz: "el_sonu",
          son_olay: olay("berabere", "Yığın bitti — el berabere"),
        }).eq("id", 1);
        return NextResponse.json({ ok: true, berabere: true });
      }
    } else {
      const onceki = (koltuk + 3) % 4;
      tas = atilanlar[onceki].pop();
      if (!tas) return hata("Çekilecek atılmış taş yok");
    }

    el.push(tas);
    await Promise.all([
      db.from("game_public").update({
        cekti: true, yigin_sayisi: yigin.length, atilanlar,
        el_sayilari: eller.map((e) => e.length),
        son_olay: olay("cek", kaynak === "yigin" ? "Yığından çekti" : "Atılanı aldı"),
      }).eq("id", 1),
      db.from("game_private").update({ yigin, eller }).eq("id", 1),
    ]);
    return NextResponse.json({ ok: true, tas });
  }

  // ── AÇ: per(ler) indir — ilk açılışta 101 / 4 çift şartı ─
  if (action === "ac") {
    if (!pub.cekti) return hata("Önce taş çekmelisiniz");
    const grupIdler = body.gruplar as number[][];
    if (!Array.isArray(grupIdler) || grupIdler.length === 0) return hata("Grup seçilmedi");

    // id'leri elden taşlara çevir (her taş yalnızca bir grupta olabilir)
    const kullanildi = new Set<number>();
    const gruplar: Tas[][] = [];
    for (const idler of grupIdler) {
      const grup: Tas[] = [];
      for (const id of idler) {
        if (kullanildi.has(id)) return hata("Aynı taş iki grupta kullanılamaz");
        const t = el.find((x) => x.id === id);
        if (!t) return hata("Taş elinizde değil");
        kullanildi.add(id);
        grup.push(t);
      }
      gruplar.push(grup);
    }

    const acanlar: boolean[] = pub.acanlar;
    const acilan: { koltuk: number; taslar: Tas[]; tip: string }[] = pub.acilan_perler;

    if (!acanlar[koltuk]) {
      // İLK açılış: 101 puan veya en az 4 çift
      const s = acmaKontrol(gruplar, okey);
      if (!s.gecerli) return hata(s.hata ?? "Açılamaz");
      for (const g of gruplar) acilan.push({ koltuk, taslar: g, tip: s.tip! });
      acanlar[koltuk] = true;
    } else {
      // Sonraki turlar: her grup tek başına geçerli per/çift olmalı
      for (const g of gruplar) {
        const p = perKontrol(g, okey);
        const c = ciftMi(g, okey);
        if (!p.gecerli && !c.gecerli) return hata(p.hata ?? "Geçersiz per");
        acilan.push({ koltuk, taslar: g, tip: p.gecerli ? p.tip! : "cift" });
      }
    }

    eller[koltuk] = el.filter((t) => !kullanildi.has(t.id));

    await Promise.all([
      db.from("game_public").update({
        acilan_perler: acilan, acanlar,
        el_sayilari: eller.map((e) => e.length),
        son_olay: olay("ac", `${gruplar.length} per açtı`),
      }).eq("id", 1),
      db.from("game_private").update({ eller }).eq("id", 1),
    ]);
    return NextResponse.json({ ok: true });
  }

  // ── İŞLE: masadaki bir pere taş ekle (açmış oyuncu) ────
  if (action === "isle") {
    if (!pub.cekti) return hata("Önce taş çekmelisiniz");
    if (!pub.acanlar[koltuk]) return hata("İşlemek için önce açmalısınız");
    const { perIndex, tasId } = body as { perIndex: number; tasId: number };
    const acilan: { koltuk: number; taslar: Tas[]; tip: string }[] = pub.acilan_perler;
    const per = acilan[perIndex];
    if (!per) return hata("Per bulunamadı");
    if (per.tip === "cift") return hata("Çiftlere işlenmez");
    const tas = el.find((t) => t.id === tasId);
    if (!tas) return hata("Taş elinizde değil");

    const yeni = [...per.taslar, tas];
    const s = perKontrol(yeni, okey);
    if (!s.gecerli) return hata("Bu taş bu pere uymuyor");

    per.taslar = yeni;
    eller[koltuk] = el.filter((t) => t.id !== tasId);

    await Promise.all([
      db.from("game_public").update({
        acilan_perler: acilan,
        el_sayilari: eller.map((e) => e.length),
        son_olay: olay("isle", "Pere taş işledi"),
      }).eq("id", 1),
      db.from("game_private").update({ eller }).eq("id", 1),
    ]);
    return NextResponse.json({ ok: true });
  }

  // ── AT: taş at, sıra geçer — el 0'a inerse el biter ────
  if (action === "at") {
    if (!pub.cekti) return hata("Önce taş çekmelisiniz");
    const tasId = body.tasId as number;
    const idx = el.findIndex((t) => t.id === tasId);
    if (idx === -1) return hata("Taş elinizde değil");
    const [tas] = el.splice(idx, 1);

    const atilanlar: Tas[][] = pub.atilanlar;
    atilanlar[koltuk].push(tas);

    // BİTİŞ kontrolü
    if (el.length === 0) {
      if (!pub.acanlar[koltuk]) {
        el.push(tas); atilanlar[koltuk].pop();
        return hata("Açmadan bitilemez");
      }
      const okeyleBitti = okeyMi(tas, okey);
      const carpan = okeyleBitti ? SABITLER.OKEY_ATARAK_BITME_CARPAN : 1;
      const skorlar: number[] = [...pub.skorlar];
      for (let k = 0; k < 4; k++) {
        if (k === koltuk) continue;
        skorlar[k] += elCezasi(eller[k], okey, pub.acanlar[k]) * carpan;
      }
      await Promise.all([
        db.from("game_public").update({
          faz: "el_sonu", atilanlar, skorlar,
          el_sayilari: eller.map((e) => e.length),
          son_olay: olay("bitti", okeyleBitti ? "Okey atarak bitirdi! (2×)" : "Eli bitirdi"),
        }).eq("id", 1),
        db.from("game_private").update({ eller }).eq("id", 1),
      ]);
      return NextResponse.json({ ok: true, bitti: true });
    }

    await Promise.all([
      db.from("game_public").update({
        atilanlar, sira: (koltuk + 1) % 4, cekti: false,
        el_sayilari: eller.map((e) => e.length),
        son_olay: olay("at", "Taş attı"),
      }).eq("id", 1),
      db.from("game_private").update({ eller }).eq("id", 1),
    ]);
    return NextResponse.json({ ok: true });
  }

  return hata("Bilinmeyen aksiyon: " + action, 404);
}
