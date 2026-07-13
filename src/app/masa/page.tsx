"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { SesliSohbet } from "@/lib/voice";
import { Tas } from "@/lib/okey/tiles";
import { perKontrol, ciftMi, OkeyBilgi } from "@/lib/okey/melds";
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
}

const SLOT_SAYISI = 30; // 2 raf × 15

// ── Modül seviyesinde yardımcı komponentler ─────────────
function RakipKarti({
  ad, tasSayisi, sirada, acmis, konusuyor, skor, atilanlar, atilanTikla, alinabilir,
}: {
  ad: string; tasSayisi: number; sirada: boolean; acmis: boolean;
  konusuyor: boolean; skor: number; atilanlar: Tas[];
  atilanTikla?: () => void; alinabilir?: boolean;
}) {
  const son = atilanlar[atilanlar.length - 1];
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
  const [taslakPerler, setTaslakPerler] = useState<number[][]>([]);
  const [mesaj, setMesaj] = useState<string>("");
  const [sesAcik, setSesAcik] = useState(false);
  const [mikrofon, setMikrofon] = useState(true);
  const [konusanlar, setKonusanlar] = useState<Set<number>>(new Set());
  const ses = useRef<SesliSohbet | null>(null);

  // ── Oturum ──
  useEffect(() => {
    const t = localStorage.getItem("okey_token");
    const k = localStorage.getItem("okey_koltuk");
    if (!t || k === null) { router.replace("/"); return; }
    setToken(t); setKoltuk(Number(k));
  }, [router]);

  // ── API çağrısı ──
  const api = useCallback(async (aksiyon: string, body: object = {}) => {
    const r = await fetch(`/api/game/${aksiyon}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-oyuncu-token": token ?? "" },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!d.ok) {
      if (r.status === 401) { localStorage.removeItem("okey_token"); router.replace("/"); }
      setMesaj(d.hata ?? "Hata");
      setTimeout(() => setMesaj(""), 2600);
    }
    return d;
  }, [token, router]);

  // ── Public durum + realtime ──
  useEffect(() => {
    if (!token) return;
    let aktif = true;
    const oku = async () => {
      const { data } = await supabase.from("game_public").select("*").eq("id", 1).single();
      if (aktif && data) setPub(data as PubState);
    };
    oku();
    const kanal = supabase
      .channel("masa")
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "game_public" },
        (p) => aktif && setPub(p.new as PubState))
      .subscribe();
    return () => { aktif = false; supabase.removeChannel(kanal); };
  }, [token]);

  // ── Kendi elini çek (durum değiştikçe) ──
  const elImza = pub ? `${pub.el_no}-${pub.el_sayilari?.[koltuk]}` : "";
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
    setTaslakPerler((p) => p
      .map((g) => g.filter((id) => el.some((t) => t.id === id)))
      .filter((g) => g.length > 0));
  }, [el]);

  // ── El değişince istaka düzenini sakla/geri yükle ──
  useEffect(() => {
    if (!pub) return;
    localStorage.setItem(`okey_duzen_${pub.el_no}`, JSON.stringify(slotlar));
  }, [slotlar, pub]);

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
    s.onDurum = (m) => { setMesaj(m); setTimeout(() => setMesaj(""), 2600); };
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

  const taslakPuan = useMemo(() => {
    if (!pub?.okey) return 0;
    let toplam = 0;
    for (const g of taslakPerler) {
      const taslar = g.map((id) => tasMap.get(id)!).filter(Boolean);
      const p = perKontrol(taslar, pub.okey);
      const c = ciftMi(taslar, pub.okey);
      toplam += p.gecerli ? p.puan : c.gecerli ? c.puan : 0;
    }
    return toplam;
  }, [taslakPerler, tasMap, pub?.okey]);

  // ── Etkileşimler ──
  const tasTikla = (id: number) => {
    setSecili((s) => {
      const y = new Set(s);
      if (y.has(id)) y.delete(id); else y.add(id);
      return y;
    });
  };
  const slotTikla = (slotIdx: number) => {
    // tek taş seçiliyken boş slota tıkla → taşı oraya taşı
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
  const grupYap = () => {
    if (secili.size < 2) return;
    setTaslakPerler((p) => [...p, [...secili]]);
    setSecili(new Set());
  };
  const ac = async () => {
    if (taslakPerler.length === 0) return;
    const d = await api("ac", { gruplar: taslakPerler });
    if (d.ok) setTaslakPerler([]);
  };
  const isle = async (perIndex: number) => {
    if (secili.size !== 1) {
      setMesaj("İşlemek için elinden tek taş seç");
      setTimeout(() => setMesaj(""), 2600);
      return;
    }
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
      />
    </div>
  );

  return (
    <main className="masa">
      {/* Dikey uyarısı */}
      <div className="dondur">
        <span className="dondur__ikon">⟳</span>
        Telefonu yan çevirin
      </div>

      {/* Üst çubuk */}
      <header className="ustbar">
        <span className="ustbar__logo">101</span>
        <span className="ustbar__el">El {pub.el_no || "—"}</span>
        {pub.son_olay && (
          <span className="ustbar__olay">
            {oyuncuAd(pub.son_olay.koltuk)}: {pub.son_olay.mesaj}
          </span>
        )}
        <div className="ustbar__ses">
          {!sesAcik ? (
            <button className="btn btn--kucuk" onClick={sesBaslat}>🎙 Sese katıl</button>
          ) : (
            <button className={`btn btn--kucuk ${!mikrofon ? "btn--kirmizi" : ""}`} onClick={mikrofonToggle}>
              {mikrofon ? "🎙 Açık" : "🔇 Kapalı"}
            </button>
          )}
        </div>
      </header>

      {/* Rakipler */}
      {rakip(sol, "sol")}
      {rakip(ust, "ust")}
      {rakip(sag, "sag")}

      {/* Orta: çuha */}
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
                  className={`per ${benimSiram && pub.acanlar[koltuk] && p.tip !== "cift" ? "per--islenir" : ""}`}
                  onClick={() => benimSiram && pub.acanlar[koltuk] && p.tip !== "cift" && isle(i)}
                >
                  <span className="per__sahip">{oyuncuAd(p.koltuk)}</span>
                  {p.taslar.map((t) => <Tile key={t.id} tas={t} kucuk />)}
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Taslak perler */}
      {taslakPerler.length > 0 && (
        <div className="taslak">
          {taslakPerler.map((g, i) => (
            <div className="taslak__grup" key={i}
              onClick={() => setTaslakPerler((p) => p.filter((_, j) => j !== i))}>
              {g.map((id) => tasMap.get(id)).filter(Boolean).map((t) => (
                <Tile key={t!.id} tas={t!} kucuk />
              ))}
            </div>
          ))}
          <button className="btn" onClick={ac}>
            AÇ {!pub.acanlar?.[koltuk] ? `(${taslakPuan} puan)` : ""}
          </button>
        </div>
      )}

      {/* Aksiyon çubuğu */}
      <div className="aksiyonlar">
        {mesaj && <span className="aksiyonlar__mesaj">{mesaj}</span>}
        {benimSiram && !pub.cekti && <span className="ipucu">Yığından veya soldan taş çek</span>}
        <button className="btn" disabled={secili.size < 2} onClick={grupYap}>Per Yap</button>
        <button className="btn btn--kirmizi" disabled={!atabilir} onClick={at}>At</button>
      </div>

      {/* İstaka */}
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
