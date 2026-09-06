"""
FonRadar
========
Streamlit arayüzü. Kullanıcı fon kodlarını ve tutarlarını girer, sepetteki
fonlardan hangilerinin birlikte hareket ettiğini görür.

Bu dosya hesap yapmaz. Veriyi `src.data`, analizi `src.analysis` üretir;
burada kalan iş, çıkan sonucu yatırım terimi bilmeyen birinin okuyabileceği
bir dile çevirmek ve teknik ayrıntıyı isteyene ayrıca göstermek.

    streamlit run app.py
"""

from __future__ import annotations

from html import escape
from typing import NamedTuple

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

from src.analysis import (
    GROUP_THRESHOLD,
    BasketAnalysis,
    GroupingResult,
    analyze_basket,
    find_fund_groups,
    find_rank_gaps,
)
from src.data import DEFAULT_MONTHS, MAX_MONTHS, FundDataset, load_price_data
from src.inflation import CPISeries, RealReturn, load_cpi, real_return
from src.tefas_client import TEFASClient

# Geçmiş uzunluğunun alt sınırı arayüzün kararı: 12 aydan kısa bir pencere
# haftalık gözlem eşiğinin çok altında kalıyor. Üst sınır TEFAS'ın verdiği
# kadarı, onu data katmanı söylüyor.
MIN_MONTHS = 12

AY_ADLARI = [
    "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
    "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
]

# Renk skalası korelasyon için: 0 nötr, 1 koyu. Negatif tarafın da görünmesi
# gerekiyor, çünkü ters hareket eden fon çifti gruplamaya girmez ama teknik
# detayda bilgi taşır.
HEATMAP_SCALE = "RdBu_r"

# Fon adları 60 karaktere kadar çıkıyor ve tabloyu yatay kaydırmaya zorluyor.
# Tabloyu sabit sütun genişlikleriyle kendimiz çiziyoruz: ad kısaltılıp tam
# hali title'a konuyor, çünkü st.dataframe'i canvas'a çiziyor ve hücre
# üstünde tooltip göstermiyor.
AD_UZUNLUGU = 34

TABLO_STILI = """
<style>
table.fr { width: 100%; table-layout: fixed; border-collapse: collapse;
           font-size: 0.875rem; margin-bottom: 1rem; }
table.fr th, table.fr td { text-align: left; padding: 0.45rem 0.6rem;
           border-bottom: 1px solid rgba(128,128,128,0.25);
           white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
table.fr th { font-weight: 600; opacity: 0.7; }
table.fr td.sayi, table.fr th.sayi { text-align: right; }
/* Oranı hücrenin altına ince bir çubuk olarak çiziyoruz: sayı yerinde
   kalıyor, sütun genişlemiyor, satır yüksekliği değişmiyor. */
table.fr td.cubuk { position: relative; }
table.fr td.cubuk::after {
    content: ""; position: absolute; left: 0.6rem; right: 0.6rem;
    bottom: 0.2rem; height: 3px; border-radius: 2px;
    background: linear-gradient(to right,
        rgba(128,128,128,0.75) 0 var(--oran),
        rgba(128,128,128,0.15) var(--oran) 100%);
}
</style>
"""

# Yüzdeler Türkçede okundukları gibi ek alıyor: %26'sı, %30'u, %40'ı.
_YUZDE_EKI_BIRLER = {0: "'ı", 1: "'i", 2: "'si", 3: "'ü", 4: "'ü", 5: "'i",
                     6: "'sı", 7: "'si", 8: "'i", 9: "'u"}
_YUZDE_EKI_ONLAR = {0: "'ı", 1: "'u", 2: "'si", 3: "'u", 4: "'ı", 5: "'si",
                    6: "'ı", 7: "'i", 8: "'i", 9: "'ı", 10: "'ü"}

_SAYI_KELIME = {2: "iki", 3: "üç", 4: "dört", 5: "beş", 6: "altı", 7: "yedi",
                8: "sekiz", 9: "dokuz", 10: "on"}

# Sepet değeri grafiğinin ölçeği. Varsayılan normal; logaritmik olan,
# fonlardan biri diğerlerini kat kat geçtiğinde erken dönemi okunur tutuyor.
OLCEKLER = ["Normal", "Logaritmik"]

# Grubun sepetteki payı, başlığın ne kadar yer kaplayacağını belirliyor.
BASKIN_PAY = 0.50
KAYDA_DEGER_PAY = 0.25


# ----------------------------------------------------------------------
# Veri erişimi (ağır işler burada, hepsi cache'li)
# ----------------------------------------------------------------------


@st.cache_data(ttl=24 * 60 * 60, show_spinner=False)
def fund_registry() -> dict[str, str]:
    """TEFAS'ın listelediği bütün fonlar: kod -> unvan. Günlük cache."""
    return TEFASClient().list_funds()


@st.cache_data(ttl=24 * 60 * 60, show_spinner=False)
def fetch_dataset(codes: tuple[str, ...], months: int) -> FundDataset:
    """Fiyat matrislerini ve kapsama raporunu getirir."""
    return load_price_data(list(codes), months=months)


