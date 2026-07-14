"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function GirisPage() {
  const router = useRouter();
  const [ad, setAd] = useState("");
  const [sifre, setSifre] = useState("");
  const [hata, setHata] = useState("");
  const [bekliyor, setBekliyor] = useState(false);
  const [onayBekliyor, setOnayBekliyor] = useState(false);

  // Admin onayını bekle: 2 sn'de bir sor
  useEffect(() => {
    if (!onayBekliyor) return;
    const token = localStorage.getItem("okey_token");
    if (!token) { setOnayBekliyor(false); return; }
    const sor = async () => {
      try {
        const r = await fetch("/api/game/bekle", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-oyuncu-token": token },
          body: "{}",
        });
        const d = await r.json();
        if (d.ok && d.koltuk !== undefined) {
          localStorage.setItem("okey_koltuk", String(d.koltuk));
          router.push("/masa");
        } else if (!d.ok && r.status === 410) {
          setOnayBekliyor(false);
          setHata("İsteğin reddedildi veya masa kapatıldı");
          localStorage.removeItem("okey_token");
        }
      } catch { /* geçici ağ hatası — tekrar dener */ }
    };
    sor();
    const z = setInterval(sor, 2000);
    return () => clearInterval(z);
  }, [onayBekliyor, router]);

  const giris = async () => {
    if (!ad.trim() || !sifre) { setHata("Ad ve şifre gerekli"); return; }
    setBekliyor(true); setHata("");
    try {
      const r = await fetch("/api/game/giris", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ad, sifre }),
      });
      const d = await r.json();
      if (!d.ok) { setHata(d.hata ?? "Giriş başarısız"); return; }
      localStorage.setItem("okey_token", d.token);
      localStorage.setItem("okey_ad", d.ad);
      localStorage.setItem("okey_admin", d.admin ? "1" : "0");
      if (d.beklemede) {
        localStorage.removeItem("okey_koltuk");
        setOnayBekliyor(true);
        return;
      }
      localStorage.setItem("okey_koltuk", String(d.koltuk));
      router.push("/masa");
    } catch {
      setHata("Sunucuya ulaşılamadı");
    } finally {
      setBekliyor(false);
    }
  };

  if (onayBekliyor) {
    return (
      <main className="giris">
        <div className="giris__kart">
          <div className="giris__logo">
            <span className="giris__logo-tas">1</span>
            <span className="giris__logo-tas giris__logo-tas--kirmizi">0</span>
            <span className="giris__logo-tas">1</span>
          </div>
          <h1 className="giris__baslik">Onay bekleniyor…</h1>
          <p className="giris__alt">Admin seni masaya kabul edince otomatik gireceksin</p>
          <div className="giris__bekleme" />
          <button className="btn giris__btn" onClick={() => {
            setOnayBekliyor(false);
            localStorage.removeItem("okey_token");
          }}>Vazgeç</button>
        </div>
      </main>
    );
  }

  return (
    <main className="giris">
      <div className="giris__kart">
        <div className="giris__logo">
          <span className="giris__logo-tas">1</span>
          <span className="giris__logo-tas giris__logo-tas--kirmizi">0</span>
          <span className="giris__logo-tas">1</span>
        </div>
        <h1 className="giris__baslik">Okey Masası</h1>
        <p className="giris__alt">Tek masa · 4 kişi · sesli sohbet</p>

        <label className="giris__etiket" htmlFor="ad">Kullanıcı adı</label>
        <input
          id="ad" className="giris__input" value={ad} maxLength={16}
          onChange={(e) => setAd(e.target.value)} placeholder="Adını yaz"
          autoComplete="off"
        />

        <label className="giris__etiket" htmlFor="sifre">Masa şifresi</label>
        <input
          id="sifre" className="giris__input" type="password" value={sifre}
          onChange={(e) => setSifre(e.target.value)} placeholder="••••••"
          onKeyDown={(e) => e.key === "Enter" && giris()}
        />

        {hata && <p className="giris__hata">{hata}</p>}

        <button className="btn btn--buyuk giris__btn" onClick={giris} disabled={bekliyor}>
          {bekliyor ? "Giriliyor…" : "Masaya Otur"}
        </button>
      </div>
    </main>
  );
}
