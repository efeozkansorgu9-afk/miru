import type { Metadata } from "next";
import Link from "next/link";

import { Column } from "@/components/column";
import { Reveal } from "@/components/reveal";
import { FUND_BASE, SITE, TOOL } from "@/lib/site";

/**
 * How every number on the site is produced: `/yontem`.
 *
 * Fully static and asks the API for nothing, so it can never be the page
 * that fails a build. Every figure quoted here is a constant in the code
 * (thresholds in `src/precompute.py` and `src/analysis.py`, windows in
 * `web/lib/windows.json`) or a measurement recorded in `CLAUDE.md`; when one
 * of those moves, this page has to move with it. The Fisher examples are
 * computed, not illustrative: r = 0,92 gives (0,837 – 0,962) on 30 weeks and
 * (0,896 – 0,939) on 200.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: { absolute: `Yöntem · ${SITE.brand}` },
  description:
    "miru'daki her sayının nasıl hesaplandığı: haftalık getiriler, korelasyon, Fisher z güven aralıkları, kovalar ve enflasyona göre getiri.",
};

const BOLUMLER = [
  { id: "veri", baslik: "Veri" },
  { id: "haftalik", baslik: "Neden haftalık getiri" },
  { id: "korelasyon", baslik: "Korelasyon ve güven aralığı" },
  { id: "kovalar", baslik: "Kovalar" },
  { id: "sepet", baslik: "Sepet Analizi" },
  { id: "getiri", baslik: "Getiri ve enflasyon" },
  { id: "ilkeler", baslik: "Ne yapmıyoruz" },
] as const;

export default function Yontem() {
  return (
    <Column className="pt-section pb-section-lg">
      <Reveal className="max-w-prose">
        <p className="text-overline uppercase text-ink-subtle">Yöntem</p>
        <h1 className="mt-4 text-display-md text-balance">
          Sayılar nereden geliyor, nasıl hesaplanıyor.
        </h1>
        <p className="mt-5 text-lead text-ink-muted text-pretty">
          {SITE.brand} size ne almanız gerektiğini söylemez; elinizde ne olduğunu
          gösterir. Bunu yapabilmesi için her iddianın ölçülmüş olması, ölçülemeyen
          yerde de susması gerekiyor. Bu sayfa o ölçümün nasıl yapıldığını anlatıyor.
        </p>
      </Reveal>

      <nav
        aria-label="Bu sayfada"
        className="mt-10 max-w-prose rounded-card border border-border bg-surface px-6 py-5"
      >
        <p className="text-label text-ink-subtle">Bu sayfada</p>
        <ol className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {BOLUMLER.map((b, i) => (
            <li key={b.id}>
              <a
                href={`#${b.id}`}
                className="text-body text-ink transition-colors hover:text-accent"
              >
                <span className="mr-2 font-mono text-label text-ink-subtle tabular-nums">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {b.baslik}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-section flex max-w-prose flex-col gap-section">
        <Bolum id="veri" no={1} baslik="Veri">
          <P>
            Fon fiyatları TEFAS&apos;tan (Türkiye Elektronik Fon Alım Satım
            Platformu) alınıyor. Evrende TEFAS üzerinden işlem gören yatırım ve
            emeklilik fonları var, yaklaşık 1.370 fon. Nitelikli yatırımcıya
            açık gayrimenkul ve girişim sermayesi fonları ile TEFAS&apos;ta işlem
            görmeyen fonlar hesaba hiç girmiyor.
          </P>
          <P>
            TEFAS bugünden geriye beş yıl fiyat veriyor, daha eskisini vermiyor.
            Enflasyon verisi TÜİK&apos;in tüketici fiyat endeksi; TCMB&apos;nin EVDS
            servisinden okunuyor.
          </P>
          <P>
            Fon sayfalarındaki her şey her pazartesi 03:00&apos;te (İstanbul)
            yeniden hesaplanıyor: fiyatlar çekiliyor, bütün fon çiftlerinin
            korelasyonu ve her fonun getirisi hesaplanıp veritabanına yazılıyor.
            Sayfalar bu hazır sonuçları okuyor, ziyaret sırasında hiçbir şey
            hesaplanmıyor.
          </P>
          <Not>
            Bir fonun fiyatı çekilemediğinde o fon sessizce listeden düşmüyor:
            neden dışarıda kaldığı kaydediliyor. Çekilemeyen bir istek birkaç
            dakika sonra bir kez daha deneniyor, çünkü &ldquo;istek
            tamamlanmadı&rdquo; ile &ldquo;bu fonun fiyatı yok&rdquo; aynı şey
            değil.
          </Not>
        </Bolum>

        <Bolum id="haftalik" no={2} baslik="Neden haftalık getiri">
          <P>
            Bütün hesaplar haftalık getiriler üzerinden yapılıyor: her haftanın
            son işlem gününün fiyatı (hafta cuma biter) alınıp bir önceki haftaya
            bölünüyor.
          </P>
          <P>
            Günlük veri daha çok gözlem demek, ama Türkiye&apos;de bazı fonlar
            her gün gerçekten fiyatlanmıyor; fiyatı birkaç gün aynı kalıp sonra
            sıçrıyor. Günlük getirilerle bakıldığında bu fonlar hiçbir şeyle
            birlikte hareket etmiyormuş gibi görünür ve aslında tek bir varlığa
            yığılmış bir sepet, dağılmış gibi okunur. Haftalık getiri bu gecikmeyi
            büyük ölçüde emiyor.
          </P>
          <P>
            Eksik günler doldurulmuyor. Bir önceki fiyatı ileri taşımak, var
            olmayan sıfır getirili günler uydurmak ve oynaklığı olduğundan düşük
            göstermek olurdu. Haftalarının %30&apos;undan fazlasında hiç
            fiyat değişmemiş bir fon için korelasyon hükmü hiç verilmiyor; o fon
            fiyatlanmıyor, taşınıyor.
          </P>
        </Bolum>

        <Bolum id="korelasyon" no={3} baslik="Korelasyon ve güven aralığı">
          <P>
            İki fonun ne kadar birlikte hareket ettiği, haftalık getirilerinin
            Pearson korelasyonu ile ölçülüyor: 1 aynı hareket, 0 ilişki yok, −1
            ters hareket. Her çift, iki fonun <em>ortak</em> olduğu haftalar
            üzerinden ölçülüyor; yeni kurulmuş bir fon, eski bir fonla yalnızca
            kendi ömrü kadar karşılaştırılıyor. Yaklaşık 950 bin çiftin hepsi
            tek bir matris işlemiyle, tek seferde hesaplanıyor.
          </P>
          <P>
            Tek bir korelasyon sayısı, kaç haftaya dayandığını söylemez. 30
            haftada ölçülen 0,92 ile 200 haftada ölçülen 0,92 aynı güveni hak
            etmez. Bu yüzden her çift için Fisher z dönüşümüyle %95 güven
            aralığı hesaplanıyor:
          </P>
          <Formul>
            z = artanh(r) &nbsp;·&nbsp; SE = 1 / √(n − 3) &nbsp;·&nbsp; aralık =
            tanh(z ± 1,96 · SE)
          </Formul>
          <AralikOrnegi />
          <P>
            İki çiftin korelasyonu aynı, ama 30 haftalık olanın aralığı alt
            sınırda 0,837&apos;ye kadar iniyor. Hüküm bu aralığa göre verildiği
            için ikisi farklı kovalara düşüyor. 52 haftadan az ortak geçmişi olan
            çiftler için ise hiç hüküm verilmiyor.
          </P>
        </Bolum>

        <Bolum id="kovalar" no={4} baslik="Kovalar">
          <P>
            Her çift bir kovaya konuyor. Kural tek: <strong>hüküm, güven
            aralığının iddiaya karşı olan ucuna bakılarak veriliyor.</strong>{" "}
            &ldquo;Bu iki fon örtüşüyor&rdquo; demek için aralığın alt ucuna,
            &ldquo;ters hareket ediyorlar&rdquo; demek için üst ucuna bakılıyor.
            Böylece az veriye dayanan yüksek bir sayı kendiliğinden güçlü bir iddia
            haline gelmiyor.
          </P>
          <KovaTablosu />
          <P>
            Fon sayfasındaki komşular da sıralı bir liste olarak değil, kova
            kova gösteriliyor. Sıralı bir listede insanlar en üsttekini alır,
            o da örtük bir tavsiye olur. Bir fonun en yakın komşusu da en
            büyük katsayıya göre değil, güven aralığının alt ucuna göre
            seçiliyor: dokuz haftada 0,99 çıkan bir çift, üç yılda 0,95 çıkan
            bir çiftin önüne geçemiyor.
          </P>
        </Bolum>

        <Bolum id="sepet" no={5} baslik={TOOL.name}>
          <P>
            {TOOL.name}, girdiğiniz fonları son beş yılın ortak haftaları
            üzerinden karşılaştırıyor. Bu süre ayarlanamıyor; ne kadar geriye
            bakılacağı kullanıcıya bırakılırsa, yanlış seçim cevabı sessizce
            değiştirir.
          </P>
          <P>
            <strong>Gruplar.</strong> Aralarındaki <em>her</em> çiftin
            korelasyonu 0,85&apos;in üstünde olan fonlar bir grup sayılıyor.
            Zincir yeterli değil: A, B&apos;ye ve B, C&apos;ye benziyor diye A ile
            C aynı gruba girmiyor. Bir fon birden fazla gruba uyuyorsa yalnızca
            en ağır olanında sayılıyor, böylece grup ağırlıkları toplamı %100&apos;ü
            geçmiyor.
          </P>
          <P>
            Bir grubun ne kadar yüksek sesle söylendiği ağırlığına bağlı:
            sepetin yarısından fazlası tek bir grupsa sonuç bununla başlıyor,
            dörtte biri ile yarısı arasındaysa başlıkta adı geçiyor, dörtte
            birinden azsa başlığa çıkmıyor ama altta yazıyor. Bilgi hiçbir
            zaman atılmıyor, yalnızca vurgusu değişiyor.
          </P>
          <P>
            <strong>Çeşitlendirme oranı.</strong> Fonların tek tek
            oynaklıklarının ağırlıklı toplamının, sepetin gerçek oynaklığına
            oranı. 1 çıkıyorsa fonlar tek bir şey gibi hareket ediyor ve birden
            fazla fon tutmak bir şey kazandırmamış demektir; 1&apos;in ne kadar
            üstündeyse, fonların birbirinden bağımsız hareketi o kadar
            birbirini dengeliyor.
          </P>
          <P>
            <strong>Kademeli alım.</strong> Tarihli alımlar girildiğinde
            ağırlıklar ödenen paraya göre değil, bugünkü değere göre
            hesaplanıyor. Getirinin başlığında basit yüzde değil yıllık iç
            verim oranı (XIRR) var: geçen ay yatırılan para, üç yıl önce
            yatırılan kadar çalışmadı. Gerçek bir 36 aylık düzenli alım
            sepetinde basit getiri %136, XIRR ise yıllık %46 çıktı. Oynaklık
            ve en büyük düşüş ise para girişlerinden arındırılmış seri
            üzerinden ölçülüyor; aksi halde her yeni yatırım bir toparlanma
            gibi görünürdü.
          </P>
          <P>
            <strong>İki ölçü ayrıştığında.</strong> Pearson korelasyonu birkaç
            uç haftadan çok etkilenebiliyor. Bu yüzden sonuçta sıralama tabanlı
            Spearman korelasyonu da hesaplanıyor ve ikisi arasındaki fark 0,10&apos;u
            geçen çiftler ayrıca gösteriliyor. Örneğin 24 Aralık 2021 haftası
            (kurun sert döndüğü, altın fonlarının yaklaşık %24, hisse fonlarının
            yaklaşık %20 düştüğü hafta) tek başına bazı çiftlerin Pearson
            katsayısını iki katına çıkarıyor; Spearman ise neredeyse
            kıpırdamıyor. Gruplama yine Pearson&apos;la yapılıyor; fark yalnızca
            bilgi olarak veriliyor.
          </P>
        </Bolum>

        <Bolum id="getiri" no={6} baslik="Getiri ve enflasyon">
          <P>
            Fon sayfalarında getiriler 6 ay, 1 yıl, 3 yıl ve 4 yıl için,
            hem nominal hem de enflasyondan arındırılmış (reel) olarak veriliyor.
          </P>
          <P>
            Pencere bugünde değil, <strong>son yayımlanmış TÜFE ayının
            sonunda</strong> bitiyor. TÜİK bir ayın endeksini ertesi ayın
            başında yayımlıyor; son birkaç haftanın fiyatlarının arkasında henüz
            bir endeks yok. İki rakam da aynı pencerede ölçülüyor: bugüne kadar
            giden bir nominal getiriyi geçen aya kadar giden bir reel getirinin
            yanına koymak, aradaki farkı enflasyon gibi gösterirdi. Endeks hiçbir
            zaman tahmin edilmiyor ya da ileri taşınmıyor.
          </P>
          <P>
            5 yıllık getiri yok. TEFAS beş yıldan eskisini vermiyor, pencere de
            son TÜFE ayında bittiği için 60 aylık bir pencere o sınırın
            öncesine taşıyor. Ölçülebilen en uzun yuvarlak pencere 48 ay; 48
            aya &ldquo;5 yıl&rdquo; demek bu sitenin yapmadığı şey.
          </P>
          <P>
            Bir fonun geçmişi bir dönemi kapsamıyorsa o dönem için sayı
            verilmiyor; daha kısa bir süreden hesaplanıp aynı etiketle
            gösterilmiyor. Yönetim ücreti fon fiyatının içinde olduğu için
            getiriler ücret düşülmüş haliyle; vergi hesaba katılmıyor.
          </P>
        </Bolum>

        <Bolum id="ilkeler" no={7} baslik="Ne yapmıyoruz">
          <ul className="flex flex-col gap-3">
            <Ilke baslik="Yatırım tavsiyesi vermiyoruz.">
              Hangi fonu almanız ya da satmanız gerektiğini söylemiyoruz. Kişiye
              özel yatırım danışmanlığı SPK düzenlemesine tabi; bu site yalnızca
              kamuya açık fiyatlardan ölçüm yapıyor.
            </Ilke>
            <Ilke baslik="Ölçemediğimizi iddia etmiyoruz.">
              Yeterli veri yoksa hüküm yok, tahmin de yok. &ldquo;Yetersiz
              veri&rdquo; de bir sonuç.
            </Ilke>
            <Ilke baslik="Sepete not vermiyoruz.">
              Bir sepete &ldquo;güvenli&rdquo; ya da &ldquo;iyi dağılmış&rdquo;
              demiyoruz. Ne bulduğumuzu söylüyoruz; bir şey bulamadıysak onu da
              teselli etmeden söylüyoruz.
            </Ilke>
            <Ilke baslik="Fonları renkle yargılamıyoruz.">
              Yakın bir komşu iyi haber, uzak bir komşu kötü haber değil; bu
              yüzden korelasyon yeşil ya da kırmızıyla boyanmıyor. Yeşil ve
              kırmızı yalnızca paraya, yani getirilere ait.
            </Ilke>
            <Ilke baslik="Geçmiş, geleceğin garantisi değil.">
              Buradaki her sayı geçmiş fiyatlardan. İki fonun şimdiye kadar
              birlikte hareket etmiş olması, bundan sonra da öyle yapacağı
              anlamına gelmiyor.
            </Ilke>
          </ul>
        </Bolum>

        <div className="flex flex-wrap gap-3 border-t border-border pt-8">
          <Link
            href={TOOL.href}
            className="inline-flex items-center rounded-control bg-accent px-6 py-3.5 text-body font-medium text-accent-ink transition-colors hover:bg-accent-hover"
          >
            {TOOL.name}&apos;ni dene
          </Link>
          <Link
            href={FUND_BASE}
            className="inline-flex items-center rounded-control border border-border-strong bg-surface px-6 py-3.5 text-body font-medium text-ink transition-colors hover:border-accent hover:text-accent"
          >
            Fonlara göz at
          </Link>
        </div>
      </div>
    </Column>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function Bolum({
  id,
  no,
  baslik,
  children,
}: {
  id: string;
  no: number;
  baslik: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-baslik`} className="scroll-mt-24">
      <p className="font-mono text-label text-accent tabular-nums">
        {String(no).padStart(2, "0")}
      </p>
      <h2 id={`${id}-baslik`} className="mt-2 text-display-sm text-balance">
        {baslik}
      </h2>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-body text-ink-muted text-pretty">{children}</p>;
}

function Not({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-control border-l-2 border-accent bg-accent-surface px-4 py-3 text-caption text-ink text-pretty">
      {children}
    </p>
  );
}

function Formul({ children }: { children: React.ReactNode }) {
  return (
    <p className="overflow-x-auto rounded-control border border-border bg-canvas-sunken px-4 py-3 font-mono text-caption text-ink">
      {children}
    </p>
  );
}

function Ilke({
  baslik,
  children,
}: {
  baslik: string;
  children: React.ReactNode;
}) {
  return (
    <li className="rounded-card border border-border bg-surface px-5 py-4">
      <p className="text-body font-medium text-ink">{baslik}</p>
      <p className="mt-1 text-caption text-ink-muted text-pretty">{children}</p>
    </li>
  );
}

/**
 * The same coefficient on two sample sizes, against the overlapping line.
 * Computed: r = 0,92 → (0,837 – 0,962) at n = 30, (0,896 – 0,939) at n = 200.
 * The axis runs 0,75 to 1 so the difference is visible at all.
 */
