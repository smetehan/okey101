"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { SesliSohbet } from "@/lib/voice";
import { Tas, RENKLER, efektifTas } from "@/lib/okey/tiles";
import { OkeyBilgi, SABITLER } from "@/lib/okey/melds";
import { serileriBul, ciftleriBul, OtoSonuc } from "@/lib/okey/otodiz";
import { Tile, KapaliTas } from "@/components/Tile";

// ── Tipler ──────────────────────────────────────────────
interface PubState {
  faz: "lobi" | "oyun" | "el_sonu";
  oyuncular: { koltuk: number; ad: string }[];
  sira: number | null;
  cekti: boolean;
  baslayan: number | null;
  gosterge: Tas | null;
  okey: OkeyBilgi | null;
  yigin_sayisi: number;
  el_sayilari: number[];
  atilanlar: Tas[][];
  acilan_perler: { koltuk: number; taslar: Tas[]; tip: string }[];
  acanlar: boolean[];
  skorlar: number[];
  el_no: number;
  mod: "tekli" | "esli";
  katlamali: boolean;
  son_olay: { tip: string; koltuk: number; mesaj: string; ts: number } | null;
  updated_at: string;
}

const SLOT_SAYISI = 30; // 2 raf × 15

// ── Modül seviyesinde yardımcı komponentler ─────────────
function RakipKarti({
  ad, tasSayisi, sirada, acmis, konusuyor, skor, atilanlar, atilanTikla, alinabilir, kompakt, es,
}: {
  ad: string; tasSayisi: number; sirada: boolean; acmis: boolean;
  konusuyor: boolean; skor: number; atilanlar: Tas[];
  atilanTikla?: () => void; alinabilir?: boolean; kompakt?: boolean; es?: boolean;
}) {
  const son = atilanlar[atilanlar.length - 1];

  if (kompakt) {
    // Oyun sırasında: SADECE ikon + rozetler
    return (
      <div className={`rakip rakip--kompakt ${sirada ? "rakip--sirada" : ""}`}>
        <div className={`rakip__avatar ${konusuyor ? "konusuyor" : ""}`} title={`${ad} · ${skor} ceza`}>
          {ad ? ad[0].toUpperCase() : "?"}
          <span className="rakip__rozet">{tasSayisi}</span>
          {acmis && <span className="rakip__rozet rakip__rozet--acti">✓</span>}
        </div>
        {es && <span className="rakip__es">EŞİN</span>}
        <div
          className={`rakip__atilan ${alinabilir ? "rakip__atilan--alinabilir" : ""}`}
          onClick={alinabilir ? atilanTikla : undefined}
          role={alinabilir ? "button" : undefined}
        >
          {son ? <Tile tas={son} kucuk /> : <span className="rakip__atilan-bos" />}
        </div>
      </div>
    );
  }

  return (
    <div className={`rakip ${sirada ? "rakip--sirada" : ""}`}>
      <div className={`rakip__avatar ${konusuyor ? "konusuyor" : ""}`}>
        {ad ? ad[0].toUpperCase() : "?"}
      </div>
      <div className="rakip__bilgi">
        <span className="rakip__ad">{ad || "Bekleniyor"}{es ? " · eşin" : ""}</span>
        <span className="rakip__detay">
          {tasSayisi} taş · {skor} ceza {acmis ? "· açtı" : ""}
        </span>
      </div>
      <div
        className={`rakip__atilan ${alinabilir ? "rakip__atilan--alinabilir" : ""}`}
        onClick={alinabilir ? atilanTikla : undefined}
        role={alinabilir ? "button" : undefined}
      >
        {son ? <Tile tas={son} kucuk /> : <span className="rakip__atilan-bos" />}
      </div>
    </div>
  );
}

