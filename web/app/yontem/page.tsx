import type { Metadata } from "next";
import Link from "next/link";

import { Column } from "@/components/column";
import { Numara } from "@/components/method/numara";
import { Formula, Tex } from "@/components/method/tex";
import { TocCard, TocRail } from "@/components/method/toc";
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
  { id: "veri", baslik: "Veri", ozet: "Fiyatlar nereden geliyor, ne sıklıkla yenileniyor" },
  { id: "haftalik", baslik: "Neden haftalık getiri", ozet: "Seyrek fiyatlanan fonlar ve günlük verinin tuzağı" },
  { id: "korelasyon", baslik: "Korelasyon ve güven aralığı", ozet: "Tek bir sayı neden yetmiyor" },
  { id: "kovalar", baslik: "Kovalar", ozet: "Hangi çifte hangi hüküm, hangi kuralla" },
  { id: "sepet", baslik: "Sepet Analizi", ozet: "Gruplar, çeşitlendirme ve kademeli alım" },
  { id: "getiri", baslik: "Getiri ve enflasyon", ozet: "Nominal ve reel getiri aynı pencerede" },
  { id: "risk-ucret", baslik: "Risk, dolar ve ücret", ozet: "Oynaklık, düşüş, risk payı ve yıllık ücret" },
  { id: "donemler", baslik: "Dönemler", ozet: "Bir yılın ilişkileri diğer yıllardan ne zaman ayrılıyor" },
  { id: "ilkeler", baslik: "Ne yapmıyoruz", ozet: "Tavsiye, not ve ölçülemeyen iddialar" },
] as const;

