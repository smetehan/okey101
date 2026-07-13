// ─────────────────────────────────────────────────────────────
// Sesli sohbet: 4 kişilik WebRTC full-mesh.
// Sinyalleşme Supabase Realtime broadcast kanalı üzerinden yapılır,
// ekstra sunucu gerekmez. STUN: Google public.
// ─────────────────────────────────────────────────────────────
import { supabase } from "./supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    // NOT: Bazı mobil operatör NAT'larında STUN yetmez.
    // Gerekirse buraya bir TURN sunucusu ekleyin (ör. metered.ca ücretsiz katman).
  ],
};

type Sinyal =
  | { tip: "hazir"; kimden: number }
  | { tip: "teklif"; kimden: number; kime: number; sdp: RTCSessionDescriptionInit }
  | { tip: "cevap"; kimden: number; kime: number; sdp: RTCSessionDescriptionInit }
  | { tip: "ice"; kimden: number; kime: number; aday: RTCIceCandidateInit };

export class SesliSohbet {
  private koltuk: number;
  private kanal: RealtimeChannel | null = null;
  private yerel: MediaStream | null = null;
  private esler = new Map<number, RTCPeerConnection>();
  private sesler = new Map<number, HTMLAudioElement>();
  /** koltuk → konuşuyor mu (ses seviyesi göstergesi için) */
  onKonusma?: (koltuk: number, konusuyor: boolean) => void;
  onDurum?: (mesaj: string) => void;

  constructor(koltuk: number) {
    this.koltuk = koltuk;
  }

  async baslat(): Promise<boolean> {
    try {
      this.yerel = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      this.onDurum?.("Mikrofon izni verilmedi");
      return false;
    }

    this.kanal = supabase.channel("ses-sinyal", {
      config: { broadcast: { self: false } },
    });

    this.kanal.on("broadcast", { event: "sinyal" }, ({ payload }) => {
      this.sinyalIsle(payload as Sinyal);
    });

    await new Promise<void>((res) =>
      this.kanal!.subscribe((s) => s === "SUBSCRIBED" && res())
    );

    // Herkese "hazırım" de — düşük koltuk numarası teklif başlatır
    this.gonder({ tip: "hazir", kimden: this.koltuk });
    this.seviyeIzle(this.koltuk, this.yerel);
    return true;
  }

  private gonder(s: Sinyal) {
    this.kanal?.send({ type: "broadcast", event: "sinyal", payload: s });
  }

  private es(hedef: number): RTCPeerConnection {
    let pc = this.esler.get(hedef);
    if (pc) return pc;
    pc = new RTCPeerConnection(RTC_CONFIG);
    this.esler.set(hedef, pc);

    this.yerel?.getTracks().forEach((t) => pc!.addTrack(t, this.yerel!));

    pc.onicecandidate = (e) => {
      if (e.candidate)
        this.gonder({ tip: "ice", kimden: this.koltuk, kime: hedef, aday: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      let ses = this.sesler.get(hedef);
      if (!ses) {
        ses = new Audio();
        ses.autoplay = true;
        this.sesler.set(hedef, ses);
      }
      ses.srcObject = e.streams[0];
      this.seviyeIzle(hedef, e.streams[0]);
    };
    pc.onconnectionstatechange = () => {
      if (pc!.connectionState === "failed" || pc!.connectionState === "closed") {
        this.esler.delete(hedef);
        this.onKonusma?.(hedef, false);
      }
    };
    return pc;
  }

  private async sinyalIsle(s: Sinyal) {
    if (s.tip === "hazir") {
      // Çakışmayı önle: yalnızca küçük koltuk numarası teklif eder
      if (this.koltuk < s.kimden) {
        const pc = this.es(s.kimden);
        const teklif = await pc.createOffer();
        await pc.setLocalDescription(teklif);
        this.gonder({ tip: "teklif", kimden: this.koltuk, kime: s.kimden, sdp: teklif });
      }
      return;
    }
    if (s.kime !== this.koltuk) return;

    if (s.tip === "teklif") {
      const pc = this.es(s.kimden);
      await pc.setRemoteDescription(s.sdp);
      const cevap = await pc.createAnswer();
      await pc.setLocalDescription(cevap);
      this.gonder({ tip: "cevap", kimden: this.koltuk, kime: s.kimden, sdp: cevap });
    } else if (s.tip === "cevap") {
      await this.esler.get(s.kimden)?.setRemoteDescription(s.sdp);
    } else if (s.tip === "ice") {
      await this.esler.get(s.kimden)?.addIceCandidate(s.aday).catch(() => {});
    }
  }

  /** Basit ses seviyesi analizi → konuşan göstergesi */
  private seviyeIzle(koltuk: number, stream: MediaStream) {
    try {
      const ctx = new AudioContext();
      const kaynak = ctx.createMediaStreamSource(stream);
      const analiz = ctx.createAnalyser();
      analiz.fftSize = 256;
      kaynak.connect(analiz);
      const veri = new Uint8Array(analiz.frequencyBinCount);
      let onceki = false;
      const dongu = () => {
        if (!this.kanal) return;
        analiz.getByteFrequencyData(veri);
        const ort = veri.reduce((a, b) => a + b, 0) / veri.length;
        const konusuyor = ort > 24;
        if (konusuyor !== onceki) {
          onceki = konusuyor;
          this.onKonusma?.(koltuk, konusuyor);
        }
        requestAnimationFrame(dongu);
      };
      dongu();
    } catch { /* AudioContext yoksa gösterge olmaz, ses çalışır */ }
  }

  susturuldu = false;
  sustur(durum: boolean) {
    this.susturuldu = durum;
    this.yerel?.getAudioTracks().forEach((t) => (t.enabled = !durum));
  }

  kapat() {
    this.esler.forEach((pc) => pc.close());
    this.esler.clear();
    this.sesler.forEach((a) => { a.srcObject = null; });
    this.sesler.clear();
    this.yerel?.getTracks().forEach((t) => t.stop());
    this.yerel = null;
    if (this.kanal) supabase.removeChannel(this.kanal);
    this.kanal = null;
  }
}
