"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

interface MasaOzet {
  id: number;
  masa_adi: string;
  oyuncular: { koltuk: number; ad: string }[];
  masa_acik: boolean;
  faz: string;
}

export default function GirisPage() {
  const router = useRouter();
  const [adim, setAdim] = useState<"giris" | "masalar">("giris");
  const [ad, setAd] = useState("");
  const [sifre, setSifre] = useState("");
  const [masalar, setMasalar] = useState<MasaOzet[]>([]);
  const [hata, setHata] = useState("");
  const [bekliyor, setBekliyor] = useState(false);
  const [onayMasaId, setOnayMasaId] = useState<number | null>(null);

  useEffect(() => {
    setAd(localStorage.getItem("okey_ad") ?? "");
  }, []);

  // ── 1. adım: şifreyi doğrula, role göre yönlendir ──
  const devam = async () => {
    if (!ad.trim() || !sifre) { setHata("Ad ve şifre gerekli"); return; }
    setBekliyor(true); setHata("");
    try {
      const r = await fetch("/api/game/kim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sifre, masaId: 0 }),
      });
      const d = await r.json();
      if (!d.ok) { setHata(d.hata ?? "Şifre yanlış"); return; }
      sessionStorage.setItem("okey_sifre", sifre);
      localStorage.setItem("okey_ad", ad.trim());
      if (d.admin) { router.push("/panel"); return; }
      setAdim("masalar");
    } catch { setHata("Sunucuya ulaşılamadı"); }
    finally { setBekliyor(false); }
  };

  // ── Masa listesi ──
  const listele = useCallback(async () => {
    const { data } = await supabase
      .from("game_public")
      .select("id, masa_adi, oyuncular, masa_acik, faz")
      .order("id", { ascending: true });
    if (data) setMasalar(data as MasaOzet[]);
  }, []);
  useEffect(() => {
    if (adim !== "masalar") return;
    listele();
    const z = setInterval(listele, 4000);
    return () => clearInterval(z);
  }, [adim, listele]);

  // ── Masaya katıl ──
  const katil = async (masaId: number) => {
    setBekliyor(true); setHata("");
    try {
      const r = await fetch("/api/game/giris", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ad, sifre, masaId }),
      });
      const d = await r.json();
      if (!d.ok) { setHata(d.hata ?? "Katılamadın"); return; }
      localStorage.setItem("okey_token", d.token);
      localStorage.setItem("okey_ad", d.ad);
      localStorage.setItem("okey_masa", String(masaId));
      localStorage.setItem("okey_admin", d.admin ? "1" : "0");
      if (d.beklemede) { setOnayMasaId(masaId); return; }
      localStorage.setItem("okey_koltuk", String(d.koltuk));
      router.push("/masa");
    } catch { setHata("Sunucuya ulaşılamadı"); }
    finally { setBekliyor(false); }
  };

  // ── Masa admini onayını bekle ──
  useEffect(() => {
    if (onayMasaId === null) return;
    const token = localStorage.getItem("okey_token");
    if (!token) { setOnayMasaId(null); return; }
    const sor = async () => {
      try {
        const r = await fetch("/api/game/bekle", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-oyuncu-token": token },
          body: JSON.stringify({ masaId: onayMasaId }),
        });
        const d = await r.json();
        if (d.ok && d.koltuk !== undefined) {
          localStorage.setItem("okey_koltuk", String(d.koltuk));
          router.push("/masa");
        } else if (!d.ok && r.status === 410) {
          setOnayMasaId(null);
          setHata("İsteğin reddedildi veya masa kapatıldı");
          localStorage.removeItem("okey_token");
        }
      } catch { /* tekrar dener */ }
    };
    sor();
    const z = setInterval(sor, 2000);
    return () => clearInterval(z);
  }, [onayMasaId, router]);

  const Logo = (
    <div className="giris__logo">
      <span className="giris__logo-tas">1</span>
      <span className="giris__logo-tas giris__logo-tas--kirmizi">0</span>
      <span className="giris__logo-tas">1</span>
    </div>
  );

  // ── Onay bekleme ekranı ──
  if (onayMasaId !== null) {
    return (
      <main className="giris">
        <div className="giris__kart">
          {Logo}
          <h1 className="giris__baslik">Onay bekleniyor…</h1>
          <p className="giris__alt">Masa admini seni kabul edince otomatik gireceksin</p>
          <div className="giris__bekleme" />
          <button className="btn giris__btn" onClick={() => {
            setOnayMasaId(null);
            localStorage.removeItem("okey_token");
          }}>Vazgeç</button>
        </div>
      </main>
    );
  }

  // ── Masa listesi ekranı ──
  if (adim === "masalar") {
    return (
      <main className="giris giris--liste">
        <div className="giris__kart">
          {Logo}
          <h1 className="giris__baslik">Masalar</h1>
          <p className="giris__alt">Hoş geldin {ad} — bir masa seç</p>
          {hata && <p className="giris__hata">{hata}</p>}
          <div className="masa-liste">
            {masalar.length === 0 && (
              <p className="masa-liste__bos">Şu an açık masa yok — adminin masa açmasını bekle</p>
            )}
            {masalar.map((m) => {
              const dolu = (m.oyuncular ?? []).length;
              return (
                <div className="masa-kart" key={m.id}>
                  <div className="masa-kart__bilgi">
                    <span className="masa-kart__ad">{m.masa_adi}</span>
                    <span className="masa-kart__detay">
                      {dolu}/4
                      {" · "}
                      <span className={m.masa_acik ? "yesil" : "kirmizi"}>
                        {m.masa_acik ? "açık" : "kapalı"}
                      </span>
                      {m.faz === "oyun" ? " · oyunda" : ""}
                      {dolu === 0 ? " · ilk oturan admin olur" : ""}
                    </span>
                  </div>
                  <button className="btn btn--kucuk"
                    disabled={bekliyor || (!m.masa_acik && dolu > 0) || dolu >= 4}
                    onClick={() => katil(m.id)}>
                    {dolu >= 4 ? "Dolu" : "Otur"}
                  </button>
                </div>
              );
            })}
          </div>
          <button className="giris__geri" onClick={() => setAdim("giris")}>← Geri</button>
        </div>
      </main>
    );
  }

  // ── Giriş ekranı ──
  return (
    <main className="giris">
      <div className="giris__kart">
        {Logo}
        <h1 className="giris__baslik">Okey Masası</h1>
        <p className="giris__alt">Adını ve şifreni yaz</p>

        <label className="giris__etiket" htmlFor="ad">Kullanıcı adı</label>
        <input id="ad" className="giris__input" value={ad} maxLength={16}
          onChange={(e) => setAd(e.target.value)} placeholder="Adını yaz" autoComplete="off" />

        <label className="giris__etiket" htmlFor="sifre">Şifre</label>
        <input id="sifre" className="giris__input" type="password" value={sifre}
          onChange={(e) => setSifre(e.target.value)} placeholder="••••••"
          onKeyDown={(e) => e.key === "Enter" && devam()} />

        {hata && <p className="giris__hata">{hata}</p>}

        <button className="btn btn--buyuk giris__btn" onClick={devam} disabled={bekliyor}>
          {bekliyor ? "Kontrol ediliyor…" : "Devam"}
        </button>
        <p className="giris__not">Admin şifresiyle girersen yönetim paneline yönlendirilirsin</p>
      </div>
    </main>
  );
}