@st.cache_data(ttl=24 * 60 * 60, show_spinner=False)
def enflasyon() -> CPISeries | None:
    """TÜFE endeksi, yoksa None. Enflasyon olmadan da sayfa çalışıyor."""
    try:
        return load_cpi()
    except Exception:
        # load_cpi beklenen hataları zaten None ile bildiriyor. Buradaki
        # yakalama, beklenmeyen bir şeyde bile sayfanın açılması için.
        return None


@st.cache_data(show_spinner=False)
def run_analysis(
    prices: pd.DataFrame,
    weights: tuple[tuple[str, float], ...],
    threshold: float,
) -> tuple[BasketAnalysis, GroupingResult]:
    """Bir fiyat matrisi için analiz ve gruplama."""
    analysis = analyze_basket(prices, dict(weights))
    groups = find_fund_groups(analysis.correlation, analysis.weights, threshold)
    return analysis, groups


# ----------------------------------------------------------------------
# Biçimlendirme yardımcıları
# ----------------------------------------------------------------------


def yuzde(x: float) -> str:
    return f"%{round(x * 100)}"


def para(x: float) -> str:
    return f"{x:,.0f} TL".replace(",", ".")


def yuzde_isaretli(x: float) -> str:
    """Getiri için: eksi işareti yüzdenin önünde durur."""
    if pd.isna(x):
        return "hesaplanamadı"
    return f"-%{abs(round(x * 100))}" if x < 0 else f"%{round(x * 100)}"


