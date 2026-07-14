"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

interface MasaOzet {
  id: number;
  masa_adi: string;
  oyuncular: { koltuk: number; ad: string }[];
  bekleyenler: { istekId: string; ad: string }[];
  masa_acik: boolean;
  faz: string;
  el_no: number;
  el_hedef: number;
}

export default function PanelPage() {
  const router = useRouter();
  const [sifre, setSifre] = useState<string | null>(null);
  const [ad, setAd] = useState("");
  const [masalar, setMasalar] = useState<MasaOzet[]>([]);
  const [yeniAd, setYeniAd] = useState("");
  const [mesaj, setMesaj] = useState("");

  useEffect(() => {
    const s = sessionStorage.getItem("okey_sifre");
    const a = localStorage.getItem("okey_ad") ?? "";
    if (!s) { router.replace("/"); return; }
    setSifre(s); setAd(a);
  }, [router]);

  const uyar = (m: string) => { setMesaj(m); setTimeout(() => setMesaj(""), 3000); };

  const listele = useCallback(async () => {
    const { data } = await supabase
      .from("game_public")
      .select("id, masa_adi, oyuncular, bekleyenler, masa_acik, faz, el_no, el_hedef")
      .order("id", { ascending: true });
    if (data) setMasalar(data as MasaOzet[]);
  }, []);
  useEffect(() => {
    if (!sifre) return;
    listele();
    const z = setInterval(listele, 3000);
    return () => clearInterval(z);
  }, [sifre, listele]);

  const api = async (aksiyon: string, body: object) => {
    const r = await fetch(`/api/game/${aksiyon}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sifre, ...body }),
    });
    const d = await r.json();
    if (!d.ok) uyar(d.hata ?? "Hata");
    else listele();
    return d;
  };

  const masaAc = async () => {
    const d = await api("masaac", { masaId: 0, masaAdi: yeniAd });
    if (d.ok) { setYeniAd(""); uyar("Masa açıldı"); }
  };

  // Süper admin bir masaya oyuncu olarak oturur
  const otur = async (masaId: number) => {
    const r = await fetch("/api/game/giris", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ad, sifre, masaId }),
    });
    const d = await r.json();
    if (!d.ok) { uyar(d.hata ?? "Oturulamadı"); return; }
    localStorage.setItem("okey_token", d.token);
    localStorage.setItem("okey_koltuk", String(d.koltuk));
    localStorage.setItem("okey_masa", String(masaId));
    localStorage.setItem("okey_admin", d.admin ? "1" : "0");
    router.push("/masa");
  };

  if (!sifre) return <div className="yukleniyor">Panel yükleniyor…</div>;

  return (
    <main className="giris giris--liste">
      <div className="giris__kart giris__kart--genis">
        <h1 className="giris__baslik">Yönetim Paneli</h1>
        <p className="giris__alt">Hoş geldin {ad} · süper admin</p>
        {mesaj && <p className="giris__hata">{mesaj}</p>}

        {/* Yeni masa */}
        <div className="masa-kur">
          <input className="giris__input" value={yeniAd} maxLength={24}
            onChange={(e) => setYeniAd(e.target.value)}
            placeholder="Masa adı (ör. Akşam Masası)" />
          <button className="btn" onClick={masaAc}>Masa Aç</button>
        </div>

        {/* Masalar */}
        <div className="masa-liste">
          {masalar.length === 0 && <p className="masa-liste__bos">Henüz masa yok</p>}
          {masalar.map((m) => (
            <div className="masa-kart" key={m.id}>
              <div className="masa-kart__bilgi">
                <span className="masa-kart__ad">
                  {m.masa_adi}{" "}
                  <span className={`durum-rozet ${m.masa_acik ? "durum-rozet--acik" : ""}`}>
                    {m.masa_acik ? "AÇIK" : "KAPALI"}
                  </span>
                </span>
                <span className="masa-kart__detay">
                  {(m.oyuncular ?? []).map((o) => o.ad).join(", ") || "boş"}
                  {" · "}{(m.oyuncular ?? []).length}/4
                  {m.faz === "oyun" ? ` · El ${m.el_no}/${m.el_hedef}` : ""}
                  {(m.bekleyenler ?? []).length > 0 ? ` · ${m.bekleyenler.length} onay bekliyor` : ""}
                </span>
              </div>
              <div className="masa-kart__butonlar">
                <button className="btn btn--kucuk"
                  disabled={(m.oyuncular ?? []).length >= 4}
                  onClick={() => otur(m.id)}>Otur</button>
                <button className={`btn btn--kucuk ${m.masa_acik ? "btn--kirmizi" : ""}`}
                  onClick={() => api("panelmasa", { masaId: m.id, acik: !m.masa_acik })}>
                  {m.masa_acik ? "Kapat" : "Aç"}
                </button>
                <button className="btn btn--kucuk btn--kirmizi"
                  onClick={() => confirm(`"${m.masa_adi}" silinsin mi?`) && api("panelsil", { masaId: m.id })}>
                  Sil
                </button>
              </div>
            </div>
          ))}
        </div>

        <button className="giris__geri" onClick={() => router.push("/")}>← Çıkış</button>
      </div>
    </main>
  );
}
