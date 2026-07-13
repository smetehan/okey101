# 101 Okey — Özel Masa

Tek masalı, 4 kişilik, sesli sohbetli 101 okey. Next.js 15 + Supabase.

## Neden adil?

Taşlar **tarayıcıda değil, sunucuda** (Next.js API route) karıştırılır — Fisher–Yates + Web Crypto (kriptografik rastgelelik, rejection sampling ile bias'sız). Eller `game_private` tablosunda tutulur; bu tabloya anon key ile **hiç erişim yoktur** (RLS policy tanımlanmamıştır, sadece service role okur). Tarayıcıya yalnızca kendi elin gider. Kimseye "çip alsın diye iyi taş" gelmez, gelemez — kod tarafında böyle bir mekanizma yoktur.

## Kurulum

1. **Supabase**: Yeni proje aç → SQL Editor'de `sql/schema.sql` dosyasını çalıştır.
2. **Ortam değişkenleri**: `.env.local.example` → `.env.local` kopyala, doldur:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Settings → API)
   - `SUPABASE_SERVICE_ROLE_KEY` (gizli — Vercel'de de env olarak ekle)
   - `MASA_SIFRESI` — masaya giriş şifresi, sen belirle
3. `npm install && npm run dev` — veya Vercel'e deploy et (env'leri eklemeyi unutma).
4. 4 kişi telefonu **yan çevirip** siteye girer, ad + şifre yazar, herkes oturunca "Eli Dağıt".

## Oynanış (dokunmatik)

- **Çekme**: Sıran gelince ortadaki yığına ya da **solundaki** oyuncunun altın çerçeveli atık taşına dokun.
- **Taşıma**: Taşa dokun (seçilir) → istakada boş yuvaya dokun.
- **Per açma**: Taşları seç → **Per Yap** (birden çok grup yapabilirsin) → **AÇ**. İlk açılışta toplam **101 puan** veya **en az 4 çift** gerekir; buton canlı puan gösterir.
- **İşleme**: Açtıysan, elinden tek taş seç → masada altın çerçeveli bir pere dokun.
- **Atma**: Tek taş seç → **At**. Elin biterse el kapanır, cezalar yazılır.
- **Ses**: Üstteki "Sese katıl" → mikrofon izni ver. Konuşan kişinin avatarı yeşil yanar.

## Kurallar (koddaki varsayılanlar)

`src/lib/okey/melds.ts` içindeki `SABITLER` ile hepsi değiştirilebilir:

| Kural | Varsayılan |
|---|---|
| İlk açma puanı | 101 |
| Çiftten açma | en az 4 çift |
| Hiç açamayanın el sonu cezası | 101 |
| Okey atarak bitirme | diğerlerinin cezası ×2 |
| 12-13-1 serisi | geçerli (1 = 1 puan), 13-1-2 geçersiz |
| Yığın biterse | el berabere, ceza yok |

## Bilinen sınırlar / sonraki adımlar

- **TURN sunucusu yok**: WebRTC, Google STUN ile çoğu ağda çalışır ama bazı mobil operatör NAT'larında ses bağlanmayabilir. Gerekirse `src/lib/voice.ts` içine ücretsiz bir TURN (ör. metered.ca) ekle.
- **Okey çalma / gösterge okeyi bonusu** gibi bölgesel varyantlar yok — istenirse eklenir.
- Elden bitme bonusu (−101) sabitlerde tanımlı ama otomatik uygulanmıyor (bölgesel kural farkları netleşince bağlanır).
- Test: `npm run test:engine` → 32 birim testi (taş dağıtımı, per/seri/küt/çift, açma, ceza).