export default function Yontem() {
  return (
    <Column className="pt-section pb-section-lg">
      <Reveal className="max-w-prose">
        <p className="text-overline uppercase text-ink-subtle">Yöntem</p>
        <h1 className="mt-4 text-display-md text-balance">
          Sayılarımızın arkasında ne var
        </h1>
        <p className="mt-5 text-lead text-ink-muted text-pretty">
          {SITE.brand} size ne almanız gerektiğini söylemez; elinizde ne olduğunu
          gösterir. Bu iddiayı ciddiye alabilmeniz için her sayının nereden
          geldiğini açıkça yazmamız gerekiyor. Bu sayfada tam olarak bunu
          yapıyoruz: hangi veriyi kullandığımızı, nasıl hesapladığımızı ve bilerek
          neleri yapmadığımızı anlatıyoruz.
        </p>
      </Reveal>

      <div className="mt-10 max-w-prose lg:hidden">
        <TocCard items={BOLUMLER} />
      </div>

      <div className="mt-section lg:mt-14 lg:grid lg:grid-cols-[minmax(0,1fr)_13rem] lg:gap-16">
        <div className="flex max-w-prose flex-col gap-section">
          <Bolum id="veri" no={1} baslik="Veri">
            <P>
              Fiyatları doğrudan TEFAS’tan alıyoruz. TEFAS üzerinden alınıp
              satılabilen bütün yatırım ve emeklilik fonlarına bakıyoruz; bu şu
              an 1.370 civarında fon ediyor. Yalnızca nitelikli yatırımcıya açık
              gayrimenkul ve girişim sermayesi fonlarını ve TEFAS’ta işlem
              görmeyen fonları dışarıda bırakıyoruz. Çoğu kişinin zaten
              alamayacağı fonları hesaba katmanın anlamı yok.
            </P>
            <P>
              TEFAS geriye doğru en fazla beş yıllık fiyat veriyor; bizim de
              bakabildiğimiz en uzak nokta bu. Enflasyon için TÜİK’in tüketici
              fiyat endeksini kullanıyoruz, onu da Merkez Bankası’nın EVDS
              servisinden çekiyoruz.
            </P>
            <P>
              Her pazartesi sabah 03:00’te bütün hesabı baştan yapıyoruz:
              fiyatları çekiyor, yaklaşık 950 bin fon çiftinin korelasyonunu ve
              her fonun getirisini hesaplayıp kaydediyoruz. Siz bir fon sayfasını
              açtığınızda o an hiçbir şey hesaplanmıyor; gördüğünüz şey, pazartesi
              sabahı hazırlanmış sonuç.
            </P>
            <Not>
              Bir fonun fiyatını çekemediğimizde onu sessizce listeden silmiyoruz.
              Önce birkaç dakika bekleyip bir kez daha deniyoruz, çünkü “TEFAS o
              an cevap vermedi” ile “bu fonun fiyatı yok” çok farklı şeyler.
              İkinci denemede de olmazsa fonu dışarıda bırakıyoruz, ama nedenini
              kaydediyoruz.
            </Not>
          </Bolum>

          <Bolum id="haftalik" no={2} baslik="Neden haftalık getiri">
            <P>
              Günlük değil, haftalık getirilerle çalışıyoruz. Her haftanın son
              işlem günündeki fiyatı bir önceki haftanınkiyle karşılaştırıyoruz:
            </P>
            <Formula tex={String.raw`r_t = \frac{P_t}{P_{t-1}} - 1`}>
              <Tex>{"P_t"}</Tex>, fonun <Tex>{"t"}</Tex> haftasındaki son fiyatı.
              Haftalarımız cuma günü bitiyor.
            </Formula>
            <P>
              İlk bakışta günlük veri daha iyi gibi duruyor, sonuçta daha çok
              gözlem demek. Ama Türkiye’de bazı fonların fiyatı her gün gerçekten
              değişmiyor: birkaç gün aynı kalıyor, sonra bir anda sıçrıyor. Günlük
              veriyle bakınca bu fonlar hiçbir şeyle birlikte hareket etmiyormuş
              gibi görünüyor. Sonuç tehlikeli: aslında tek bir şeye yatırılmış bir
              sepet, güzelce dağılmış gibi çıkıyor. Haftalık veride bu gecikmeler
              büyük ölçüde kayboluyor.
            </P>
            <P>
              Eksik günleri de doldurmuyoruz. Önceki günün fiyatını ileri taşımak
              kolay olurdu, ama bu hiç yaşanmamış “sıfır getirili” günler
              uydurmak demek; fon da olduğundan daha sakin görünür. Haftalarının
              %30’undan fazlasında fiyatı hiç kıpırdamamış bir fon hakkında ise
              korelasyon hükmü vermiyoruz. Öyle bir fonun fiyatı piyasayı değil,
              fiyatlama takvimini yansıtıyor.
            </P>
          </Bolum>

          <Bolum id="korelasyon" no={3} baslik="Korelasyon ve güven aralığı">
            <P>
              İki fonun ne kadar birlikte hareket ettiğini, haftalık getirilerinin
              korelasyonuyla ölçüyoruz. 1 tamamen aynı hareket, 0 hiçbir ilişki
              yok, −1 tam ters hareket demek.
            </P>
            <Formula
              tex={String.raw`\rho_{AB} = \frac{\sum_t \bigl(r^A_t - \bar r^A\bigr)\bigl(r^B_t - \bar r^B\bigr)}{\sqrt{\sum_t \bigl(r^A_t - \bar r^A\bigr)^2}\;\sqrt{\sum_t \bigl(r^B_t - \bar r^B\bigr)^2}}`}
            >
              Standart Pearson korelasyonu, tek bir farkla: toplamları yalnızca
              iki fonun da fiyatı olan haftalar üzerinden alıyoruz. Geçen yıl
              kurulmuş bir fonu, on yıllık bir fonla ancak kendi ömrü kadar
              karşılaştırabiliriz.
            </Formula>
            <P>
              Burada çoğu yerde atlanan bir sorun var: tek bir korelasyon sayısı,
              kaç haftalık veriye dayandığını söylemez. 30 haftada çıkmış 0,92 ile
              200 haftada çıkmış 0,92 aynı şey değil; ilki şansa çok daha açık. Bu
              yüzden her çiftin sayısının etrafına %95 güven aralığı koyuyoruz.
              Bunun için Fisher z dönüşümünü kullanıyoruz:
            </P>
            <Formula
              tex={String.raw`\begin{aligned}
z &= \operatorname{artanh}(r) = \tfrac{1}{2}\ln\frac{1+r}{1-r} \\[4pt]
\mathrm{SE} &= \frac{1}{\sqrt{n-3}} \\[4pt]
\bigl[\,r_{\text{alt}},\; r_{\text{üst}}\,\bigr] &= \bigl[\tanh(z - 1{,}96\,\mathrm{SE}),\; \tanh(z + 1{,}96\,\mathrm{SE})\bigr]
\end{aligned}`}
            >
              Korelasyonu önce <Tex>{"z"}</Tex> ölçeğine çeviriyor, aralığı orada
              kuruyor, sonra geri çeviriyoruz. <Tex>{"n"}</Tex> iki fonun ortak
              hafta sayısı; veri azaldıkça SE büyüyor, aralık da genişliyor.
            </Formula>
            <AralikOrnegi />
            <P>
              İki çiftin korelasyonu tıpatıp aynı. Ama 30 haftalık olanın aralığı
              0,837’ye kadar iniyor; yani “örtüşüyorlar” diyecek kadar emin
              olamıyoruz. 200 haftalık olan ise rahatça eşiğin üstünde kalıyor.
              Ortak geçmişi 52 haftadan kısa olan çiftler hakkında ise hiç hüküm
              vermiyoruz.
            </P>
          </Bolum>

          <Bolum id="kovalar" no={4} baslik="Kovalar">
            <P>
              Her çifti bir kovaya koyuyoruz ve bunu yaparken tek bir kurala
              uyuyoruz: <strong>iddiamıza karşı çıkan uca bakıyoruz.</strong>{" "}
              “Bu iki fon örtüşüyor” diyeceksek, aralığın alt ucu bile yeterince
              yüksek olmalı. “Ters hareket ediyorlar” diyeceksek, üst ucu bile
              yeterince düşük olmalı. Böylece az veriden çıkmış parlak bir sayı,
              kendiliğinden güçlü bir iddiaya dönüşemiyor.
            </P>
            <KovaTablosu />
            <P>
              Fon sayfalarında komşuları da sıralı bir liste olarak değil, bu
              kovalara ayırarak gösteriyoruz. Sebebi basit: sıralı bir listede
              insanlar en üsttekini seçer, o da farkında olmadan bir tavsiyeye
              dönüşür. Bir fonun “en yakın komşusunu” seçerken de en büyük sayıya
              değil, aralığın alt ucuna bakıyoruz. Yoksa dokuz haftalık veriyle
              0,99 çıkmış bir çift, üç yıl boyunca 0,95’te kalmış bir çiftin önüne
              geçerdi.
            </P>
          </Bolum>

          <Bolum id="sepet" no={5} baslik={TOOL.name}>
            <P>
              {TOOL.name}’ne fonlarınızı girdiğinizde, hepsinin birlikte
              fiyatlandığı haftalara son beş yıl üzerinden bakıyoruz. Bu süreyi
              değiştirmenize bilerek izin vermiyoruz. Ne kadar geriye
              bakılacağını seçmek sonucu fark ettirmeden değiştirebilecek bir
              karar, ve bu yükü size bırakmak istemiyoruz.
            </P>
            <P>
              <strong>Gruplar.</strong> Aralarındaki <em>her</em> çiftin
              korelasyonu 0,85’in üstündeyse, o fonları bir grup sayıyoruz. “Her
              çift” kısmı önemli: A, B’ye, B de C’ye benziyor diye A ile C’yi
              aynı gruba koymuyoruz. Bir fon birden fazla gruba uyuyorsa onu
              yalnızca en ağır grupta sayıyoruz; böylece grupların toplam
              ağırlığı hiçbir zaman %100’ü aşmıyor.
            </P>
            <P>
              Bir grubu ne kadar öne çıkaracağımız da ağırlığına bağlı. Sepetinizin
              yarısından fazlası tek bir gruptaysa söze bununla başlıyoruz.
              Dörtte biriyle yarısı arasındaysa başlıkta adını anıyoruz. Dörtte
              birden azsa başlığa taşımıyoruz ama aşağıda mutlaka yazıyoruz. Hiçbir
              bulguyu saklamıyoruz, sadece sesini ayarlıyoruz.
            </P>
            <P>
              <strong>Çeşitlendirme oranı.</strong> Fonlarınızın tek tek ne kadar
              oynak olduğunu, sepetin bütün olarak ne kadar oynak olduğuyla
              karşılaştırıyoruz:
            </P>
            <Formula tex={String.raw`\text{ÇO} = \frac{\sum_i w_i\,\sigma_i}{\sigma_p}`}>
              <Tex>{"w_i"}</Tex> fonun sepetteki payı, <Tex>{"\\sigma_i"}</Tex>{" "}
              kendi oynaklığı, <Tex>{"\\sigma_p"}</Tex> sepetin oynaklığı. Oran 1
              çıkıyorsa fonlarınız tek bir şeymiş gibi hareket ediyor ve birden
              fazla fon tutmak size bir şey kazandırmamış. 1’in ne kadar
              üstündeyse, fonlar birbirinin dalgalanmasını o kadar dengeliyor.
            </Formula>
            <P>
              <strong>Kademeli alım.</strong> Alımlarınızı tarihleriyle
              girdiğinizde iki şey değişiyor. Birincisi, ağırlıkları yatırdığınız
              paraya göre değil, bugünkü değere göre hesaplıyoruz. İkincisi,
              getiriyi basit yüzdeyle göstermiyoruz, çünkü geçen ay yatırdığınız
              para üç yıl önce yatırdığınız kadar çalışmadı. Onun yerine yıllık iç
              verim oranını (XIRR) kullanıyoruz:
            </P>
            <Formula tex={String.raw`\sum_{k} \frac{C_k}{(1+x)^{(t_k - t_0)/365}} = 0`}>
              <Tex>{"C_k"}</Tex> her alımda cebinizden çıkan para (eksi) ve
              bugünkü değer (artı), <Tex>{"t_k"}</Tex> de tarihi. Denklemi sıfır
              yapan <Tex>{"x"}</Tex> yıllık getiriniz. Böyle bir oran
              bulunamıyorsa sayı uydurmuyoruz, boş bırakıyoruz.
            </Formula>
            <P>
              Farkın ne kadar büyük olabileceğini gerçek bir örnekte gördük: 36 ay
              boyunca her ay alım yapılan bir sepette basit getiri %136 çıkarken,
              XIRR yıllık %46 çıktı. Oynaklığı ve en büyük düşüşü ise para
              girişlerinden arındırılmış seri üzerinden ölçüyoruz; yoksa her yeni
              yatırımınız grafikte bir toparlanma gibi görünürdü.
            </P>
            <P>
              <strong>İki ölçü ayrıştığında.</strong> Pearson korelasyonunun bir
              zaafı var: birkaç uç hafta onu epey oynatabiliyor. 24 Aralık 2021
              haftasını hatırlayın. Kur sert döndü; altın fonları bir haftada
              yaklaşık %24, hisse fonları %20 civarında düştü. O tek hafta, bazı
              fon çiftlerinin korelasyonunu neredeyse iki katına çıkarıyor. Bu
              yüzden yanına sıralamaya dayanan Spearman korelasyonunu da
              hesaplıyoruz; o bu tür haftalardan pek etkilenmiyor. İkisi
              arasındaki fark 0,10’u geçen çiftleri ayrıca gösteriyoruz. Grupları
              yine Pearson’la kuruyoruz; aradaki fark size ek bilgi olarak
              veriliyor.
            </P>
          </Bolum>

          <Bolum id="getiri" no={6} baslik="Getiri ve enflasyon">
            <P>
              Fon sayfalarında getirileri 6 ay, 1 yıl, 3 yıl ve 4 yıl için
              veriyoruz; hem nominal hem de enflasyondan arındırılmış (reel)
              olarak.
            </P>
            <P>
              Burada küçük ama önemli bir ayrıntı var: pencereyi bugün değil,{" "}
              <strong>son açıklanan enflasyon ayının sonunda</strong> bitiriyoruz.
              TÜİK bir ayın enflasyonunu ertesi ayın başında açıklıyor; yani son
              birkaç haftanın fiyatlarının karşılığında henüz bir enflasyon rakamı
              yok. Nominal getiriyi bugüne kadar, reel getiriyi geçen aya kadar
              hesaplasaydık, aradaki fark enflasyonmuş gibi görünürdü. Oysa bir
              kısmı sadece fazladan geçen haftalar olurdu. Bu yüzden ikisini de
              aynı pencerede ölçüyoruz ve enflasyonu hiçbir zaman tahmin
              etmiyoruz.
            </P>
            <Formula
              tex={String.raw`R_{\text{reel}} = \frac{1 + R_{\text{nominal}}}{1 + \pi} - 1, \qquad \pi = \frac{\text{TÜFE}_{\text{bitiş}}}{\text{TÜFE}_{\text{başlangıç}}} - 1`}
            >
              Nominal getiri de enflasyon da aynı başlangıç ve bitiş ayı arasında
              ölçülüyor.
            </Formula>
            <P>
              “5 yıllık getiri neden yok?” diye sorabilirsiniz. TEFAS beş yıldan
              eskisini vermiyor; pencere de son enflasyon ayında bittiği için tam
              60 aylık bir pencere o sınırın biraz gerisine taşıyor. Ölçebildiğimiz
              en uzun yuvarlak dönem 48 ay. 48 aya “5 yıl” demek ise yapmayacağımız
              bir şey.
            </P>
            <P>
              Aynı nedenle, bir fonun geçmişi bir dönemi kapsamıyorsa o dönem
              için sayı göstermiyoruz; daha kısa bir süreden hesaplayıp aynı
              etiketi yapıştırmıyoruz. Yönetim ücreti zaten fon fiyatının içinde,
              yani gördüğünüz getiriler ücret düşülmüş hali. Vergiyi ise hesaba
              katmıyoruz.
            </P>
          </Bolum>

          <Bolum id="risk-ucret" no={7} baslik="Risk, dolar ve ücret">
            <P>
              Fon sayfasında her dönem için getirinin yanında üç sayı daha
              veriyoruz. <strong>Yıllık oynaklık</strong>, haftalık getirilerin
              standart sapmasının yıla çevrilmiş hali.{" "}
              <strong>En büyük düşüş</strong>, dönem içindeki bir zirveden sonraki
              en derin dibe kadar kaybedilen değer. İkisini de haftalık
              fiyatlardan hesaplıyoruz; hafta içinde görülüp aynı hafta geri
              dönülen bir dip bu yüzden görünmeyebilir.{" "}
              <strong>Dolar bazında getiri</strong> ise TL getirinin, dönemin ilk
              ve son iş günündeki TCMB dolar alış kuruyla dolara çevrilmiş hali.
              Üçü de getiriyle aynı pencerede ölçülüyor.
            </P>
            <Formula
              tex={String.raw`\sigma = s\big(r_{\text{hafta}}\big)\sqrt{52}, \qquad R_{\text{USD}} = \big(1 + R_{\text{TL}}\big)\,\frac{\text{kur}_{\text{başlangıç}}}{\text{kur}_{\text{bitiş}}} - 1`}
            >
              Oynaklık haftalık getirilerden; dolar getirisi, TL getirinin kur
              değişimiyle düzeltilmiş hali.
            </Formula>
            <P>
              Sepet Analizi ve piyasa haritası ayrıca{" "}
              <strong>dalgalanmadaki payı</strong> gösteriyor: sepetin haftalık
              dalgalanmasının (varyansının) ne kadarının hangi fondan ya da
              gruptan geldiği. Paylar toplamda yüzde 100 ediyor. Paradaki payından
              büyük bir pay, o fonun sepeti ağırlığından fazla salladığı anlamına
              geliyor. Diğerlerine ters hareket eden bir fonun payı ise eksi
              çıkabiliyor. Piyasa haritasında aynı hesabı, ölçtüğümüz bütün fonları
              büyüklükleri oranında tutan tek bir sepet için yapıyoruz.
            </P>
            <Formula
              tex={String.raw`\text{Pay}_i = \frac{w_i\,(\Sigma w)_i}{w^{\top}\Sigma\, w}, \qquad \sum_i \text{Pay}_i = 1`}
            >
              w ağırlıklar, Σ haftalık getirilerin kovaryans matrisi.
            </Formula>
            <P>
              <strong>Yıllık ücret</strong>, TEFAS’ın fon karşılaştırma
              sayfasında yayımladığı, fonun <em>uyguladığı</em> yönetim ücreti;
              emeklilik fonlarında aynı alan fon işletim giderini taşıyor, biz de
              öyle adlandırıyoruz. İç tüzükte yazan üst sınırı ve fon türü için
              konulan azami gider oranını kullanmıyoruz; ikisi de fonun gerçekte
              aldığı ücret değil. Ücret her gün fonun değerinden düşüldüğü için
              bütün getirilerimizin içinde zaten var; hiçbir şeyden ayrıca
              çıkarmıyoruz. Aynı hareket eden fonların ücretlerini yan yana
              gösteriyoruz ama ücrete göre sıralamıyor, “en ucuz” demiyoruz: hangi
              fonu tutacağınız sizin kararınız.
            </P>
          </Bolum>

          <Bolum id="donemler" no={8} baslik="Dönemler">
            <P>
              Dört yıl boyunca ölçülen bir korelasyon, farklı dönemlerin
              ortalamasıdır. Türk hisseleri ile altın 2025’te çoğunlukla ters
              yönde, 2026’da aynı yönde hareket etti; dört yılın ortalaması
              ikisini de “ilişkisiz” gösteriyor, ki bu iki yılın hiçbirini
              anlatmıyor. Piyasa haritasındaki dönem bölümü bu yüzden her
              takvim yılını ayrı ölçüyor.
            </P>
            <P>
              Sekiz varlık sınıfını, adlar bölümünde anlattığımız temsilci
              fonlarla temsil ediyoruz. Her yıl ve her ikili için o yılın
              korelasyonunu, <strong>diğer yılların haftalarındaki</strong>{" "}
              korelasyonla karşılaştırıyoruz. Bütün dönemle değil, çünkü bütün
              dönem o yılı da içeriyor; iki örneklem ortak hafta paylaşmayınca
              standart iki örneklem sınaması geçerli oluyor.
            </P>
            <Formula
              tex={String.raw`z = \frac{\operatorname{artanh} r_{\text{yıl}} - \operatorname{artanh} r_{\text{diğer}}}{\sqrt{\frac{1}{n_{\text{yıl}} - 3} + \frac{1}{n_{\text{diğer}} - 3}}}`}
            >
              Fisher dönüşümüyle iki korelasyonun farkı, standart hatasına
              bölünüyor.
            </Formula>
            <P>
              Sekiz sınıf 28 ikili ediyor; bir yılda 28 sınamayı birden
              yapınca, hiçbir şey değişmemiş olsa bile yüzde 5 eşikte bir
              ikisinin “farklı” çıkması beklenir. Bunu önlemek için eşiği
              Bonferroni düzeltmesiyle yükseltiyoruz: bir farkı ancak{" "}
              <strong>|z| 3,12’yi</strong> geçerse gösteriyoruz. Böylece bir
              yılda gösterdiğimiz ikililer arasında tesadüfen oraya düşmüş en az
              bir tane bulunma olasılığı yüzde 5’in altında kalıyor. Bu kuralla
              hiçbir ikilinin ayrılmadığı yıllar da çıkıyor, ve bunu da öyle
              söylüyoruz.
            </P>
            <P>
              Fiyat tablomuz 2022’nin ortasından başladığı için ilk ve son yıl
              eksik; ikisini de kapsadıkları aylarla birlikte gösteriyoruz. Bir
              yılı en az 20 hafta veri varsa ölçüyoruz.
            </P>
          </Bolum>

          <Bolum id="ilkeler" no={9} baslik="Ne yapmıyoruz">
            <ul className="flex flex-col gap-3">
              <Ilke baslik="Yatırım tavsiyesi vermiyoruz.">
                Hangi fonu almanız ya da satmanız gerektiğini söylemiyoruz.
                Kişiye özel yatırım danışmanlığı SPK düzenlemesine tabi bir iş;
                biz yalnızca herkese açık fiyatlar üzerinden ölçüm yapıyoruz.
              </Ilke>
              <Ilke baslik="Ölçemediğimizi iddia etmiyoruz.">
                Yeterli veri yoksa ne hüküm veriyoruz ne tahmin yürütüyoruz.
                “Yetersiz veri” de dürüst bir cevap.
              </Ilke>
              <Ilke baslik="Sepetinize not vermiyoruz.">
                Sepetinize “güvenli” ya da “iyi dağılmış” demiyoruz. Ne bulduysak
                onu söylüyoruz; bir şey bulamadıysak, bunu da sizi rahatlatmaya
                çalışmadan söylüyoruz.
              </Ilke>
              <Ilke baslik="Fonları renkle yargılamıyoruz.">
                İki fonun birbirine yakın çıkması iyi haber, uzak çıkması kötü
                haber değil. Bu yüzden korelasyonları yeşile ya da kırmızıya
                boyamıyoruz; o renkleri yalnızca paraya, yani getirilere
                ayırıyoruz.
              </Ilke>
              <Ilke baslik="Geçmişi geleceğe satmıyoruz.">
                Buradaki her sayı geçmiş fiyatlardan geliyor. İki fonun bugüne
                kadar birlikte hareket etmiş olması, bundan sonra da öyle
                yapacakları anlamına gelmiyor.
              </Ilke>
            </ul>
          </Bolum>

          <div className="flex flex-wrap gap-3 border-t border-border pt-8">
            <Link
              href={TOOL.href}
              className="inline-flex items-center rounded-control bg-accent px-6 py-3.5 text-body font-medium text-accent-ink transition-colors hover:bg-accent-hover"
            >
              Sepetinizi inceleyin
            </Link>
            <Link
              href={FUND_BASE}
              className="inline-flex items-center rounded-control border border-border-strong bg-surface px-6 py-3.5 text-body font-medium text-ink transition-colors hover:border-accent hover:text-accent"
            >
              Fonlara göz atın
            </Link>
          </div>
        </div>

        <aside>
          <TocRail items={BOLUMLER} />
        </aside>
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
    <section id={id} aria-labelledby={`${id}-baslik`} className="scroll-mt-28 sm:scroll-mt-24">
      <div className="flex items-center gap-3">
        <Numara n={no} size="md" />
        <h2 id={`${id}-baslik`} className="text-display-sm text-balance">
          {baslik}
        </h2>
      </div>
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
        İki çiftin de korelasyonu 0,92. Nokta katsayıyı, bant %95 güven
        aralığını gösteriyor. “Örtüşüyor” diyebilmemiz için bandın tamamının
        çizginin sağında kalması gerekiyor.
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