function AralikOrnegi() {
  const lo = 0.75;
  const hi = 1;
  // Narrow on purpose: the figure scales to the column, and a narrow
  // viewBox is what keeps its 13px labels readable at 375px wide.
  const W = 420;
  const pad = 16;
  const x = (v: number) => pad + ((v - lo) / (hi - lo)) * (W - 2 * pad);
  const rows = [
    { n: 30, a: 0.837, b: 0.962, kova: "benzer", y: 40 },
    { n: 200, a: 0.896, b: 0.939, kova: "örtüşen", y: 92 },
  ];

  return (
    <figure className="rounded-card border border-border bg-surface px-4 pt-4 pb-3 sm:px-5">
      <svg
        viewBox={`0 0 ${W} 152`}
        className="block w-full"
        role="img"
        aria-label="Aynı 0,92 korelasyonu: 30 haftada güven aralığı 0,837 ile 0,962 arası, 200 haftada 0,896 ile 0,939 arası. Örtüşen eşiği 0,85."
      >
        <line
          x1={x(0.85)}
          x2={x(0.85)}
          y1={20}
          y2={126}
          stroke="var(--ink-subtle)"
          strokeDasharray="3 4"
        />
        <text x={x(0.85) + 6} y={14} fontSize={12} fill="var(--ink-subtle)">
          örtüşen eşiği 0,85
        </text>
        {rows.map((r) => (
          <g key={r.n}>
            <text x={pad} y={r.y} fontSize={13} fill="var(--ink)">
              {r.n} hafta{" "}
              <tspan fill="var(--ink-subtle)">→ {r.kova}</tspan>
            </text>
            <rect
              x={x(r.a)}
              y={r.y + 10}
              width={x(r.b) - x(r.a)}
              height={14}
              rx={4}
              fill="var(--accent)"
              opacity={0.28}
            />
            <circle
              cx={x(0.92)}
              cy={r.y + 17}
              r={6}
              fill="var(--accent)"
              stroke="var(--surface)"
              strokeWidth={2}
            />
          </g>
        ))}
        <line x1={pad} x2={W - pad} y1={132} y2={132} stroke="var(--border-strong)" />
        {[0.75, 0.8, 0.85, 0.9, 0.95, 1].map((t, i, all) => (
          <text
            key={t}
            x={x(t)}
            y={148}
            fontSize={12}
            textAnchor={i === 0 ? "start" : i === all.length - 1 ? "end" : "middle"}
            fill="var(--ink-subtle)"
          >
            {t.toFixed(2).replace(".", ",")}
          </text>
        ))}
      </svg>
      <figcaption className="mt-2 text-caption text-ink-subtle text-pretty">
        İki çiftin korelasyonu da 0,92. Nokta katsayıyı, bant %95 güven
        aralığını gösteriyor. Örtüşen demek için bandın tamamı çizginin sağında
        olmalı.
      </figcaption>
    </figure>
  );
}

