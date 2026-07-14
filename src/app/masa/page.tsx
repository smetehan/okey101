"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { SesliSohbet } from "@/lib/voice";
import { Tas } from "@/lib/okey/tiles";
import { perKontrol, ciftMi, OkeyBilgi, SABITLER } from "@/lib/okey/melds";
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
  son_olay: { tip: string; koltuk: number; mesaj: string; ts: number } | null;
  updated_at: string;
}

interface TaslakGrup {
  idler: number[];
  tip: "seri" | "cift";
  puan: number;
}

const SLOT_SAYISI = 30; // 2 raf × 15

// ── Modül seviyesinde yardımcı komponentler ─────────────
function RakipKarti({
  ad, tasSayisi, sirada, acmis, konusuyor, skor, atilanlar, atilanTikla, alinabilir, kompakt,
}: {
  ad: string; tasSayisi: number; sirada: boolean; acmis: boolean;
  konusuyor: boolean; skor: number; atilanlar: Tas[];
  atilanTikla?: () => void; alinabilir?: boolean; kompakt?: boolean;
}) {
  const son = atilanlar[atilanlar.length - 1];

  if (kompakt) {
    // Oyun sırasında: sadece ikon + rozetler, yer kaplamaz
    return (
      <div className={`rakip rakip--kompakt ${sirada ? "rakip--sirada" : ""}`}>
        <div className={`rakip__avatar ${konusuyor ? "konusuyor" : ""}`} title={`${ad} · ${skor} ceza`}>
          {ad ? ad[0].toUpperCase() : "?"}
          <span className="rakip__rozet">{tasSayisi}</span>
          {acmis && <span className="rakip__rozet rakip__rozet--acti">✓</span>}
        </div>
        <span className="rakip__ad-mini">{ad || "—"}</span>
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
        <span className="rakip__ad">{ad || "Bekleniyor"}</span>
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
  const [secili, setSecili] = useState<Set<number>>(new Set());
  const [taslak, setTaslak] = useState<TaslakGrup[]>([]);
  const [mesaj, setMesaj] = useState<string>("");
  const [sesAcik, setSesAcik] = useState(false);
  const [mikrofon, setMikrofon] = useState(true);
  const [konusanlar, setKonusanlar] = useState<Set<number>>(new Set());
  const [tamEkran, setTamEkran] = useState(false);
  const ses = useRef<SesliSohbet | null>(null);
  const kanal = useRef<RealtimeChannel | null>(null);

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
        // Tam ekrandayken yatay kilitle (destekleyen tarayıcılarda)
        try {
          const or = screen.orientation as ScreenOrientation & {
            lock?: (o: string) => Promise<void>;
          };
          await or.lock?.("landscape");
        } catch { /* iOS Safari desteklemez, sorun değil */ }
      }
    } catch { /* kullanıcı hareketi olmadan reddedilebilir */ }
  };

  const uyar = useCallback((m: string) => {
    setMesaj(m);
    setTimeout(() => setMesaj(""), 2600);
  }, []);

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

  // ── SENKRONİZASYON: 3 katman ──
  // 1) postgres_changes (Supabase Replication açıksa anlık)
  // 2) broadcast "yenile" (her hamle sonrası hamleyi yapan yayınlar — replication'a muhtaç değil)
  // 3) 3 sn'de bir polling (her ihtimale karşı emniyet kemeri)
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

  // ── API çağrısı: başarılı hamlede herkese "yenile" yayınla ──
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
      pubYenile(); // kendim hemen göreyim
      kanal.current?.send({ type: "broadcast", event: "yenile", payload: {} }); // diğerleri de
    }
    return d;
  }, [token, router, uyar, pubYenile]);

  // ── Kendi elini çek (durum değiştikçe) ──
  const elImza = pub ? `${pub.el_no}-${pub.el_sayilari?.[koltuk]}-${pub.faz}` : "";
  useEffect(() => {
    if (!token || koltuk < 0 || !pub) return;
    api("durum").then((d) => { if (d.ok) setEl(d.el); });
  }, [token, koltuk, elImza]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── İstaka düzeni: yeni taşları yerleştir, gidenleri temizle ──
  useEffect(() => {
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
    setSecili((s) => new Set([...s].filter((id) => el.some((t) => t.id === id))));
    setTaslak((p) => p.filter((g) => g.idler.every((id) => el.some((t) => t.id === id))));
  }, [el]);

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
  const atabilir = benimSiram && pub!.cekti && secili.size === 1;
  const oncekiKoltuk = (koltuk + 3) % 4;
  const acmisim = pub?.acanlar?.[koltuk] ?? false;

  // Seçili taşların seri/çift olarak anlık değerlendirmesi
  const seciliTaslar = useMemo(
    () => [...secili].map((id) => tasMap.get(id)).filter((t): t is Tas => !!t),
    [secili, tasMap]
  );
  const seciliSeri = useMemo(
    () => (pub?.okey && seciliTaslar.length >= 3 ? perKontrol(seciliTaslar, pub.okey) : null),
    [seciliTaslar, pub?.okey]
  );
  const seciliCift = useMemo(
    () => (pub?.okey && seciliTaslar.length === 2 ? ciftMi(seciliTaslar, pub.okey) : null),
    [seciliTaslar, pub?.okey]
  );

  // Taslak özetleri
  const taslakTip = taslak[0]?.tip ?? null;
  const taslakPuan = taslak.reduce((t, g) => t + g.puan, 0);
  const ciftSayisi = taslak.filter((g) => g.tip === "cift").length;
  const seriKalan = Math.max(0, SABITLER.ACMA_PUANI - taslakPuan);
  const ciftKalan = Math.max(0, SABITLER.MIN_CIFT_ACMA - ciftSayisi);
  // Açılabilir mi? (açmışsa şart yok)
  const acilabilir =
    taslak.length > 0 &&
    (acmisim ||
      (taslakTip === "seri" && taslakPuan >= SABITLER.ACMA_PUANI) ||
      (taslakTip === "cift" && ciftSayisi >= SABITLER.MIN_CIFT_ACMA));

  // ── Etkileşimler ──
  const tasTikla = (id: number) => {
    setSecili((s) => {
      const y = new Set(s);
      if (y.has(id)) y.delete(id); else y.add(id);
      return y;
    });
  };
  const slotTikla = (slotIdx: number) => {
    if (secili.size !== 1 || slotlar[slotIdx] !== null) return;
    const id = [...secili][0];
    setSlotlar((eski) => {
      const y = [...eski];
      const kaynak = y.indexOf(id);
      if (kaynak >= 0) y[kaynak] = null;
      y[slotIdx] = id;
      return y;
    });
    setSecili(new Set());
  };

  const seriDiz = () => {
    if (!seciliSeri?.gecerli) { uyar(seciliSeri?.hata ?? "Geçerli seri/küt seç (en az 3 taş)"); return; }
    if (!acmisim && taslakTip === "cift") { uyar("İlk açılışta seri ve çift karışmaz"); return; }
    setTaslak((p) => [...p, { idler: [...secili], tip: "seri", puan: seciliSeri.puan }]);
    setSecili(new Set());
  };
  const ciftDiz = () => {
    if (!seciliCift?.gecerli) { uyar(seciliCift?.hata ?? "Çift için birebir aynı 2 taş seç"); return; }
    if (!acmisim && taslakTip === "seri") { uyar("İlk açılışta seri ve çift karışmaz"); return; }
    setTaslak((p) => [...p, { idler: [...secili], tip: "cift", puan: seciliCift.puan }]);
    setSecili(new Set());
  };
  const ac = async () => {
    if (taslak.length === 0) return;
    const d = await api("ac", { gruplar: taslak.map((g) => g.idler) });
    if (d.ok) setTaslak([]);
  };
  const isle = async (perIndex: number) => {
    if (secili.size !== 1) { uyar("İşlemek için elinden tek taş seç"); return; }
    await api("isle", { perIndex, tasId: [...secili][0] });
    setSecili(new Set());
  };
  const at = async () => {
    if (secili.size !== 1) return;
    const d = await api("at", { tasId: [...secili][0] });
    if (d.ok) setSecili(new Set());
  };

  if (!pub) return <div className="yukleniyor">Masa hazırlanıyor…</div>;

  // Koltuk yerleşimi: ben altta; sıra yönünde sağ → üst → sol
  const sag = (koltuk + 1) % 4, ust = (koltuk + 2) % 4, sol = (koltuk + 3) % 4;
  const oyuncuAd = (k: number) => pub.oyuncular.find((o) => o.koltuk === k)?.ad ?? "";
  const rakip = (k: number, konum: string) => (
    <div className={`kenar kenar--${konum}`} key={k}>
      <RakipKarti
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
        <span className="ustbar__el">El {pub.el_no || "—"}</span>
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

      {rakip(sol, "sol")}
      {rakip(ust, "ust")}
      {rakip(sag, "sag")}

      <section className="cuha">
        {pub.faz === "lobi" && (
          <div className="panel">
            <h2>Masa: {pub.oyuncular.length}/4</h2>
            <ul className="panel__liste">
              {pub.oyuncular.map((o) => <li key={o.koltuk}>{o.ad}</li>)}
            </ul>
            {pub.oyuncular.length === 4 && (
              <button className="btn btn--buyuk" onClick={() => api("basla")}>Eli Dağıt</button>
            )}
          </div>
        )}

        {pub.faz === "el_sonu" && (
          <div className="panel">
            <h2>El bitti</h2>
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

      {/* Taslak: dizilen seriler/çiftler + canlı sayaç */}
      {taslak.length > 0 && (
        <div className="taslak">
          {taslak.map((g, i) => (
            <div className="taslak__grup" key={i}
              onClick={() => setTaslak((p) => p.filter((_, j) => j !== i))}>
              {g.idler.map((id) => tasMap.get(id)).filter(Boolean).map((t) => (
                <Tile key={t!.id} tas={t!} kucuk />
              ))}
              <span className="taslak__puan">{g.puan}</span>
            </div>
          ))}
          <span className="taslak__ozet">
            {taslakTip === "cift"
              ? `${ciftSayisi} çift · ${taslakPuan} puan${!acmisim && ciftKalan > 0 ? ` · ${ciftKalan} çift kaldı` : ""}`
              : `Toplam ${taslakPuan}${!acmisim ? ` / ${SABITLER.ACMA_PUANI}${seriKalan > 0 ? ` · ${seriKalan} kaldı` : " ✓"}` : ""}`}
          </span>
          <button className="btn" disabled={!acilabilir} onClick={ac}>AÇ</button>
        </div>
      )}

      <div className="aksiyonlar">
        {mesaj && <span className="aksiyonlar__mesaj">{mesaj}</span>}
        {!mesaj && benimSiram && !pub.cekti && <span className="ipucu">Yığından veya soldan taş çek</span>}
        {!mesaj && seciliSeri?.gecerli && (
          <span className="ipucu ipucu--sabit">Seri değeri: {seciliSeri.puan}</span>
        )}
        {!mesaj && seciliCift?.gecerli && (
          <span className="ipucu ipucu--sabit">Çift değeri: {seciliCift.puan} (×2)</span>
        )}
        <button
          className="btn"
          disabled={!seciliSeri?.gecerli || (!acmisim && taslakTip === "cift")}
          onClick={seriDiz}
        >
          Seri Diz{seciliSeri?.gecerli ? ` +${seciliSeri.puan}` : ""}
        </button>
        <button
          className="btn"
          disabled={!seciliCift?.gecerli || (!acmisim && taslakTip === "seri")}
          onClick={ciftDiz}
        >
          Çift Diz{seciliCift?.gecerli ? ` +${seciliCift.puan}` : ""}
        </button>
        <button className="btn btn--kirmizi" disabled={!atabilir} onClick={at}>At</button>
      </div>

      <footer className={`istaka ${benimSiram ? "istaka--sirada" : ""}`}>
        {[0, 1].map((raf) => (
          <div className="istaka__raf" key={raf}>
            {slotlar.slice(raf * 15, raf * 15 + 15).map((id, i) => {
              const slotIdx = raf * 15 + i;
              const t = id !== null ? tasMap.get(id) : null;
              return t ? (
                <Tile key={t.id} tas={t} secili={secili.has(t.id)} onClick={() => tasTikla(t.id)} />
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