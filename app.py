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
)
from src.data import DEFAULT_MONTHS, FundDataset, load_price_data
from src.tefas_client import TEFASClient

MONTH_CHOICES = [12, 24, 36, 48, 60]

AY_ADLARI = [
    "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
    "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
]

# Renk skalası korelasyon için: 0 nötr, 1 koyu. Negatif tarafın da görünmesi
# gerekiyor, çünkü ters hareket eden fon çifti gruplamaya girmez ama teknik
# detayda bilgi taşır.
HEATMAP_SCALE = "RdBu_r"


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

    if groups.groups:
        pay = groups.grouped_weight
        if kismi:
            st.subheader(f"İncelemeye giren paranın {yuzde(pay)}'i birlikte hareket eden fonlarda.")
        else:
            st.subheader(f"Paranın {yuzde(pay)}'i birlikte hareket eden fonlarda.")
        for g in groups.groups:
            st.write(birlikte_hareket_cumlesi(g.codes, g.min_correlation))
    else:
        st.subheader("Birlikte hareket eden fon çifti bulunamadı.")
        st.write(
            "Fonlarının hiçbiri diğeriyle yüksek korelasyon göstermiyor. "
            "Bu, sepetinin risksiz olduğu anlamına gelmez. Aynı ekonomik şoka "
            "birlikte tepki verebilirler."
        )

    st.dataframe(
        dagilim_tablosu(groups, analysis, isimler, tutarlar),
        hide_index=True,
        width="stretch",
    )


def dagilim_tablosu(
    groups: GroupingResult,
    analysis: BasketAnalysis,
    isimler: dict[str, str],
    tutarlar: dict[str, float],
) -> pd.DataFrame:
    """Fon fon ağırlık listesi, gruplar üstte."""
    satirlar = []
    for i, g in enumerate(groups.groups, 1):
        for kod in g.codes:
            satirlar.append(
                {
                    "Fon": kod,
                    "Adı": isimler.get(kod, ""),
                    "Tutar": para(tutarlar.get(kod, 0.0)),
                    "Payı": yuzde(analysis.weights[kod]),
                    "Durum": f"{i}. grup, toplam {yuzde(g.weight)}",
                }
            )
    for s in groups.standalone:
        satirlar.append(
            {
                "Fon": s.code,
                "Adı": isimler.get(s.code, ""),
                "Tutar": para(tutarlar.get(s.code, 0.0)),
                "Payı": yuzde(s.weight),
                "Durum": "Tek başına",
            }
        )
    return pd.DataFrame(satirlar)


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
        st.write(f"Paranın {yuzde(groups.grouped_weight)}'i birlikte hareket eden fonlarda.")
        for g in groups.groups:
            st.write(birlikte_hareket_cumlesi(g.codes, g.min_correlation))
    else:
        st.write("Bu dönemde birlikte hareket eden fon çifti bulunamadı.")

    st.dataframe(
        dagilim_tablosu(groups, analysis, isimler, tam_tutarlar),
        hide_index=True,
        width="stretch",
    )

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
    st.divider()
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
) -> None:
    with st.expander("Teknik detay"):
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

        st.markdown("**Fon oynaklıkları (yıllık)**")
        st.dataframe(
            pd.DataFrame(
                [
                    {
                        "Fon": kod,
                        "Adı": ds.fund_names.get(kod, ""),
                        "Payı": yuzde(analysis.weights[kod]),
                        "Oynaklık": yuzde(vol),
                    }
                    for kod, vol in analysis.fund_volatility.items()
                ]
            ),
            hide_index=True,
            width="stretch",
        )

        st.markdown("**Sepet değeri**")
        st.caption("Başlangıçta 1.00 kabul edilmiş, alım sonrası hiç yeniden dengelenmemiş.")
        st.plotly_chart(deger_grafigi(analysis.basket_value), width="stretch")

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


def deger_grafigi(value: pd.Series) -> go.Figure:
    fig = px.line(x=value.index, y=value.values, labels={"x": "", "y": ""})
    fig.update_layout(margin=dict(l=0, r=0, t=10, b=0), height=300)
    return fig


# ----------------------------------------------------------------------
# Sayfa
# ----------------------------------------------------------------------


def girdi_formu(registry: dict[str, str] | None) -> tuple[dict[str, float], int, bool]:
    """Fon seçimi, tutarlar ve dönem. Sepet ve 'analiz et' basıldı mı döner."""
    st.markdown("### Sepetin")

    if registry:
        etiketler = {f"{kod} - {ad}" if ad else kod: kod for kod, ad in sorted(registry.items())}
        secilen = st.multiselect(
            "Fonlar",
            options=sorted(etiketler),
            help="Fon kodundan ya da adından arayabilirsin.",
            placeholder="Fon kodu veya adı yaz",
        )
        kodlar = [etiketler[e] for e in secilen]
    else:
        st.warning(
            "TEFAS fon listesi alınamadı, otomatik tamamlama çalışmıyor. "
            "Kodları virgülle ayırarak yazabilirsin."
        )
        ham = st.text_input("Fonlar", placeholder="GAL, AFO, TI2")
        kodlar = [k.strip().upper() for k in ham.split(",") if k.strip()]

    tutarlar: dict[str, float] = {}
    if kodlar:
        st.markdown("### Tutarlar")
        for satir in range(0, len(kodlar), 3):
            for kod, sutun in zip(kodlar[satir : satir + 3], st.columns(3)):
                tutarlar[kod] = sutun.number_input(
                    f"{kod} (TL)",
                    min_value=0.0,
                    value=10_000.0,
                    step=1_000.0,
                    key=f"tutar_{kod}",
                )

    aylar = st.select_slider(
        "Geçmiş uzunluğu",
        options=MONTH_CHOICES,
        value=DEFAULT_MONTHS,
        format_func=lambda a: f"{a} ay",
    )
    return tutarlar, aylar, st.button("Analiz et", type="primary")


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
    pozitif = {k: v for k, v in tutarlar.items() if v > 0}
    if not pozitif:
        st.error("Tutarların hepsi sıfır. En az bir fona sıfırdan büyük bir tutar gir.")
        return
    if len(pozitif) < len(tutarlar):
        atlanan = kod_listesi([k for k in tutarlar if k not in pozitif])
        st.info(f"{atlanan} sıfır tutarla girildiği için incelemeye alınmadı.")

    with st.spinner("TEFAS'tan fiyatlar alınıyor."):
        try:
            ds = fetch_dataset(tuple(sorted(pozitif)), aylar)
        except Exception as exc:
            st.error(f"Veri alınamadı: {exc}")
            return

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
    teknik_detay(analysis, groups, ds, etiket)


if __name__ == "__main__":
    main()
