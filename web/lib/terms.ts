/**
 * What the technical words mean, in one place.
 *
 * The page already explains every one of these in the prose around them, but
 * that prose is a paragraph away from the number it describes and a reader
 * who does not know the word cannot tell which sentence is the one that
 * would tell them. So the definition also sits on the term itself.
 *
 * Two rules, and they are the reason these are separate from the sentences
 * in `lib/result`.
 *
 * **A definition, not a reading.** What a diversification ratio *is*, never
 * whether 1,02 is a good one. The page reports and does not judge, and a
 * tooltip is exactly where that slips: "1,00 means the funds move as one" is
 * a definition, "which is risky" is a verdict about someone's money.
 *
 * **Two sentences at most.** This is read hovering, often on a phone with a
 * thumb over half the screen. A paragraph here is a paragraph nobody reads,
 * and the long version is already in the panel underneath.
 */

export interface Terim {
  /** The word as it appears on screen. Also names the button. */
  ad: string;
  aciklama: string;
}

export const TERIMLER = {
  cesitlendirme: {
    ad: "Çeşitlendirme oranı",
    aciklama:
      "Fonların tek tek oynaklıklarının ağırlıklı ortalamasının, sepetin " +
      "kendi oynaklığına bölümü. 1,00 fonların tek fon gibi hareket ettiğini, " +
      "büyük değerler hareketlerin birbirini kısmen dengelediğini gösterir.",
  },
  oynaklik: {
    ad: "Oynaklık",
    aciklama:
      "Bir fonun getirisinin kendi ortalamasından ne kadar saptığının ölçüsü. " +
      "Haftalık getirilerin standart sapmasından hesaplanır ve yıllık yüzdeye " +
      "çevrilir.",
  },
  dusus: {
    ad: "En büyük düşüş",
    aciklama:
      "Dönem içindeki bir zirveden, ardından gelen en derin dibe kadar " +
      "kaybedilen değerin yüzdesi. Ölçülen, zirve ile dip arasındaki en büyük " +
      "mesafedir.",
  },
  korelasyon: {
    ad: "Korelasyon",
    aciklama:
      "İki fonun getirilerinin birlikte hareket etme derecesi. 1 tam birlikte, " +
      "0 ilişkisiz, eksi 1 tam ters yönde hareket demektir.",
  },
  xirr: {
    ad: "XIRR",
    aciklama:
      "Her para girişinin hangi tarihte yapıldığını hesaba katan yıllık getiri. " +
      "Farklı tarihlerde yatırılan tutarların ne kadar süre çalıştığını dikkate " +
      "alır.",
  },
  logaritmik: {
    ad: "Logaritmik ölçek",
    aciklama:
      "Dikey eksende eşit yüzde değişimin eşit mesafeye karşılık geldiği ölçek. " +
      "Küçük ve büyük değerler aynı grafikte okunabilir kalır.",
  },
  dolar: {
    ad: "Dolar bazında getiri",
    aciklama:
      "TL getirinin, dönemin ilk ve son iş günündeki TCMB dolar alış kuruyla " +
      "dolara çevrilmiş hali. Doların TL karşısındaki değişimi ayıklanmış olur.",
  },
  riskPayi: {
    ad: "Dalgalanmadaki pay",
    aciklama:
      "Sepetin haftalık dalgalanmasının (varyansının) ne kadarının bu fondan " +
      "ya da gruptan geldiği; paylar toplamda %100 eder. Diğerlerine ters " +
      "hareket eden bir fon dalgalanmayı azaltır ve payı eksi çıkar.",
  },
  piyasaRiski: {
    ad: "Piyasanın dalgalanması",
    aciklama:
      "Bütün ölçülen fonları büyüklükleri oranında tutan bir sepet düşünün: " +
      "bu çubuk, o sepetin haftalık dalgalanmasının ne kadarının hangi " +
      "gruptan geldiğini gösterir.",
  },
  ucret: {
    ad: "Yıllık ücret",
    aciklama:
      "Fonun yönetim ücreti (emeklilik fonlarında fon işletim gideri), yıllık " +
      "oran olarak. Her gün fonun değerinden düşülür, bu yüzden getirilerin " +
      "içinde zaten vardır.",
  },
  reel: {
    ad: "Enflasyondan arındırılmış getiri",
    aciklama:
      "Nominal getiriden aynı dönemin enflasyonu ayıklanarak bulunan getiri. " +
      "Paranın alım gücü cinsinden ne kazandırdığını gösterir.",
  },
} as const satisfies Record<string, Terim>;

export type TerimAdi = keyof typeof TERIMLER;