// ── Ana sayfa ───────────────────────────────────────────
export default function MasaPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [koltuk, setKoltuk] = useState<number>(-1);
  const [pub, setPub] = useState<PubState | null>(null);
  const [el, setEl] = useState<Tas[]>([]);
  const [slotlar, setSlotlar] = useState<(number | null)[]>(Array(SLOT_SAYISI).fill(null));
  const [secili, setSecili] = useState<number | null>(null);
  const [dizMod, setDizMod] = useState<"seri" | "cift" | null>(null);
  const [mesaj, setMesaj] = useState<string>("");
  const [sesAcik, setSesAcik] = useState(false);
  const [mikrofon, setMikrofon] = useState(true);
  const [konusanlar, setKonusanlar] = useState<Set<number>>(new Set());
  const [tamEkran, setTamEkran] = useState(false);
  const ses = useRef<SesliSohbet | null>(null);
  const kanal = useRef<RealtimeChannel | null>(null);

  const uyar = useCallback((m: string) => {
    setMesaj(m);
    setTimeout(() => setMesaj(""), 2600);
  }, []);

  // ── Tam ekran ──
  useEffect(() => {
    const dinle = () => setTamEkran(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", dinle);
    return () => document.removeEventListener("fullscreenchange", dinle);
  }, []);
  const tamEkranToggle = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen({ navigationUI: "hide" });
        try {
          const or = screen.orientation as ScreenOrientation & {
            lock?: (o: string) => Promise<void>;
          };
          await or.lock?.("landscape");
        } catch { /* iOS Safari desteklemez */ }
      }
    } catch { /* reddedilebilir */ }
  };

  // ── Oturum ──
  useEffect(() => {
    const t = localStorage.getItem("okey_token");
    const k = localStorage.getItem("okey_koltuk");
    if (!t || k === null) { router.replace("/"); return; }
    setToken(t); setKoltuk(Number(k));
  }, [router]);

  // ── Public durumu çek (değişmediyse render tetikleme) ──
  const pubYenile = useCallback(async () => {
    const { data } = await supabase.from("game_public").select("*").eq("id", 1).single();
    if (data) {
      setPub((eski) =>
        eski && eski.updated_at === (data as PubState).updated_at ? eski : (data as PubState)
      );
    }
  }, []);

  // ── SENKRONİZASYON: postgres_changes + broadcast + polling ──
  useEffect(() => {
    if (!token) return;
    let aktif = true;
    pubYenile();

    const k = supabase
      .channel("masa-sync", { config: { broadcast: { self: false } } })
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "game_public" },
        (p) => aktif && setPub(p.new as PubState))
      .on("broadcast", { event: "yenile" }, () => aktif && pubYenile())
      .subscribe();
    kanal.current = k;

    const zamanlayici = setInterval(() => aktif && pubYenile(), 3000);
    return () => {
      aktif = false;
      clearInterval(zamanlayici);
      supabase.removeChannel(k);
      kanal.current = null;
    };
  }, [token, pubYenile]);

  // ── API: başarılı hamlede herkese "yenile" yayınla ──
  const api = useCallback(async (aksiyon: string, body: object = {}) => {
    const r = await fetch(`/api/game/${aksiyon}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-oyuncu-token": token ?? "" },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!d.ok) {
      if (r.status === 401) { localStorage.removeItem("okey_token"); router.replace("/"); }
      uyar(d.hata ?? "Hata");
    } else if (aksiyon !== "durum") {
      pubYenile();
      kanal.current?.send({ type: "broadcast", event: "yenile", payload: {} });
    }
    return d;
  }, [token, router, uyar, pubYenile]);

  // ── Kendi elini çek ──
  const elImza = pub ? `${pub.el_no}-${pub.el_sayilari?.[koltuk]}-${pub.faz}` : "";
  useEffect(() => {
    if (!token || koltuk < 0 || !pub) return;
    api("durum").then((d) => { if (d.ok) setEl(d.el); });
  }, [token, koltuk, elImza]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── OTOMATİK DİZME: aktif modda seriler/çiftler anlık bulunur ──
  const bulgu: OtoSonuc | null = useMemo(() => {
    if (!pub?.okey || !dizMod || el.length === 0) return null;
    return dizMod === "seri" ? serileriBul(el, pub.okey) : ciftleriBul(el, pub.okey);
  }, [dizMod, el, pub?.okey]);

  // Bulunan grupları istakaya diz: gruplar arasında 1 boşluk, kalanlar sonda sıralı
  const istakayaDiz = useCallback((b: OtoSonuc, okey: OkeyBilgi) => {
    const yeni: (number | null)[] = Array(SLOT_SAYISI).fill(null);
    const tasAdedi = b.gruplar.flat().length + b.kalan.length;
    const boslukVar = tasAdedi + b.gruplar.length <= SLOT_SAYISI;
    let i = 0;
    const koy = (id: number) => { if (i < SLOT_SAYISI) yeni[i++] = id; };
    for (const g of b.gruplar) {
      g.forEach((t) => koy(t.id));
      if (boslukVar) i++;
    }
    const sirali = [...b.kalan].sort((a, c) => {
      const ea = efektifTas(a, okey), ec = efektifTas(c, okey);
      const ra = RENKLER.indexOf(ea.renk), rc = RENKLER.indexOf(ec.renk);
      return ra !== rc ? ra - rc : ea.sayi - ec.sayi;
    });
    sirali.forEach((t) => koy(t.id));
    setSlotlar(yeni);
  }, []);

  // Mod aktifken el her değiştiğinde (çekince/atınca) otomatik yeniden diz
  useEffect(() => {
    if (bulgu && pub?.okey) istakayaDiz(bulgu, pub.okey);
    else if (!dizMod) {
      // mod kapalı: yeni taşları boş slota yerleştir, gidenleri temizle
      setSlotlar((eski) => {
        const idler = new Set(el.map((t) => t.id));
        const yeni = eski.map((id) => (id !== null && idler.has(id) ? id : null));
        const yerlesik = new Set(yeni.filter((x): x is number => x !== null));
        for (const t of el) {
          if (!yerlesik.has(t.id)) {
            const bos = yeni.indexOf(null);
            if (bos >= 0) { yeni[bos] = t.id; yerlesik.add(t.id); }
          }
        }
        return yeni;
      });
    }
    setSecili((s) => (s !== null && el.some((t) => t.id === s) ? s : null));
  }, [el, bulgu, dizMod, istakayaDiz, pub?.okey]);

  // ── Ses ──
  const sesBaslat = async () => {
    if (ses.current) return;
    const s = new SesliSohbet(koltuk);
    s.onKonusma = (k, aktif) =>
      setKonusanlar((eski) => {
        const y = new Set(eski);
        if (aktif) y.add(k); else y.delete(k);
        return y;
      });
    s.onDurum = uyar;
    const tamam = await s.baslat();
    if (tamam) { ses.current = s; setSesAcik(true); }
  };
  const mikrofonToggle = () => {
    if (!ses.current) return;
    const yeni = !mikrofon;
    setMikrofon(yeni);
    ses.current.sustur(!yeni);
  };
  useEffect(() => () => ses.current?.kapat(), []);

  // ── Türetilmiş durum ──
  const tasMap = useMemo(() => new Map(el.map((t) => [t.id, t])), [el]);
  const benimSiram = pub?.faz === "oyun" && pub.sira === koltuk;
  const cekebilir = benimSiram && !pub!.cekti;
  const atabilir = benimSiram && pub!.cekti && secili !== null;
  const oncekiKoltuk = (koltuk + 3) % 4;
  const acmisim = pub?.acanlar?.[koltuk] ?? false;

  const seriKalan = bulgu ? Math.max(0, SABITLER.ACMA_PUANI - bulgu.toplam) : 0;
  const ciftKalan = bulgu ? Math.max(0, SABITLER.MIN_CIFT_ACMA - bulgu.ciftSayisi) : 0;
  const acilabilir =
    !!bulgu && bulgu.gruplar.length > 0 && benimSiram && pub!.cekti &&
    (acmisim ||
      (dizMod === "seri" && bulgu.toplam >= SABITLER.ACMA_PUANI) ||
      (dizMod === "cift" && bulgu.ciftSayisi >= SABITLER.MIN_CIFT_ACMA));

  // Grupların istaka üstünde işaretlenmesi için: id → grup no
  const grupHarita = useMemo(() => {
    const m = new Map<number, number>();
    bulgu?.gruplar.forEach((g, i) => g.forEach((t) => m.set(t.id, i)));
    return m;
  }, [bulgu]);

  // ── Etkileşimler ──
  const tasTikla = (id: number) => setSecili((s) => (s === id ? null : id));
  const slotTikla = (slotIdx: number) => {
    if (secili === null || slotlar[slotIdx] !== null) return;
    const id = secili;
    setDizMod(null); // elle taşıma otomatik dizmeyi kapatır
    setSlotlar((eski) => {
      const y = [...eski];
      const kaynak = y.indexOf(id);
      if (kaynak >= 0) y[kaynak] = null;
      y[slotIdx] = id;
      return y;
    });
    setSecili(null);
  };
  const ac = async () => {
    if (!bulgu) return;
    const d = await api("ac", { gruplar: bulgu.gruplar.map((g) => g.map((t) => t.id)) });
    if (d.ok) uyar("Açıldı!");
  };
  const isle = async (perIndex: number) => {
    if (secili === null) { uyar("İşlemek için elinden bir taş seç"); return; }
    await api("isle", { perIndex, tasId: secili });
    setSecili(null);
  };
  const at = async () => {
    if (secili === null) return;
    const d = await api("at", { tasId: secili });
    if (d.ok) setSecili(null);
  };

  if (!pub) return <div className="yukleniyor">Masa hazırlanıyor…</div>;

  // Koltuk yerleşimi: ben altta; sıra yönünde sağ → üst → sol (hepsi üst boşlukta)
  const sag = (koltuk + 1) % 4, ust = (koltuk + 2) % 4, sol = (koltuk + 3) % 4;
  const oyuncuAd = (k: number) => pub.oyuncular.find((o) => o.koltuk === k)?.ad ?? "";
  const esli = pub.mod === "esli";
  const rakip = (k: number, es = false) => (
    <div className="rakipler__hucre" key={k}>
      <RakipKarti
        es={es}
        ad={oyuncuAd(k)}
        tasSayisi={pub.el_sayilari?.[k] ?? 0}
        sirada={pub.faz === "oyun" && pub.sira === k}
        acmis={pub.acanlar?.[k] ?? false}
        konusuyor={konusanlar.has(k)}
        skor={pub.skorlar?.[k] ?? 0}
        atilanlar={pub.atilanlar?.[k] ?? []}
        alinabilir={k === oncekiKoltuk && cekebilir && (pub.atilanlar?.[k]?.length ?? 0) > 0}
        atilanTikla={() => api("cek", { kaynak: "atilan" })}
        kompakt={pub.faz === "oyun"}
      />
    </div>
  );

  return (
    <main className="masa">
      <div className="dondur">
        <span className="dondur__ikon">⟳</span>
        Telefonu yan çevirin
      </div>

      <header className="ustbar">
        <span className="ustbar__logo">101</span>
        <span className="ustbar__el">
          El {pub.el_no || "—"} · {esli ? "Eşli" : "Tekli"}{pub.katlamali ? " · Katlamalı" : ""}
        </span>
        {pub.son_olay && (
          <span className="ustbar__olay">
            {oyuncuAd(pub.son_olay.koltuk)}: {pub.son_olay.mesaj}
          </span>
        )}
        <div className="ustbar__ses">
          <button className="btn btn--kucuk btn--ikon" onClick={tamEkranToggle}
            aria-label={tamEkran ? "Tam ekrandan çık" : "Tam ekran"}>
            {tamEkran ? "🡼" : "⛶"}
          </button>
          {!sesAcik ? (
            <button className="btn btn--kucuk" onClick={sesBaslat}>🎙 Sese katıl</button>
          ) : (
            <button className={`btn btn--kucuk ${!mikrofon ? "btn--kirmizi" : ""}`} onClick={mikrofonToggle}>
              {mikrofon ? "🎙 Açık" : "🔇 Kapalı"}
            </button>
          )}
        </div>
      </header>

      <div className="rakipler">
        {rakip(sol)}
        {rakip(ust, esli)}
        {rakip(sag)}
      </div>

      <section className="cuha">
        {pub.faz === "lobi" && (
          <div className="panel">
            <h2>Masa: {pub.oyuncular.length}/4</h2>
            <ul className="panel__liste">
              {pub.oyuncular.map((o) => (
                <li key={o.koltuk}>
                  {o.ad}{esli ? ` — Takım ${o.koltuk % 2 === 0 ? "A" : "B"}` : ""}
                </li>
              ))}
            </ul>
            <div className="ayar-grup">
              <button className={`ayar-btn ${!esli ? "ayar-btn--aktif" : ""}`}
                onClick={() => api("ayar", { mod: "tekli", katlamali: pub.katlamali })}>Tekli</button>
              <button className={`ayar-btn ${esli ? "ayar-btn--aktif" : ""}`}
                onClick={() => api("ayar", { mod: "esli", katlamali: pub.katlamali })}>Eşli</button>
              <span className="ayar-ayrac" />
              <button className={`ayar-btn ${!pub.katlamali ? "ayar-btn--aktif" : ""}`}
                onClick={() => api("ayar", { mod: pub.mod, katlamali: false })}>Katlamasız</button>
              <button className={`ayar-btn ${pub.katlamali ? "ayar-btn--aktif" : ""}`}
                onClick={() => api("ayar", { mod: pub.mod, katlamali: true })}>Katlamalı</button>
            </div>
            {esli && <p className="panel__not">Eşler karşılıklı oturur: {"0-2 (A)"} ve {"1-3 (B)"} — karşındaki eşindir</p>}
            {pub.oyuncular.length === 4 && (
              <button className="btn btn--buyuk" onClick={() => api("basla")}>Eli Dağıt</button>
            )}
          </div>
        )}

        {pub.faz === "el_sonu" && (
          <div className="panel">
            <h2>El bitti</h2>
            {esli && (
              <p className="panel__takim">
                Biz: <b>{(pub.skorlar[koltuk % 2] ?? 0) + (pub.skorlar[(koltuk % 2) + 2] ?? 0)}</b>
                {" — "}
                Onlar: <b>{(pub.skorlar[(koltuk + 1) % 2] ?? 0) + (pub.skorlar[((koltuk + 1) % 2) + 2] ?? 0)}</b>
              </p>
            )}
            <ul className="panel__liste">
              {pub.oyuncular.map((o) => (
                <li key={o.koltuk}>{o.ad}: {pub.skorlar[o.koltuk]} ceza</li>
              ))}
            </ul>
            <button className="btn btn--buyuk" onClick={() => api("basla")}>Yeni El</button>
          </div>
        )}

        {pub.faz === "oyun" && (
          <>
            <div className="orta-alan">
              <button
                className={`yigin ${cekebilir ? "yigin--aktif" : ""}`}
                onClick={() => cekebilir && api("cek", { kaynak: "yigin" })}
              >
                <KapaliTas />
                <span className="yigin__sayi">{pub.yigin_sayisi}</span>
              </button>
              <div className="gosterge">
                {pub.gosterge && <Tile tas={pub.gosterge} kucuk />}
                <span className="gosterge__etiket">gösterge</span>
              </div>
            </div>

            <div className="perler">
              {pub.acilan_perler.map((p, i) => (
                <div
                  key={i}
                  className={`per ${benimSiram && acmisim && p.tip !== "cift" ? "per--islenir" : ""}`}
                  onClick={() => benimSiram && acmisim && p.tip !== "cift" && isle(i)}
                >
                  <span className="per__sahip">{oyuncuAd(p.koltuk)}</span>
                  {p.taslar.map((t) => <Tile key={t.id} tas={t} kucuk />)}
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <div className="aksiyonlar">
        {mesaj && <span className="aksiyonlar__mesaj">{mesaj}</span>}
        {!mesaj && pub.faz === "oyun" && dizMod && bulgu && (
          <span className="ozet__yazi">
            {dizMod === "seri"
              ? <>Toplam <b>{bulgu.toplam}</b>{!acmisim && (
                  seriKalan > 0 ? <> · <b>{seriKalan}</b> kaldı</> : <> ✓</>
                )}</>
              : <><b>{bulgu.ciftSayisi}</b> çift · {bulgu.toplam}{!acmisim && (
                  ciftKalan > 0 ? <> · <b>{ciftKalan}</b> çift kaldı</> : <> ✓</>
                )}</>}
          </span>
        )}
        {!mesaj && benimSiram && !pub.cekti && <span className="ipucu">Yığından veya soldan taş çek</span>}
        {pub.faz === "oyun" && dizMod && bulgu && (
          <button className="btn" disabled={!acilabilir} onClick={ac}>AÇ</button>
        )}
        <button
          className={`btn ${dizMod === "seri" ? "btn--aktif" : ""}`}
          onClick={() => setDizMod((m) => (m === "seri" ? null : "seri"))}
        >Seri Diz</button>
        <button
          className={`btn ${dizMod === "cift" ? "btn--aktif" : ""}`}
          onClick={() => setDizMod((m) => (m === "cift" ? null : "cift"))}
        >Çift Diz</button>
        <button className="btn btn--kirmizi" disabled={!atabilir} onClick={at}>At</button>
      </div>

      <footer className={`istaka ${benimSiram ? "istaka--sirada" : ""}`}>
        {[0, 1].map((raf) => (
          <div className="istaka__raf" key={raf}>
            {slotlar.slice(raf * 15, raf * 15 + 15).map((id, i) => {
              const slotIdx = raf * 15 + i;
              const t = id !== null ? tasMap.get(id) : null;
              return t ? (
                <span key={t.id} className={grupHarita.has(t.id) ? "tas-grupta" : undefined}>
                  <Tile tas={t} secili={secili === t.id} onClick={() => tasTikla(t.id)} />
                </span>
              ) : (
                <span key={`bos-${slotIdx}`} className="istaka__bos" onClick={() => slotTikla(slotIdx)} />
              );
            })}
          </div>
        ))}
      </footer>
    </main>
  );
}
