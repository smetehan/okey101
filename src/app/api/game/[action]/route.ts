import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { dagit, okeyMi, Tas } from "@/lib/okey/tiles";
import { acmaKontrol, perKontrol, ciftMi, elCezasi, SABITLER, OkeyBilgi } from "@/lib/okey/melds";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ action: string }> };

const hata = (mesaj: string, kod = 400) =>
  NextResponse.json({ ok: false, hata: mesaj }, { status: kod });

const sifreGecerli = (sifre?: string) =>
  sifre === process.env.MASA_SIFRESI ||
  (!!process.env.ADMIN_SIFRESI && sifre === process.env.ADMIN_SIFRESI);

const superAdminMi = (sifre?: string) =>
  !!process.env.ADMIN_SIFRESI && sifre === process.env.ADMIN_SIFRESI;

export async function POST(req: NextRequest, ctx: Ctx) {
  const { action } = await ctx.params;
  const db = supabaseAdmin();
  const body = await req.json().catch(() => ({}));

  // ── KİM: şifreyi doğrula, rolü söyle (giriş ekranı yönlendirmesi) ──
  if (action === "kim") {
    const { sifre } = body as { sifre?: string };
    if (!sifreGecerli(sifre)) return hata("Şifre yanlış", 401);
    return NextResponse.json({ ok: true, admin: superAdminMi(sifre) });
  }

  // ── PANEL: süper admin masa açar (boş masa, katılıma açık) ──
  if (action === "masaac") {
    const { sifre, masaAdi } = body as { sifre?: string; masaAdi?: string };
    if (!superAdminMi(sifre)) return hata("Yetkisiz", 403);
    const masaAdiT = (masaAdi ?? "").trim().slice(0, 24) || "Yeni Masa";
    const { data: yeni, error } = await db
      .from("game_public")
      .insert({ masa_adi: masaAdiT, masa_acik: true })
      .select("id")
      .single();
    if (error || !yeni) return hata("Masa açılamadı: " + (error?.message ?? ""), 500);
    await db.from("game_private").insert({ id: yeni.id });
    return NextResponse.json({ ok: true, masaId: yeni.id });
  }

  // ── PANEL: masa aç/kapa ──
  if (action === "panelmasa") {
    const { sifre, masaId: mid, acik } = body as { sifre?: string; masaId?: number; acik?: boolean };
    if (!superAdminMi(sifre)) return hata("Yetkisiz", 403);
    const guncel: Record<string, unknown> = { masa_acik: !!acik };
    if (!acik) guncel.bekleyenler = [];
    await db.from("game_public").update(guncel).eq("id", Number(mid));
    if (!acik) await db.from("game_private").update({ bekleyen_tokenlar: {} }).eq("id", Number(mid));
    return NextResponse.json({ ok: true });
  }

  // ── PANEL: masa sil ──
  if (action === "panelsil") {
    const { sifre, masaId: mid } = body as { sifre?: string; masaId?: number };
    if (!superAdminMi(sifre)) return hata("Yetkisiz", 403);
    await db.from("game_public").delete().eq("id", Number(mid));
    return NextResponse.json({ ok: true });
  }

  // ── Masa kapsamı: diğer tüm aksiyonlar masaId ister ────
  const masaId = Number(body.masaId);
  if (!masaId) return hata("masaId gerekli");

  const [{ data: pub }, { data: prv }] = await Promise.all([
    db.from("game_public").select("*").eq("id", masaId).maybeSingle(),
    db.from("game_private").select("*").eq("id", masaId).maybeSingle(),
  ]);
  if (!pub || !prv) return hata("Masa bulunamadı — silinmiş olabilir", 404);

  const oyuncular: { koltuk: number; ad: string }[] = pub.oyuncular ?? [];
  const tokenlar: Record<string, string> = prv.tokenlar ?? {};
  const adminKoltuklar: number[] = prv.admin_koltuklar ?? [];
  const bekleyenler: { istekId: string; ad: string }[] = pub.bekleyenler ?? [];
  const bekleyenTokenlar: Record<string, string> = prv.bekleyen_tokenlar ?? {};

  // ── GİRİŞ (mevcut masaya) ──────────────────────────────
  if (action === "giris") {
    const { ad, sifre } = body as { ad?: string; sifre?: string };
    if (!ad?.trim()) return hata("Kullanıcı adı gerekli");
    if (!sifreGecerli(sifre)) return hata("Şifre yanlış", 401);
    const adT = ad.trim().slice(0, 16);
    const superAdmin = superAdminMi(sifre);
    const token = globalThis.crypto.randomUUID();

    // Yeniden bağlanma: adı koltukta olan token'ını yeniler (admin yetkisi koltukta kalır)
    const mevcut = oyuncular.find((o) => o.ad === adT);
    if (mevcut) {
      tokenlar[String(mevcut.koltuk)] = token;
      if (superAdmin && !adminKoltuklar.includes(mevcut.koltuk)) adminKoltuklar.push(mevcut.koltuk);
      await db.from("game_private")
        .update({ tokenlar, admin_koltuklar: adminKoltuklar }).eq("id", masaId);
      return NextResponse.json({
        ok: true, token, koltuk: mevcut.koltuk, masaId, ad: adT,
        admin: adminKoltuklar.includes(mevcut.koltuk),
      });
    }

    // BOŞ MASAYA İLK OTURAN o masanın admini olur
    if (oyuncular.length === 0) {
      oyuncular.push({ koltuk: 0, ad: adT });
      tokenlar["0"] = token;
      const yeniAdminler = superAdmin ? [0] : [0];
      await Promise.all([
        db.from("game_public").update({
          oyuncular,
          son_olay: { tip: "admin", koltuk: 0, mesaj: `${adT} masanın admini oldu`, ts: Date.now() },
        }).eq("id", masaId),
        db.from("game_private").update({ tokenlar, admin_koltuklar: yeniAdminler }).eq("id", masaId),
      ]);
      return NextResponse.json({ ok: true, token, koltuk: 0, masaId, ad: adT, admin: true });
    }

    // Süper admin: onaysız, masa kapalı olsa bile oturur
    if (superAdmin) {
      const dolu = new Set(oyuncular.map((o) => o.koltuk));
      const koltuk = [0, 1, 2, 3].find((k) => !dolu.has(k));
      if (koltuk === undefined) return hata("Masa dolu (4/4)", 409);
      oyuncular.push({ koltuk, ad: adT });
      tokenlar[String(koltuk)] = token;
      adminKoltuklar.push(koltuk);
      await Promise.all([
        db.from("game_public").update({ oyuncular }).eq("id", masaId),
        db.from("game_private").update({ tokenlar, admin_koltuklar: adminKoltuklar }).eq("id", masaId),
      ]);
      return NextResponse.json({ ok: true, token, koltuk, masaId, ad: adT, admin: true });
    }

    // Normal oyuncu: masa açık olmalı, masa adminin onayına düşer
    if (!pub.masa_acik) return hata("Bu masa şu an kapalı", 403);
    const istekId = globalThis.crypto.randomUUID();
    const eski = bekleyenler.find((b) => b.ad === adT);
    if (eski) {
      delete bekleyenTokenlar[eski.istekId];
      eski.istekId = istekId;
    } else {
      bekleyenler.push({ istekId, ad: adT });
    }
    bekleyenTokenlar[istekId] = token;
    await Promise.all([
      db.from("game_public").update({ bekleyenler }).eq("id", masaId),
      db.from("game_private").update({ bekleyen_tokenlar: bekleyenTokenlar }).eq("id", masaId),
    ]);
    return NextResponse.json({ ok: true, beklemede: true, token, masaId, ad: adT });
  }

  // ── Token çözümle ──────────────────────────────────────
  const token = req.headers.get("x-oyuncu-token") ?? body.token;

  // ── BEKLE: onay bekleyen oyuncu durumunu sorar ─────────
  if (action === "bekle") {
    const koltukStr = Object.entries(tokenlar).find(([, t]) => t === token)?.[0];
    if (koltukStr !== undefined)
      return NextResponse.json({ ok: true, koltuk: Number(koltukStr) });
    const istekId = Object.entries(bekleyenTokenlar).find(([, t]) => t === token)?.[0];
    if (istekId && bekleyenler.some((b) => b.istekId === istekId))
      return NextResponse.json({ ok: true, beklemede: true });
    return hata("İstek reddedildi veya bulunamadı", 410);
  }

  const koltukStr = Object.entries(tokenlar).find(([, t]) => t === token)?.[0];
  if (koltukStr === undefined) return hata("Oturum geçersiz — tekrar giriş yapın", 401);
  const koltuk = Number(koltukStr);
  const adminMi = adminKoltuklar.includes(koltuk);

  const eller: Tas[][] = prv.eller ?? [[], [], [], []];
  const yigin: Tas[] = prv.yigin ?? [];
  const okey: OkeyBilgi | null = pub.okey;
  const olay = (tip: string, mesaj: string) => ({ tip, koltuk, mesaj, ts: Date.now() });

  // ── DURUM: kendi elini getir ───────────────────────────
  if (action === "durum") {
    return NextResponse.json({ ok: true, koltuk, el: eller[koltuk] ?? [], admin: adminMi });
  }

  // ═══════════ ADMİN AKSİYONLARI ═══════════
  if (["masa", "kabul", "reddet", "yenioyun", "sifirla", "masasil", "ayar", "basla"].includes(action) && !adminMi)
    return hata("Bu işlem için admin yetkisi gerekir", 403);

  // ── MASA: aç / kapat ──
  if (action === "masa") {
    const acik = !!body.acik;
    const guncelPub: Record<string, unknown> = {
      masa_acik: acik,
      son_olay: olay("masa", acik ? "Masa açıldı" : "Masa kapatıldı"),
    };
    if (!acik) guncelPub.bekleyenler = [];
    await Promise.all([
      db.from("game_public").update(guncelPub).eq("id", masaId),
      acik
        ? Promise.resolve()
        : db.from("game_private").update({ bekleyen_tokenlar: {} }).eq("id", masaId),
    ]);
    return NextResponse.json({ ok: true });
  }

  // ── KABUL ──
  if (action === "kabul") {
    const { istekId } = body as { istekId: string };
    const idx = bekleyenler.findIndex((b) => b.istekId === istekId);
    if (idx === -1) return hata("İstek bulunamadı");
    const dolu = new Set(oyuncular.map((o) => o.koltuk));
    const yeniKoltuk = [0, 1, 2, 3].find((k) => !dolu.has(k));
    if (yeniKoltuk === undefined) return hata("Masa dolu (4/4)");
    const [istek] = bekleyenler.splice(idx, 1);
    oyuncular.push({ koltuk: yeniKoltuk, ad: istek.ad });
    tokenlar[String(yeniKoltuk)] = bekleyenTokenlar[istekId];
    delete bekleyenTokenlar[istekId];
    await Promise.all([
      db.from("game_public").update({
        oyuncular, bekleyenler,
        son_olay: olay("kabul", `${istek.ad} masaya kabul edildi`),
      }).eq("id", masaId),
      db.from("game_private").update({ tokenlar, bekleyen_tokenlar: bekleyenTokenlar }).eq("id", masaId),
    ]);
    return NextResponse.json({ ok: true });
  }

  // ── REDDET ──
  if (action === "reddet") {
    const { istekId } = body as { istekId: string };
    const idx = bekleyenler.findIndex((b) => b.istekId === istekId);
    if (idx === -1) return hata("İstek bulunamadı");
    bekleyenler.splice(idx, 1);
    delete bekleyenTokenlar[istekId];
    await Promise.all([
      db.from("game_public").update({ bekleyenler }).eq("id", masaId),
      db.from("game_private").update({ bekleyen_tokenlar: bekleyenTokenlar }).eq("id", masaId),
    ]);
    return NextResponse.json({ ok: true });
  }

  // ── YENİ OYUN: skorlar sıfır, oyuncular kalır ──
  if (action === "yenioyun") {
    await Promise.all([
      db.from("game_public").update({
        faz: "lobi", sira: null, cekti: false, gosterge: null, okey: null,
        yigin_sayisi: 0, el_sayilari: [0, 0, 0, 0], atilanlar: [[], [], [], []],
        acilan_perler: [], acanlar: [false, false, false, false],
        skorlar: [0, 0, 0, 0], el_no: 0,
        son_olay: olay("yenioyun", "Yeni oyun — skorlar sıfırlandı"),
      }).eq("id", masaId),
      db.from("game_private").update({ yigin: [], eller: [[], [], [], []] }).eq("id", masaId),
    ]);
    return NextResponse.json({ ok: true });
  }

  // ── SIFIRLA: masa boşalır ama silinmez ──
  if (action === "sifirla") {
    await Promise.all([
      db.from("game_public").update({
        faz: "lobi", sira: null, cekti: false, gosterge: null, okey: null,
        yigin_sayisi: 0, el_sayilari: [0, 0, 0, 0], atilanlar: [[], [], [], []],
        acilan_perler: [], acanlar: [false, false, false, false],
        skorlar: [0, 0, 0, 0], el_no: 0, oyuncular: [], bekleyenler: [],
        masa_acik: false,
        son_olay: { tip: "sifirla", koltuk: -1, mesaj: "Masa sıfırlandı", ts: Date.now() },
      }).eq("id", masaId),
      db.from("game_private").update({
        yigin: [], eller: [[], [], [], []], tokenlar: {},
        bekleyen_tokenlar: {}, admin_koltuklar: [],
      }).eq("id", masaId),
    ]);
    return NextResponse.json({ ok: true });
  }

  // ── MASAYI SİL: satır silinir (private cascade ile gider) ──
  if (action === "masasil") {
    await db.from("game_public").delete().eq("id", masaId);
    return NextResponse.json({ ok: true });
  }

  // ── AYAR ──
  if (action === "ayar") {
    if (pub.faz === "oyun") return hata("El sürerken ayar değiştirilemez");
    const mod = body.mod === "esli" ? "esli" : "tekli";
    const katlamali = !!body.katlamali;
    const elHedef = Math.min(25, Math.max(1, Number(body.elHedef) || pub.el_hedef || 5));
    await db.from("game_public").update({
      mod, katlamali, el_hedef: elHedef,
      son_olay: olay("ayar", `${mod === "esli" ? "Eşli" : "Tekli"} · ${katlamali ? "Katlamalı" : "Katlamasız"} · ${elHedef} el`),
    }).eq("id", masaId);
    return NextResponse.json({ ok: true });
  }

  // ── BAŞLA ──
  if (action === "basla") {
    if (oyuncular.length < 4) return hata("4 oyuncu gerekli");
    if (pub.faz === "oyun") return hata("El zaten devam ediyor");
    if (pub.faz === "oyun_sonu") return hata("Oyun bitti — Yeni Oyun başlatın");

    const baslayan =
      pub.el_no === 0
        ? Number(globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % 4)
        : ((pub.baslayan ?? 0) + 1) % 4;

    const d = dagit(baslayan);
    await Promise.all([
      db.from("game_public").update({
        faz: "oyun", sira: baslayan, cekti: true,
        baslayan, gosterge: d.gosterge, okey: d.okey,
        yigin_sayisi: d.yigin.length,
        el_sayilari: d.eller.map((e) => e.length),
        atilanlar: [[], [], [], []], acilan_perler: [],
        acanlar: [false, false, false, false],
        el_no: (pub.el_no ?? 0) + 1,
        son_olay: olay("basla", `El ${(pub.el_no ?? 0) + 1} başladı`),
      }).eq("id", masaId),
      db.from("game_private").update({ yigin: d.yigin, eller: d.eller }).eq("id", masaId),
    ]);
    return NextResponse.json({ ok: true });
  }

  // ═══════════ OYUN AKSİYONLARI ═══════════
  if (pub.faz !== "oyun" || !okey) return hata("Aktif el yok");
  if (pub.sira !== koltuk) return hata("Sıra sizde değil");
  const el = eller[koltuk];

  // ── ÇEK ──
  if (action === "cek") {
    if (pub.cekti) return hata("Bu tur zaten taş çektiniz");
    const kaynak = body.kaynak as "yigin" | "atilan";
    let tas: Tas | undefined;
    const atilanlar: Tas[][] = pub.atilanlar;

    if (kaynak === "yigin") {
      tas = yigin.pop();
      if (!tas) {
        await db.from("game_public").update({
          faz: "el_sonu",
          son_olay: olay("berabere", "Yığın bitti — el berabere"),
        }).eq("id", masaId);
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
      }).eq("id", masaId),
      db.from("game_private").update({ yigin, eller }).eq("id", masaId),
    ]);
    return NextResponse.json({ ok: true, tas });
  }

  // ── AÇ ──
  if (action === "ac") {
    if (!pub.cekti) return hata("Önce taş çekmelisiniz");
    const grupIdler = body.gruplar as number[][];
    if (!Array.isArray(grupIdler) || grupIdler.length === 0) return hata("Grup seçilmedi");

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
      const s = acmaKontrol(gruplar, okey);
      if (!s.gecerli) return hata(s.hata ?? "Açılamaz");
      for (const g of gruplar) acilan.push({ koltuk, taslar: g, tip: s.tip! });
      acanlar[koltuk] = true;
    } else {
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
      }).eq("id", masaId),
      db.from("game_private").update({ eller }).eq("id", masaId),
    ]);
    return NextResponse.json({ ok: true });
  }

  // ── İŞLE ──
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
      }).eq("id", masaId),
      db.from("game_private").update({ eller }).eq("id", masaId),
    ]);
    return NextResponse.json({ ok: true });
  }

  // ── AT ──
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
      const ciftActi = (pub.acilan_perler as { koltuk: number; tip: string }[])
        .some((p) => p.koltuk === koltuk && p.tip === "cift");
      let carpan = okeyleBitti ? SABITLER.OKEY_ATARAK_BITME_CARPAN : 1;
      if (pub.katlamali && ciftActi) carpan *= 2;
      const esli = pub.mod === "esli";

      const skorlar: number[] = [...pub.skorlar];
      for (let k = 0; k < 4; k++) {
        if (k === koltuk) continue;
        if (esli && k % 2 === koltuk % 2) continue;
        skorlar[k] += elCezasi(eller[k], okey, pub.acanlar[k]) * carpan;
      }
      const notlar = [
        okeyleBitti ? "Okey atarak" : "",
        pub.katlamali && ciftActi ? "çiftten" : "",
      ].filter(Boolean).join(" + ");
      const oyunBitti = (pub.el_no ?? 1) >= (pub.el_hedef ?? 5);
      await Promise.all([
        db.from("game_public").update({
          faz: oyunBitti ? "oyun_sonu" : "el_sonu", atilanlar, skorlar,
          el_sayilari: eller.map((e) => e.length),
          son_olay: olay("bitti",
            oyunBitti
              ? `Oyun bitti! Son eli kazandı${notlar ? ` (${notlar}, ×${carpan})` : ""}`
              : `Eli bitirdi${notlar ? ` (${notlar}, ×${carpan})` : ""}`),
        }).eq("id", masaId),
        db.from("game_private").update({ eller }).eq("id", masaId),
      ]);
      return NextResponse.json({ ok: true, bitti: true });
    }

    await Promise.all([
      db.from("game_public").update({
        atilanlar, sira: (koltuk + 1) % 4, cekti: false,
        el_sayilari: eller.map((e) => e.length),
        son_olay: olay("at", "Taş attı"),
      }).eq("id", masaId),
      db.from("game_private").update({ eller }).eq("id", masaId),
    ]);
    return NextResponse.json({ ok: true });
  }

  return hata("Bilinmeyen aksiyon: " + action, 404);
}