def yuzde_eki(oran: float) -> str:
    """'%26' + ek -> \"%26'sı\". Ek, sayının okunuşuna göre değişiyor."""
    n = round(oran * 100)
    if n == 100:
        return "'ü"
    if n % 10 == 0:
        return _YUZDE_EKI_ONLAR.get(n // 10, "'ı")
    return _YUZDE_EKI_BIRLER[n % 10]


def sayi_kelime(n: int) -> str:
    return _SAYI_KELIME.get(n, str(n))


def kisalt(metin: str, n: int = AD_UZUNLUGU) -> str:
    return metin if len(metin) <= n else metin[: n - 1].rstrip() + "…"


def tarih(ts: pd.Timestamp) -> str:
    ts = pd.Timestamp(ts)
    return f"{ts.day} {AY_ADLARI[ts.month - 1]} {ts.year}"


def sure(gun_sayisi: int) -> str:
    """Gün sayısını okunur bir süreye çevirir: 3 yıl, 2 ay, 5 hafta."""
    if gun_sayisi >= 350:
        yil = round(gun_sayisi / 365)
        return f"{yil} yıl"
    if gun_sayisi >= 25:
        ay = round(gun_sayisi / 30)
        return f"{ay} ay"
    hafta = max(1, round(gun_sayisi / 7))
    return f"{hafta} hafta"


def sure_ile(metin: str) -> str:
    """'2 ay' -> '2 ayla'. Ünsüzle biten süre kelimesi ek alırken kaynaşıyor."""
    if metin.endswith("yıl"):
        return metin + "la"
    if metin.endswith("ay"):
        return metin + "la"
    if metin.endswith("hafta"):
        return metin + "yla"
    return metin + " ile"


def kod_listesi(kodlar) -> str:
    """['A', 'B', 'C'] -> 'A, B ve C'"""
    kodlar = list(kodlar)
    if len(kodlar) == 1:
        return kodlar[0]
    return ", ".join(kodlar[:-1]) + " ve " + kodlar[-1]


def matris_suresi(cov) -> str:
    if cov.start is None or cov.end is None:
        return "veri yok"
    return sure(int((cov.end - cov.start).days))


# ----------------------------------------------------------------------
# Üst kat: herkesin okuyabileceği sonuç
# ----------------------------------------------------------------------


def birlikte_hareket_cumlesi(kodlar: tuple[str, ...], min_corr: float) -> str:
    """Bir grubun ne kadar sıkı olduğunu düz cümleyle anlatır."""
    if min_corr >= 0.95:
        nasil = "neredeyse aynı şekilde hareket ediyor"
    elif min_corr >= 0.90:
        nasil = "çok benzer şekilde hareket ediyor"
    else:
        nasil = "birlikte hareket ediyor"

    dusus = (
        "Biri düştüğünde diğeri de düşüyor."
        if len(kodlar) == 2
        else "Biri düştüğünde diğerleri de düşüyor."
    )
    return f"{kod_listesi(kodlar)} {nasil}. {dusus}"


def orta_pay_basligi(groups: GroupingResult, onek: str, pay: float) -> str:
    """Payın dörtte bir ile yarı arasında olduğu hal: bildirim tonu."""
    if len(groups.groups) == 1:
        g = groups.groups[0]
        return (
            f"{onek} {yuzde(pay)}{yuzde_eki(pay)} birlikte hareket eden "
            f"{sayi_kelime(len(g.codes))} fonda: {kod_listesi(g.codes)}."
        )
    return f"{onek} {yuzde(pay)}{yuzde_eki(pay)} birlikte hareket eden fon gruplarında."


def ana_sonuc(
    groups: GroupingResult,
    analysis: BasketAnalysis,
    isimler: dict[str, str],
    tutarlar: dict[str, float],
    kismi: bool,
) -> None:
    """Üst kattaki ana sonuç bloğu. Tek fon durumu dahil."""
    if analysis.is_single_fund:
        st.subheader("Sepette tek fon var.")
        st.write(
            "Fonların birlikte hareket edip etmediğini görmek için en az iki "
            "fon gerekiyor. Tek fonun kendi oynaklığı ve geçmiş düşüşü "
            "aşağıdaki teknik detay bölümünde duruyor."
        )
        return

    pay = groups.grouped_weight
    onek = "İncelemeye giren paranın" if kismi else "Paranın"

    if not groups.groups:
        st.subheader("Birlikte hareket eden fon çifti bulunamadı.")
        st.write(
            "Fonlarının hiçbiri diğeriyle yüksek korelasyon göstermiyor. "
            "Bu, sepetinin risksiz olduğu anlamına gelmez. Aynı ekonomik şoka "
            "birlikte tepki verebilirler."
        )
    elif pay > BASKIN_PAY:
        st.subheader(f"{onek} yarısından fazlası birlikte hareket eden fonlarda.")
        for g in groups.groups:
            st.write(birlikte_hareket_cumlesi(g.codes, g.min_correlation))
    elif pay >= KAYDA_DEGER_PAY:
        st.subheader(orta_pay_basligi(groups, onek, pay))
        for g in groups.groups:
            st.write(birlikte_hareket_cumlesi(g.codes, g.min_correlation))
    else:
        # Pay küçük. Başlık grubu öne çıkarmıyor ama bilgi durmaya devam
        # ediyor: hemen altında bir cümle, tabloda da grup etiketi.
        st.subheader(f"{onek} çoğu ayrı hareket eden fonlarda.")
        st.write(
            f"Birlikte hareket eden fonlar da var. Sepetin {yuzde(pay)}"
            f"{yuzde_eki(pay)} tutuyorlar. Tabloda grup olarak işaretli."
        )
        for g in groups.groups:
            st.write(birlikte_hareket_cumlesi(g.codes, g.min_correlation))

    dagilim_tablosu(groups, analysis, isimler, tutarlar)


def dagilim_tablosu(
    groups: GroupingResult,
    analysis: BasketAnalysis,
    isimler: dict[str, str],
    tutarlar: dict[str, float],
) -> None:
    """Fon fon ağırlık listesi, gruplar üstte. Sabit genişlik, kaydırma yok."""
    satirlar = []
    for i, g in enumerate(groups.groups, 1):
        for kod in g.codes:
            satirlar.append(
                (kod, isimler.get(kod, ""), para(tutarlar.get(kod, 0.0)),
                 yuzde(analysis.weights[kod]), f"{i}. grup, toplam {yuzde(g.weight)}")
            )
    for s_ in groups.standalone:
        satirlar.append(
            (s_.code, isimler.get(s_.code, ""), para(tutarlar.get(s_.code, 0.0)),
             yuzde(s_.weight), "Tek başına")
        )
    tablo_ciz(("Fon", "Adı", "Tutar", "Payı", "Durum"), satirlar, ad_sutunu=1)


class Cubuk(NamedTuple):
    """
    Sayı ve onun sütundaki en büyüğe oranı.

    Yan yana yazılmış yüzdelerde büyüklük farkı algılanmıyor: %143 ile %8
    aynı genişlikte iki metin. Oranı hücrenin altındaki çubuğa çizince fark
    okunmadan görülüyor.
    """

    metin: str
    oran: float  # 0 ile 1 arası


def tablo_ciz(basliklar: tuple[str, ...], satirlar: list[tuple], ad_sutunu: int) -> None:
    """
    Sabit sütun genişlikli tablo.

    Fon adı sütunu kısaltılıp tam adı `title` olarak veriliyor: tabloyu
    kaydırmadan okunur tutmanın yolu bu. `st.dataframe` tabloyu canvas'a
    çizdiği için hücre üstünde tooltip gösteremiyor, o yüzden burada
    kullanılmıyor.

    Bir hücre `Cubuk` ise sayının altına oranı kadar dolu bir çubuk çiziliyor.
    """
    genislikler = {0: "11%", 1: "40%", 2: "17%", 3: "10%", 4: "22%"}
    sayi_sutunlari = {2, 3}

    ust = "".join(
        f'<th class="{"sayi" if i in sayi_sutunlari else ""}" '
        f'style="width:{genislikler.get(i, "auto")}">{escape(b)}</th>'
        for i, b in enumerate(basliklar)
    )
    govde = []
    for satir in satirlar:
        hucreler = []
        for i, deger in enumerate(satir):
            if isinstance(deger, Cubuk):
                oran = max(0.0, min(1.0, float(deger.oran)))
                hucreler.append(
                    f'<td class="sayi cubuk" style="--oran:{oran * 100:.1f}%">'
                    f'{escape(deger.metin)}</td>'
                )
                continue
            metin = str(deger)
            sinif = "sayi" if i in sayi_sutunlari else ""
            if i == ad_sutunu:
                hucreler.append(
                    f'<td class="{sinif}" title="{escape(metin)}">{escape(kisalt(metin))}</td>'
                )
            else:
                hucreler.append(f'<td class="{sinif}">{escape(metin)}</td>')
        govde.append("<tr>" + "".join(hucreler) + "</tr>")

    st.markdown(
        TABLO_STILI + f"<table class='fr'><thead><tr>{ust}</tr></thead>"
        f"<tbody>{''.join(govde)}</tbody></table>",
        unsafe_allow_html=True,
    )


def disarida_kalanlar(
    ds: FundDataset,
    isimler: dict[str, str],
    tutarlar: dict[str, float],
    threshold: float,
) -> None:
    """Kısa geçmişi yüzünden ana incelemeye giremeyen fonlar."""
    kodlar = sorted(ds.excluded_codes)
    st.divider()
    st.subheader(f"{kod_listesi(kodlar)} bu incelemenin dışında kaldı.")

    for kod in kodlar:
        cov = ds.fund_coverage.get(kod)
        if cov is not None:
            st.write(f"{kod} {tarih(cov.first_date)} tarihinde işlem görmeye başlamış.")
        else:
            st.write(f"{kod} istenen dönemin tamamını kapsamıyor.")

    uzun = matris_suresi(ds.trimmed_coverage)
    kisa = matris_suresi(ds.full_coverage)
    st.write(
        f"{kod_listesi(kodlar)} dahil edilirse inceleme {uzun} yerine sadece "
        f"{sure_ile(kisa)} sınırlı kalıyor. Karşılaştırma ancak bütün fonların "
        f"birlikte var olduğu dönemde yapılabiliyor."
    )

    if ds.full.empty or ds.full.shape[1] < 2:
        st.info("Bütün fonların birlikte işlem gördüğü ortak bir dönem yok.")
        return

    tam_tutarlar = {k: tutarlar[k] for k in ds.full.columns}
    analysis, groups = run_analysis(
        ds.full, tuple(sorted(tam_tutarlar.items())), threshold
    )

    st.markdown(f"**Bütün fonlar dahil edildiğinde ({kisa}lık dönem):**")
    if groups.groups:
        gpay = groups.grouped_weight
        st.write(f"Paranın {yuzde(gpay)}{yuzde_eki(gpay)} birlikte hareket eden fonlarda.")
        for g in groups.groups:
            st.write(birlikte_hareket_cumlesi(g.codes, g.min_correlation))
    else:
        st.write("Bu dönemde birlikte hareket eden fon çifti bulunamadı.")

    dagilim_tablosu(groups, analysis, isimler, tam_tutarlar)

    if ds.full_coverage.below_weekly_threshold:
        st.warning(
            f"Bu sonuç {ds.full_coverage.weekly_observations} haftalık veriye "
            f"dayanıyor ve güvenilir değil. Bu kadar kısa bir dönemde rastgele "
            f"iki fon bile birlikte hareket ediyor gibi görünebilir."
        )


def basarisiz_kodlar(ds: FundDataset) -> None:
    """Hiç veri dönmeyen kodlar. Sessizce atlanmıyor."""
    if not ds.failed_codes:
        return
    for kod, fail in ds.failed_codes.items():
        if fail.kind == "unknown_code":
            st.error(f"{kod}: TEFAS'ta böyle bir fon listelenmiyor. Kodu kontrol et.")
        else:
            st.error(f"{kod}: bu koda ait fiyat verisi bulunamadı.")


# ----------------------------------------------------------------------
# Alt kat: teknik detay
# ----------------------------------------------------------------------


def teknik_detay(
    analysis: BasketAnalysis,
    groups: GroupingResult,
    ds: FundDataset,
    etiket: str,
    toplam_tl: float,
) -> None:
    # Ölçek düğmesi bu panelin içinde ve her dokunuşta sayfa baştan
    # çalışıyor. `key` verilen expander durumunu koruduğu için panel açık
    # kalıyor; anahtarsız hali her koşuda kapanırdı.
    with st.expander("Teknik detay", key="teknik_detay"):
        st.caption(
            f"{etiket}. {tarih(analysis.start)} ile {tarih(analysis.end)} arası, "
            f"{analysis.weekly_observations} haftalık gözlem. Bütün ölçüler "
            f"haftalık getirilerden hesaplanıyor."
        )

        c1, c2, c3 = st.columns(3)
        c1.metric("Çeşitlendirme oranı", f"{analysis.diversification_ratio:.2f}")
        c2.metric("Sepet oynaklığı (yıllık)", yuzde(analysis.basket_volatility))
        c3.metric("En büyük düşüş", yuzde(abs(analysis.max_drawdown.depth)))
        st.caption(
            f"Çeşitlendirme oranı 1.00 ise fonlar tek fon gibi hareket ediyor. "
            f"Ağırlıklı fon oynaklığı {yuzde(analysis.weighted_fund_volatility)}, "
            f"sepetin kendi oynaklığı {yuzde(analysis.basket_volatility)}."
        )
        dd = analysis.max_drawdown
        st.caption(
            f"En büyük düşüş {tarih(dd.peak_date)} zirvesinden "
            f"{tarih(dd.trough_date)} dibine, {dd.duration_days} günde yaşandı."
        )

        if analysis.correlation is not None:
            st.markdown("**Korelasyon ısı haritası**")
            st.plotly_chart(korelasyon_haritasi(analysis.correlation), width="stretch")
            st.caption(
                f"Gruplama eşiği {groups.threshold:.2f}. Bir grubun içindeki her "
                f"ikili bu eşiği geçiyor."
            )
            olcum_farki_yaz(analysis, groups)

        st.markdown("**Fon oynaklıkları (yıllık)**")
        oynakliklar = sorted(
            analysis.fund_volatility.items(), key=lambda kv: (-kv[1], kv[0])
        )
        en_oynak = oynakliklar[0][1]
        tablo_ciz(
            ("Fon", "Adı", "Payı", "Oynaklık"),
            [
                (
                    kod,
                    ds.fund_names.get(kod, ""),
                    yuzde(analysis.weights[kod]),
                    Cubuk(yuzde(vol), vol / en_oynak if en_oynak > 0 else 0.0),
                )
                for kod, vol in oynakliklar
            ],
            ad_sutunu=1,
        )
        st.caption(
            "En oynak fon en üstte. Çubuklar sepetin en oynak fonuna göre ölçekli."
        )

        st.markdown("**Sepet değeri**")
        sepet_degeri(analysis.basket_value, toplam_tl)

        seyrek = [k for k in ds.sparse_codes if k in analysis.weights]
        if seyrek:
            st.markdown("**Kapsama oranı düşük fonlar**")
            for kod in seyrek:
                cov = ds.fund_coverage[kod]
                st.write(
                    f"{kod}: kendi döneminde beklenen işlem günlerinin "
                    f"{yuzde(cov.coverage_ratio)}'i kadar fiyat vermiş "
                    f"({cov.row_count} gün). Eksik günler bütün sepetin ortak "
                    f"dönemini kısaltıyor."
                )


def olcum_farki_yaz(analysis: BasketAnalysis, groups: GroupingResult) -> None:
    """
    İki korelasyon ölçümünün ayrıştığı çiftler, ısı haritasının hemen altında.

    Isı haritası Pearson gösteriyor ve öyle kalıyor; gruplama da Pearson'a
    göre yapılıyor. Buradaki not sadece bildiriyor, hiçbir kararı
    değiştirmiyor.

    Başlığın işi bölümü adlandırmaktan fazlası: bu notu sayfanın üstündeki
    bulgudan ayrı tutmak. İkisi de fon çiftlerinden ve korelasyondan söz
    ediyor, ama ayrı sorulara cevap veriyorlar; notu manşetin ikinci bir
    görüşü sanan okuru yerleşim yanıltmış olur. Bu yüzden başlık, neyin
    ölçüldüğünü değil hangi çiftlerin içeride olduğunu söylüyor.

    Pratikte bunlar hep gruplanmamış çiftler oluyor: gruplama 0.85'ten
    kesiyor, o eşiğin üstündeki çiftler ise iki ölçümde 0.005 kadar
    ayrışıyor, notun çalıştığı 0.10'un çok altında. Yine de garanti değil,
    `find_rank_gaps` gruplanmış çiftleri elemiyor, o yüzden başlık eldeki
    çiftlere bakarak seçiliyor.

    Fark yoksa hiçbir şey çizilmiyor. Ekranda olmayan bir farkın açıklaması
    fazladan okuma demek.
    """
    gaplar = find_rank_gaps(analysis.correlation, analysis.rank_correlation)
    if not gaplar:
        return

    grupli = {
        frozenset((a, b))
        for grup in groups.groups
        for a in grup.codes
        for b in grup.codes
        if a != b
    }
    hepsi_grup_disi = all(frozenset(g.codes) not in grupli for g in gaplar)

    if hepsi_grup_disi:
        baslik = "Gruplanmayan çiftlerde iki ölçüm ayrışıyor"
        kim = (
            "Aşağıdaki çiftlerin hiçbiri gruplama eşiğini geçmiyor, yani "
            "yukarıdaki bulgunun parçası değiller."
        )
    else:
        baslik = "İki ölçümün ayrıştığı çiftler"
        kim = "Aşağıdaki çiftlerde iki ölçüm birbirinden uzak düşüyor."

    st.markdown(f"**{baslik}**")
    st.caption(
        f"{kim} Doğrusal ölçüm bir haftayı hareketin büyüklüğüyle tartıyor ve "
        f"uç haftalardan etkileniyor; sıralama bazlı ölçüm yalnızca hareketin "
        f"sırasına bakıyor, etkilenmiyor."
    )
    # Satır sonu iki boşlukla veriliyor: markdown'da satırı kırar, madde
    # işareti eklemez.
    st.caption(
        "  \n".join(
            f"{a} ve {b}: doğrusal {g.correlation:.3f}, "
            f"sıralama {g.rank_correlation:.3f}"
            for g in gaplar
            for a, b in [g.codes]
        )
    )


def korelasyon_haritasi(corr: pd.DataFrame) -> go.Figure:
    fig = px.imshow(
        corr.round(2),
        text_auto=True,
        zmin=-1,
        zmax=1,
        color_continuous_scale=HEATMAP_SCALE,
        aspect="auto",
    )
    fig.update_layout(margin=dict(l=0, r=0, t=10, b=0), height=90 + 55 * len(corr))
    fig.update_coloraxes(colorbar_title="")
    return fig


def reel_getiri(seri: pd.Series) -> RealReturn | None:
    """Sepetin reel getirisi. TÜFE alınamadıysa None, sayfa nominalle devam eder."""
    cpi = enflasyon()
    if cpi is None:
        return None
    try:
        return real_return(seri, cpi)
    except Exception:
        return None


def sepet_degeri(value: pd.Series, toplam_tl: float) -> None:
    """Sepetin lira değeri, üstünde nominal ve reel getiriyle."""
    seri = value * toplam_tl
    toplam_getiri = float(seri.iloc[-1] / seri.iloc[0] - 1)
    yil = (seri.index[-1] - seri.index[0]).days / 365.25
    yillik = (1 + toplam_getiri) ** (1 / yil) - 1 if yil > 0 else float("nan")

    reel = reel_getiri(seri)

    if reel is None:
        # TÜFE yoksa nominal sonuçlar hiç değişmeden, eskisi gibi duruyor.
        c1, c2 = st.columns(2)
        c1.metric("Toplam getiri", yuzde_isaretli(toplam_getiri))
        c2.metric("Yıllık ortalama getiri", yuzde_isaretli(yillik))
    else:
        c1, c2 = st.columns(2)
        c1.metric("Toplam getiri (nominal)", yuzde_isaretli(toplam_getiri))
        c2.metric(
            "Toplam getiri (enflasyondan arındırılmış)", yuzde_isaretli(reel.total)
        )
        c3, c4 = st.columns(2)
        c3.metric("Yıllık ortalama getiri (nominal)", yuzde_isaretli(yillik))
        c4.metric(
            "Yıllık ortalama getiri (enflasyondan arındırılmış)",
            yuzde_isaretli(reel.annual),
        )

    st.caption(
        f"Başlangıçtaki {para(seri.iloc[0])} bugün {para(seri.iloc[-1])}. "
        f"Alım sonrası hiç yeniden dengelenmemiş."
    )
    if reel is not None:
        st.caption(enflasyon_notu(reel))
    st.caption(
        "Yönetim ücreti fon fiyatına dahil, gösterilen getiri ücret düşülmüş "
        "halidir. Vergi hesaba katılmamıştır."
    )
    olcek = st.segmented_control(
        "Ölçek", OLCEKLER, default=OLCEKLER[0], required=True, key="deger_olcegi"
    )
    st.plotly_chart(
        deger_grafigi(seri, reel, logaritmik=olcek == "Logaritmik"), width="stretch"
    )


def enflasyon_notu(reel: RealReturn) -> str:
    """Reel sayının neye dayandığı: dönemin enflasyonu ve endeksin son ayı."""
    notlar = [
        f"Aynı dönemde fiyatlar {yuzde_isaretli(reel.inflation_total)} arttı. "
        f"Arındırılmış tutarlar bugünün parasıyla: TÜİK tüketici fiyat endeksinin "
        f"o ayki değeri ayın tamamına uygulanıyor, günlere dağıtılmıyor."
    ]
    if reel.is_extrapolated:
        son = reel.latest_cpi_month
        notlar.append(
            f"{AY_ADLARI[son.month - 1]} {son.year} sonrası için TÜFE henüz "
            f"açıklanmadı, o günlere son açıklanan endeks uygulandı."
        )
    return " ".join(notlar)


def deger_grafigi(
    seri: pd.Series,
    reel: RealReturn | None = None,
    logaritmik: bool = False,
) -> go.Figure:
    if reel is None:
        fig = px.line(x=seri.index, y=seri.values, labels={"x": "", "y": ""})
        fig.update_traces(hovertemplate="%{x|%d.%m.%Y}<br>%{y:,.0f} TL<extra></extra>")
    else:
        # İki çizgi de bugünün parasıyla bitiyor: reel çizgi, aynı sepetin
        # geçmişteki değerinin bugün ne alacağını gösterdiği için yukarıdan
        # başlıyor. Aradaki açıklık dönemin enflasyonu.
        cerceve = pd.DataFrame(
            {"Nominal": seri, "Enflasyondan arındırılmış": reel.real_value}
        )
        # Fiyat matrisinin dizin adı "date" ve px onu eksen başlığı yapıyor.
        # Adı silince başlık da gidiyor, veri katmanı dizini ne adlandırırsa
        # adlandırsın.
        cerceve.index.name = None
        fig = px.line(cerceve, labels={"index": "", "value": "", "variable": ""})
        fig.update_traces(
            hovertemplate="%{x|%d.%m.%Y}<br>%{y:,.0f} TL<extra>%{fullData.name}</extra>"
        )
        fig.update_layout(
            legend=dict(orientation="h", yanchor="bottom", y=1.02, x=0, title=None)
        )
    fig.update_yaxes(ticksuffix=" TL", tickformat=",.0f", separatethousands=True)
    if logaritmik:
        # Bir fon diğerlerini kat kat geçtiğinde normal ölçekte sepetin erken
        # dönemi düz çizgiye yapışıyor. Logaritmada eşit yüzde değişim eşit
        # dikey mesafe demek, o yüzden başlangıçtaki hareket de görünüyor.
        #
        # dtick "D2": her onluk basamakta yalnız 1, 2 ve 5 etiketleniyor.
        # Plotly'nin varsayılanı 1'den 9'a kadar hepsini yazıyor ve etiketler
        # eksenin alt ucunda üst üste biniyor.
        fig.update_yaxes(type="log", dtick="D2")
    # Plotly ay adlarını İngilizce basıyor. Sayısal biçim dilden bağımsız.
    fig.update_xaxes(tickformat="%m.%Y")
    # Türkçe ayraçlar: binlik nokta, ondalık virgül.
    fig.update_layout(margin=dict(l=0, r=0, t=10, b=0), height=300, separators=",.")
    return fig


# ----------------------------------------------------------------------
# Sayfa
# ----------------------------------------------------------------------


def _fon_ekle() -> None:
    """Arama kutusundaki fonu sepete alır ve kutuyu boşaltır."""
    etiket = st.session_state.get("fon_arama")
    kod = st.session_state.get("_etiketler", {}).get(etiket)
    if kod and kod not in st.session_state["secili_fonlar"]:
        st.session_state["secili_fonlar"].append(kod)
    st.session_state["fon_arama"] = None
    st.session_state.pop("sepet", None)


def _kod_ekle() -> None:
    """Fon listesi alınamadığında elle yazılan kod."""
    kod = (st.session_state.get("kod_girisi") or "").strip().upper()
    if kod and kod not in st.session_state["secili_fonlar"]:
        st.session_state["secili_fonlar"].append(kod)
    st.session_state["kod_girisi"] = ""
    st.session_state.pop("sepet", None)


def _fon_cikar(kod: str) -> None:
    if kod in st.session_state["secili_fonlar"]:
        st.session_state["secili_fonlar"].remove(kod)
    st.session_state.pop(f"tutar_{kod}", None)
    st.session_state.pop("sepet", None)


def girdi_formu(registry: dict[str, str] | None) -> tuple[dict[str, float | None], int, bool]:
    """
    Fon seçimi, tutarlar ve dönem.

    Arama kutusu en üstte ve sabit: seçilen fonlar altına ekleniyor, böylece
    liste uzadıkça kutu yerinden oynamıyor.
    """
    st.markdown("### Sepetin")
    st.session_state.setdefault("secili_fonlar", [])

    if registry:
        etiketler = {f"{k} - {v}" if v else k: k for k, v in sorted(registry.items())}
        st.session_state["_etiketler"] = etiketler
        ara, ekle = st.columns([5, 1], vertical_alignment="bottom")
        ara.selectbox(
            "Fon ara",
            options=list(etiketler),
            index=None,
            key="fon_arama",
            placeholder="Fon kodu veya adı yaz",
            help="Fon kodundan ya da adından arayabilirsin.",
        )
        ekle.button("Ekle", on_click=_fon_ekle, width="stretch")
    else:
        st.warning(
            "TEFAS fon listesi alınamadı, otomatik tamamlama çalışmıyor. "
            "Fon kodunu elle yazabilirsin."
        )
        ara, ekle = st.columns([5, 1], vertical_alignment="bottom")
        ara.text_input("Fon kodu", key="kod_girisi", placeholder="GAL")
        ekle.button("Ekle", on_click=_kod_ekle, width="stretch")

    secili = st.session_state["secili_fonlar"]
    tutarlar: dict[str, float | None] = {}

    if not secili:
        st.caption("Henüz fon eklemedin. Yukarıdan ara ve Ekle'ye bas.")
    else:
        st.markdown("### Seçtiğin fonlar")
        for kod in list(secili):
            ad, tutar, sil = st.columns([4, 2, 1], vertical_alignment="center")
            adi = (registry or {}).get(kod, "")
            # Kod ve ad tek satırda: satır yükselmeyince tutar kutusu ve
            # kaldır butonu hizada kalıyor.
            ad.markdown(f"**{kod}** · {kisalt(adi, 38)}" if adi else f"**{kod}**")
            tutarlar[kod] = tutar.number_input(
                f"{kod} tutarı",
                key=f"tutar_{kod}",
                value=None,
                min_value=0.0,
                step=1_000.0,
                placeholder="Tutar giriniz",
                label_visibility="collapsed",
            )
            sil.button("Kaldır", key=f"sil_{kod}", on_click=_fon_cikar, args=(kod,))

    aylar = donem_secimi()
    return tutarlar, aylar, st.button("Analiz et", type="primary")


def _aylar_slider_degisti() -> None:
    st.session_state["aylar"] = int(st.session_state["aylar_slider"])
    st.session_state.pop("aylar_notu", None)


def _aylar_kutusu_degisti() -> None:
    """Kutuya yazılan değeri aralığa çeker ve ne yaptığını not eder."""
    ham = st.session_state.get("aylar_kutu")
    if ham is None:
        return
    ham = int(ham)
    kirpik = max(MIN_MONTHS, min(MAX_MONTHS, ham))
    st.session_state["aylar"] = kirpik
    if kirpik != ham:
        st.session_state["aylar_notu"] = (
            f"{ham} ay istendi. Aralık {MIN_MONTHS} ile {MAX_MONTHS} ay arası, "
            f"{kirpik} aya çekildi."
        )
    else:
        st.session_state.pop("aylar_notu", None)


def donem_secimi() -> int:
    """
    Geçmiş uzunluğu: kaydırıcı ve kutu, tek bir değeri paylaşıyor.

    İki widget aynı session_state anahtarını taşıyamıyor, o yüzden doğru
    değer ayrı bir anahtarda (`aylar`) duruyor ve iki widget da her koşuda
    oradan dolduruluyor. Hangisi oynatılırsa oynatılsın diğeri onu izliyor.
    """
    st.session_state.setdefault("aylar", DEFAULT_MONTHS)
    st.session_state["aylar_slider"] = st.session_state["aylar"]
    st.session_state["aylar_kutu"] = st.session_state["aylar"]

    kaydirici, kutu = st.columns([4, 1], vertical_alignment="bottom")
    kaydirici.slider(
        "Geçmiş uzunluğu",
        min_value=MIN_MONTHS,
        max_value=MAX_MONTHS,
        step=1,
        format="%d ay",
        key="aylar_slider",
        on_change=_aylar_slider_degisti,
    )
    # Kutuda min_value/max_value yok: aralık dışını widget sessizce kırpsın
    # istemiyoruz, kullanıcı ne yazdığını ve nereye çekildiğini görsün.
    kutu.number_input(
        "Ay",
        step=1,
        key="aylar_kutu",
        on_change=_aylar_kutusu_degisti,
        label_visibility="collapsed",
    )
    if st.session_state.get("aylar_notu"):
        st.caption(st.session_state["aylar_notu"])

    return int(st.session_state["aylar"])


def main() -> None:
    st.set_page_config(page_title="FonRadar", page_icon="📡", layout="centered")
    st.title("FonRadar")
    st.caption(
        "Sepetindeki fonlardan hangilerinin birlikte hareket ettiğini gösterir. "
        "Yatırım tavsiyesi vermez."
    )

    try:
        registry = fund_registry()
    except Exception:
        registry = None

    tutarlar, aylar, calistir = girdi_formu(registry)

    if calistir:
        st.session_state["sepet"] = (tutarlar, aylar)
    sepet = st.session_state.get("sepet")
    if not sepet:
        return

    tutarlar, aylar = sepet
    if not tutarlar:
        st.info("Önce en az bir fon seç.")
        return
    pozitif = {k: float(v) for k, v in tutarlar.items() if v}
    if not pozitif:
        st.error("Hiçbir fona tutar girilmedi. Her fonun yanındaki kutuya tutarını yaz.")
        return
    if len(pozitif) < len(tutarlar):
        atlanan = kod_listesi([k for k in tutarlar if k not in pozitif])
        st.info(f"{atlanan} için tutar girilmediği için incelemeye alınmadı.")

    with st.spinner("TEFAS'tan fiyatlar alınıyor."):
        try:
            ds = fetch_dataset(tuple(sorted(pozitif)), aylar)
        except Exception as exc:
            st.error(f"Veri alınamadı: {exc}")
            return

    st.divider()
    basarisiz_kodlar(ds)

    ana_matris = ds.trimmed
    if ana_matris.empty or ana_matris.shape[1] == 0:
        st.warning(
            f"İstenen {aylar} aylık dönemin tamamını kapsayan fon yok. "
            f"Daha kısa bir dönem seçebilirsin."
        )
        if not ds.full.empty and ds.full.shape[1] >= 1:
            st.write(
                f"Bütün fonların birlikte var olduğu dönem "
                f"{matris_suresi(ds.full_coverage)} uzunluğunda."
            )
        return

    ana_tutarlar = {k: pozitif[k] for k in ana_matris.columns}
    try:
        analysis, groups = run_analysis(
            ana_matris, tuple(sorted(ana_tutarlar.items())), GROUP_THRESHOLD
        )
    except ValueError as exc:
        st.error(f"Bu sepet incelenemedi: {exc}")
        return

    ana_sonuc(groups, analysis, ds.fund_names, ana_tutarlar, kismi=bool(ds.excluded_codes))

    if ds.excluded_codes:
        disarida_kalanlar(ds, ds.fund_names, pozitif, GROUP_THRESHOLD)

    st.divider()
    etiket = (
        f"{kod_listesi(list(ana_matris.columns))} fonlarının ortak dönemi"
        if len(ana_matris.columns) > 1
        else f"{ana_matris.columns[0]} fonunun dönemi"
    )
    teknik_detay(analysis, groups, ds, etiket, sum(ana_tutarlar.values()))


if __name__ == "__main__":
    main()
