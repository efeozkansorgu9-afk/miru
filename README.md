# miru

TEFAS yatırım fonları için analiz platformu: **[miru.com.tr](https://miru.com.tr)**

miru size ne alacağınızı söylemez; elinizde ne olduğunu gösterir. Sepetinizdeki fonların kaçının aslında tek bir varlık olduğunu, her fonun hangi fonlarla birlikte hareket ettiğini ve piyasadaki ~1.370 fonun gerçekte kaç farklı şeye yatırım yaptığını ölçer.

> **Yatırım tavsiyesi değildir.** miru kişiye özel yatırım tavsiyesi vermez (SPK). Gösterilen her şey geçmiş fiyatlardan yapılmış bir ölçümdür; hiçbir fon "al", "sat" ya da "en iyi" diye işaretlenmez.

## Ne yapar

| Araç | Yol | Ne gösterir |
|---|---|---|
| Sepet Analizi | `/sepet-analizi` | Elinizdeki fonları girersiniz; aralarındaki örtüşmeyi, getiriyi (enflasyondan arındırılmış dahil), risk dağılımını ve ücretleri görürsünüz. Kademeli alımlar için XIRR hesaplar. |
| Fon sayfaları | `/fon/[kod]` | 1.372 fonun her biri için künye, 6 ay – 4 yıl getiri (nominal, reel, dolar bazında) ve korelasyon komşuları. |
| Piyasa haritası | `/piyasa` | Tüm fonların fiyat hareketine göre kaç gruba ayrıldığı; her grubun neyden oluştuğu (getiri bazlı stil analizi). |
| Yöntem | `/yontem` | Her rakamın nasıl üretildiği; kontrol etmek isteyen biri için yazılmış. |

## İlkeler

- **Güven aralığının iddiaya karşı olan ucuna bakılır.** "Yüksek korelasyon" iddiası için aralığın alt sınırına, "düşük" iddiası için üst sınırına.
- **Ölçülemeyen şey iddia edilmez.** Veri yetersizse hüküm de tahmin de yoktur.
- **Sessiz düşürme yok.** Hesaba girmeyen fonun sebebi kaydedilir ve gösterilir.
- **Sıralı liste değil, kova.** Sıralarsanız insanlar en üsttekini alır, o da tavsiye olur. Fonlar `overlapping`, `similar`, `moderate`, `unrelated`, `inverse`, `uncertain`, `insufficient_data` kovalarına ayrılır.
- **API görünen Türkçe metin döndürmez.** Kova adları İngilizce ve sabittir; cümleyi frontend kurar.
- Ücretler yan yana gerçek olarak gösterilir, hiçbir zaman sıralanmaz.

## Yöntem (kısa)

- Haftalık getiriler (`W-FRI`, son gözlenen fiyat); fiyatlar ileri doldurulmaz.
- Korelasyon tek matris çarpımıyla hesaplanır, çift döngü yoktur.
- Her çift için Fisher z ve hareketli blok bootstrap ile %95 güven aralığı; hüküm iki aralığın **geniş olanından** okunur.
- Getiriler 12 ve 36 ay (fon sayfalarında 6, 12, 36, 48 ay), nominal ve reel; ikisi de aynı pencerede ölçülür, pencere son yayımlanmış TÜFE ayında biter.
- Piyasa haritası: tam bağlantılı (complete linkage) kümeleme, grup içindeki her çiftin alt sınırı 0,85'in üzerinde.

Ayrıntı ve ölçümler için [`/yontem`](https://miru.com.tr/yontem) sayfasına ve [`CLAUDE.md`](CLAUDE.md) dosyasındaki mimari notlara bakın.

## Mimari

```
TEFAS ──► jobs/weekly.py ──► Postgres ──► api/ (FastAPI) ──► web/ (Next.js)
 EVDS/TCMB (TÜFE, USD/TRY) ─┘                 ▲
                                    /analyze: sepet için canlı TEFAS çağrısı
```

- **Backend:** FastAPI, Python 3.10+. Railway'de.
- **Veri:** TEFAS ([`tefas-crawler`](https://pypi.org/project/tefas-crawler/)), enflasyon ve kur TCMB EVDS'den.
- **Veritabanı:** Postgres. Korelasyonlar ve getiriler önceden hesaplanıp yazılır.
- **Haftalık iş:** Pazartesi 03:00 (İstanbul); fiyatları çeker, korelasyon matrisini hesaplar, tabloyu yeniler.
- **Frontend:** Next.js, TypeScript, Tailwind, Framer Motion. Vercel'de. Fon sayfaları statik üretilir, günlük yenilenir.

```
api/        HTTP katmanı (FastAPI)
src/        veri ve analiz: TEFAS istemcisi, korelasyon, getiri, risk, piyasa haritası
jobs/       haftalık hesaplama işi (python -m jobs.weekly)
web/        Next.js arayüzü
tests/      duman testleri
notebooks/  keşif amaçlı defterler (ürünün parçası değil)
```

## Yerelde çalıştırma

```bash
# Backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # kendi değerlerinizi .env içine yazın
uvicorn api.main:app --reload --port 8000

# Frontend (API'nin :8000'de çalışıyor olması gerekir)
cd web && npm install && npm run dev
```

### Ortam değişkenleri

Gerçek değerler **asla** repoya girmez. `.env` dosyası `.gitignore`'dadır; canlı ortamda değişkenler Railway ve Vercel panelinden verilir. Tüm liste ve açıklamalar [`.env.example`](.env.example) içindedir.

| Değişken | Nerede | Zorunlu mu |
|---|---|---|
| `DATABASE_URL` | API ve haftalık iş | Fon sayfaları için evet. Yoksa `/analyze` çalışır, `/fund/{kod}` 503 döner. |
| `EVDS_API_KEY` | API ve haftalık iş | Hayır. Yoksa enflasyondan arındırılmış getiri gösterilmez. Ücretsiz, [EVDS](https://evds2.tcmb.gov.tr/) profilinizden alınır. |
| `MIRU_ALLOWED_ORIGINS` | API | Canlı ortamda frontend adresi (CORS). |
| `NEXT_PUBLIC_API_URL` | Frontend | Canlı ortamda evet; varsayılan `http://localhost:8000`. |

### Haftalık iş

```bash
export DATABASE_URL=postgresql://kullanici@localhost:5432/miru
python -m jobs.weekly --limit 70 --skip-scenarios   # geliştirme için küçük dilim
```

Tam evren ~1.374 canlı TEFAS isteğidir (Railway'de yaklaşık 30 dakika). Geliştirme makinesinde tamamını çalıştırmayın; dilim kullanın. Dağıtım sırası için [`DEPLOY.md`](DEPLOY.md), işin mevcut durumu için [`HANDOVER.md`](HANDOVER.md) dosyasına bakın.

## Geliştirme

Kod büyük ölçüde [Claude Code](https://claude.com/claude-code) ile yazılıyor. GitHub'a `main` push edilince Vercel ve Railway otomatik dağıtım yapar. Karar gerekçeleri kod dosyalarının başlıklarında ve `CLAUDE.md` içinde tutulur.

```bash
python tests/smoke_test.py      # TEFAS veri toplama kontrolü
```

## Marka

Marka adı her yerde küçük harfle yazılır: **miru**.

## Lisans

Tüm hakları saklıdır © 2026 Efe Özkan Sorgu. Kod inceleme amacıyla görünür durumdadır; izin alınmadan kopyalanamaz, değiştirilemez, dağıtılamaz veya ticari olarak kullanılamaz.