const KOVALAR: {
  ad: string;
  kural: string;
  /** Where on −1..1 the bucket's interval must sit, for the little scale. */
  bolge: [number, number];
  ton: "accent" | "alt" | "notr";
}[] = [
  { ad: "Örtüşen", kural: "Alt uç 0,85'in üstünde", bolge: [0.85, 1], ton: "accent" },
  { ad: "Benzer", kural: "Alt uç 0,60'ın üstünde", bolge: [0.6, 1], ton: "accent" },
  { ad: "Orta", kural: "Aralığın tamamı 0,30 ile 0,60 arasında", bolge: [0.3, 0.6], ton: "notr" },
  { ad: "İlişkisiz", kural: "Aralığın tamamı −0,30 ile 0,30 arasında", bolge: [-0.3, 0.3], ton: "notr" },
  { ad: "Ters", kural: "Üst uç −0,60'ın altında", bolge: [-1, -0.6], ton: "alt" },
  { ad: "Belirsiz", kural: "Aralık bir eşiğin iki yanına taşıyor", bolge: [0, 0], ton: "notr" },
  { ad: "Yetersiz veri", kural: "52 haftadan az ortak geçmiş ya da fiyatı çoğunlukla değişmeyen fon", bolge: [0, 0], ton: "notr" },
];

function KovaTablosu() {
  const W = 120;
  const x = (v: number) => 2 + ((v + 1) / 2) * (W - 4);
  const fill = { accent: "var(--accent)", alt: "var(--series-alt)", notr: "var(--ink-subtle)" };

  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-border text-label text-ink-subtle">
            <th scope="col" className="px-4 py-2.5 font-normal sm:px-5">Kova</th>
            <th scope="col" className="px-4 py-2.5 font-normal">Kural (%95 aralık)</th>
            <th scope="col" className="hidden py-2.5 pr-5 font-normal sm:table-cell">
              <span className="sr-only">Ölçek</span>
              <span aria-hidden className="flex w-[120px] justify-between">
                <span>−1</span>
                <span>0</span>
                <span>1</span>
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {KOVALAR.map((k) => (
            <tr key={k.ad} className="border-t border-border first:border-t-0 align-top">
              <th scope="row" className="px-4 py-3 text-body font-medium text-ink sm:px-5">
                {k.ad}
              </th>
              <td className="px-4 py-3 text-caption text-ink-muted text-pretty">{k.kural}</td>
              <td className="hidden py-3.5 pr-5 sm:table-cell">
                <svg viewBox={`0 0 ${W} 14`} className="block h-3.5 w-[120px]" aria-hidden="true">
                  <line x1={2} x2={W - 2} y1={7} y2={7} stroke="var(--border-strong)" strokeWidth={2} strokeLinecap="round" />
                  <line x1={x(0)} x2={x(0)} y1={2} y2={12} stroke="var(--border-strong)" />
                  {k.bolge[1] > k.bolge[0] && (
                    <rect
                      x={x(k.bolge[0])}
                      width={x(k.bolge[1]) - x(k.bolge[0])}
                      y={2}
                      height={10}
                      rx={3}
                      fill={fill[k.ton]}
                      opacity={0.55}
                    />
                  )}
                </svg>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
