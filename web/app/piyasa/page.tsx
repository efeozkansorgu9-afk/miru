import type { Metadata } from "next";
import Link from "next/link";

import { API_BASE_URL, getFundList, getMarket } from "@/lib/api";
import type { MarketCluster, MarketResponse } from "@/lib/api";
import { Column } from "@/components/column";
import { Reveal } from "@/components/reveal";
import { ayYil, korelasyon, oran, paraKisa, sayi, yuzde, yuzdeEki } from "@/lib/format";
import {
  ETKEN_ACIKLAMALARI,
  ETKEN_ADLARI,
  OLCULEMEDI,
  RENKLI_GRUP,
  bilesim,
  dilimler,
  grupAdi,
  gruptakiler,
  kategoriSatiri,
} from "@/lib/market";
import type { Dilim } from "@/lib/market";
import { METHOD_HREF, SITE, TOOL, fundHref } from "@/lib/site";

/**
 * The whole market, grouped: `/piyasa`.
 *
 * Reads `/market/clusters`, which partitions every measurable fund into
 * groups whose every pair overlaps (see `src/market.py`), and says what that
 * comes to. Static and rebuilt daily, like the fund pages; every group's
 * members link to their own pages, so this is also a way into them.
 *
 * Throws when the API cannot answer, for the reason `/fon` does: a green
 * build with an empty market page replaces a working one.
 */
export const dynamic = "force-static";
export const revalidate = 86400;

export const metadata: Metadata = {
  title: { absolute: `Piyasa haritası · ${SITE.brand}` },
  description:
    "TEFAS'taki fonların haftalık hareketleri karşılaştırıldığında gerçekte kaç ayrı şeye yatırıldığı: birbirinin kopyası olan fon grupları ve paranın bu gruplara dağılımı.",
};

/** Groups drawn as full cards; the rest are listed compactly below. */
const KART_SAYISI = 12;
/** Members shown on a card before "tümünü göster". */
const ONIZLEME = 10;

async function yukle(): Promise<{ m: MarketResponse; adlar: Record<string, string> }> {
  try {
    const [m, list] = await Promise.all([
      getMarket({ timeoutMs: 90_000 }),
      getFundList({ timeoutMs: 30_000 }),
    ]);
    return { m, adlar: Object.fromEntries(list.funds.map((f) => [f.code, f.name])) };
  } catch (error) {
    throw new Error(
      `Market page cannot be generated: ${API_BASE_URL}/market/clusters did not ` +
        `answer. Cause: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export default async function Piyasa() {
  const { m, adlar } = await yukle();
  const g = gruptakiler(m);
  const olculmeyen = Object.values(m.unmeasured).reduce((a, v) => a + (v?.length ?? 0), 0);
  const parcalar = dilimler(m);

  // The group holding the most money, for the one sentence that says fund
  // counts and money do not land in the same place.
  const enCokPara = [...m.clusters].sort(
    (a, b) => (b.total_assets ?? 0) - (a.total_assets ?? 0),
  )[0];
  const toplamPara = m.total_assets_measured ?? 0;
  const yil =
    m.window_start && m.window_end
      ? Math.round(
          (Date.parse(m.window_end) - Date.parse(m.window_start)) / (365.25 * 86_400_000),
        )
      : null;

  return (
    <div>
      <Column className="pt-section pb-section">
        <Reveal className="max-w-prose">
          <p className="text-overline uppercase text-accent">Piyasa haritası</p>
          <h1 className="mt-4 text-display-lg text-balance">
            Türkiye’de gerçekte kaç ayrı fon var?
          </h1>
          <p className="mt-6 text-lead text-ink-muted text-pretty">
            TEFAS’ta {sayi(m.listed)} fon işlem görüyor. Her birinin haftalık
            hareketini diğer hepsiyle karşılaştırdık ve birbirinin neredeyse
            kopyası olan fonları bir araya koyduk. Ölçebildiğimiz{" "}
            {sayi(m.measured)} fon, sonunda {sayi(m.groups_total)} ayrı harekete
            iniyor.
          </p>
        </Reveal>

        <Reveal delay={100}>
          <dl className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-card border border-border bg-border sm:grid-cols-3">
            <Sayac deger={sayi(m.listed)} etiket="fon TEFAS’ta işlem görüyor" />
            <Sayac
              deger={sayi(m.measured)}
              etiket={`tanesi ölçülebildi; ${sayi(olculmeyen)} fonun yeterli verisi yok`}
            />
            <Sayac
              deger={sayi(m.groups_total)}
              etiket="ayrı hareket kalıyor"
              vurgu
            />
          </dl>
        </Reveal>

        <div className="mt-12 flex max-w-prose flex-col gap-4 text-body text-ink-muted text-pretty">
          <p>
            <strong className="text-ink">{sayi(g.fon)} fon</strong>, içindeki
            her fon çiftinin birbiriyle örtüştüğü{" "}
            <strong className="text-ink">{sayi(m.clusters.length)} gruba</strong>{" "}
            toplanıyor. Bir gruptaki fonlar farklı kurumların, farklı adlarla
            sattığı ürünler olabilir; ama {yil ? `son ${yil} yılda` : "ölçtüğümüz dönemde"} haftadan haftaya
            neredeyse aynı hareketi yapmışlar. Geriye kalan{" "}
            {sayi(m.singletons.length)} fonun ise bu sıkılıkta bir eşi yok.
          </p>
          {enCokPara && toplamPara > 0 && (
            <p>
              Fon sayısı ile para aynı yere düşmüyor. Paranın en büyük kısmı{" "}
              <strong className="text-ink">{kisaAd(enCokPara)}</strong>{" "}
              {enCokPara.size} fonluk grupta. Fonların yalnızca {yuzde(enCokPara.size / m.measured)}
              {yuzdeEki(enCokPara.size / m.measured)} bu grupta, ama ölçülen
              fonlardaki paranın{" "}
              {yuzde((enCokPara.total_assets ?? 0) / toplamPara)}
              {yuzdeEki((enCokPara.total_assets ?? 0) / toplamPara)} burada
              duruyor.
            </p>
          )}
        </div>

        <PayCubugu dilimler={parcalar} />
      </Column>

      <div className="border-t border-border bg-canvas-sunken">
        <Column className="py-section">
          <p className="text-overline uppercase text-ink-subtle">Gruplar</p>
          <h2 className="mt-4 max-w-prose text-display-sm text-balance">
            En kalabalık {Math.min(KART_SAYISI, m.clusters.length)} grup
          </h2>
          <p className="mt-3 max-w-prose text-body text-ink-muted text-pretty">
            Her grupta fon sayısı, kaç farklı kurumun fonu olduğu, toplam
            büyüklük ve grubun en zayıf çifti var. En zayıf çift bile{" "}
            {korelasyon(m.overlapping_threshold)} eşiğinin üstünde; yani
            gruptaki herhangi iki fonu alsanız, güven aralığının alt ucu bu
            sayıdan yüksek çıkıyor.
          </p>

          <ol className="mt-8 grid gap-4 md:grid-cols-2">
            {m.clusters.slice(0, KART_SAYISI).map((c, i) => (
              <GrupKarti key={c.codes[0]} c={c} sira={i + 1} adlar={adlar} />
            ))}
          </ol>

          {m.clusters.length > KART_SAYISI && (
            <details className="group mt-6 rounded-card border border-border bg-surface">
              <summary className="cursor-pointer list-none px-6 py-4 text-body font-medium text-ink marker:hidden">
                Diğer {m.clusters.length - KART_SAYISI} grubu göster
                <span className="ml-2 text-ink-subtle group-open:hidden">+</span>
              </summary>
              <ul className="border-t border-border">
                {m.clusters.slice(KART_SAYISI).map((c, i) => (
                  <li
                    key={c.codes[0]}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-border px-6 py-3 first:border-t-0"
                  >
                    <span className="w-8 shrink-0 font-display text-label font-semibold text-ink-subtle tabular-nums">
                      {KART_SAYISI + i + 1}
                    </span>
                    <span className="text-caption text-ink">
                      {grupAdi(c)} · {c.size} fon
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      {c.codes.map((code) => (
                        <FonKodu key={code} code={code} ad={adlar[code]} />
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Column>
      </div>

      <Column className="pt-section">
        <section className="max-w-prose">
          <h2 className="text-display-sm text-balance">Grupların adları nereden geliyor</h2>
          <p className="mt-4 text-body text-ink-muted text-pretty">
            TEFAS’ın kategorileri bir fonun hukuki türünü söylüyor, içinde ne
            olduğunu söylemiyor: “Serbest Fon” etiketli bir fon dolar tahvili de
            tutabilir, TL mevduat da. Bu yüzden grupları, getirilerinin neyden
            oluştuğuna bakarak adlandırıyoruz. Her grubun haftalık getirisini
            aşağıdaki sekiz etkenin bir karışımı olarak açıklıyoruz; karışımdaki
            paylar eksi olamıyor ve toplamları %100 ediyor (Sharpe’ın stil
            analizi). “Dolar %72 · TL faiz %28”, grubun haftalık hareketinin
            böyle bir karışımla en iyi açıklandığı anlamına geliyor.
          </p>
          <p className="mt-4 text-body text-ink-muted text-pretty">
            Her etkeni, o türü doğrudan izleyen uzun geçmişli bir TEFAS fonu
            temsil ediyor. Hangi fonun seçileceğini biz belirlemiyoruz: her
            hafta, adaylar arasından kendi türüne en tipik olanı, yani diğer
            adaylarla ortanca korelasyonu en yüksek olanı seçiliyor. Karışımın
            açıklama gücü (R²) {oran(m.style_min_r2 ?? 0.6)} değerinin
            altındaysa, o gruba bileşim adı vermiyoruz; TEFAS kategorisini
            gösterip bunu açıkça belirtiyoruz.
          </p>
          {m.style_factors.length > 0 && (
            <ul className="mt-5 grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {m.style_factors.map((f) => (
                <li key={f.key} className="flex items-baseline gap-2 text-caption text-ink-muted">
                  <span className="whitespace-nowrap font-medium text-ink">{ETKEN_ADLARI[f.key] ?? f.key}</span>
                  <span>·</span>
                  <FonKodu code={f.proxy} ad={adlar[f.proxy]} />
                  <span className="text-ink-subtle">{ETKEN_ACIKLAMALARI[f.key] ?? ""}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </Column>

      <Column className="py-section">
        <div className="grid gap-10 lg:grid-cols-2">
          <section>
            <h2 className="text-display-sm text-balance">Nasıl grupladık</h2>
            <ul className="mt-4 flex flex-col gap-3 text-body text-ink-muted text-pretty">
              <li>
                Her fon çiftini, fon sayfalarındakiyle aynı yöntemle ölçtük:
                haftalık getiriler, korelasyon ve {sayi(m.min_weeks)} haftadan
                uzun ortak geçmiş üzerinden %95 güven aralığı
                {m.window_start && m.window_end
                  ? ` (${ayYil(m.window_start.slice(0, 7))} – ${ayYil(m.window_end.slice(0, 7))})`
                  : ""}
                .
              </li>
              <li>
                İki fonu ancak güven aralığının alt ucu{" "}
                {korelasyon(m.overlapping_threshold)} üstündeyse aynı grupta
                sayıyoruz, ve bu bir gruptaki <em>her</em> çift için geçerli.
                A, B’ye, B de C’ye benziyor diye A ile C’yi aynı gruba
                koymuyoruz.
              </li>
              <li>
                Her fon yalnızca bir grupta. Bir fon başka bir gruptaki bazı
                fonlarla da örtüşebilir; ama o grubun hepsiyle örtüşmüyorsa
                oraya girmiyor. Bu yüzden grupların sayısı, piyasadaki ayrı
                hareketler için temkinli bir üst sınır.
              </li>
              <li>
                Bu bir tavsiye değil. Bir grubun kalabalık olması o fonların iyi
                ya da kötü olduğunu söylemiyor; yalnızca aynı şeyi yaptıklarını
                söylüyor.
              </li>
            </ul>
            <Link
              href={`${METHOD_HREF}#kovalar`}
              className="mt-5 inline-flex text-body font-medium text-accent hover:text-accent-hover"
            >
              Ölçümün ayrıntıları →
            </Link>
          </section>

          <section>
            <h2 className="text-display-sm text-balance">Kimler dışarıda kaldı</h2>
            <p className="mt-4 text-body text-ink-muted text-pretty">
              {sayi(olculmeyen)} fonu ölçemedik ve hiçbir gruba ya da “eşi
              olmayan” sayısına katmadık:
            </p>
            <ul className="mt-3 flex flex-col gap-2 text-body text-ink-muted">
              {Object.entries(m.unmeasured).map(([neden, kodlar]) => (
                <li key={neden}>
                  <strong className="text-ink">{sayi(kodlar?.length ?? 0)} fon</strong>{" "}
                  {OLCULEMEDI[neden] ?? neden}.
                </li>
              ))}
            </ul>
            <details className="mt-5 rounded-card border border-border bg-surface">
              <summary className="cursor-pointer list-none px-5 py-3 text-caption font-medium text-ink marker:hidden">
                Eşi olmayan {sayi(m.singletons.length)} fonu göster
              </summary>
              <div className="flex flex-wrap gap-1.5 border-t border-border px-5 py-4">
                {m.singletons.map((code) => (
                  <FonKodu key={code} code={code} ad={adlar[code]} />
                ))}
              </div>
            </details>
            <p className="mt-6 text-body text-ink-muted text-pretty">
              Kendi sepetinizde birbirinin kopyası fon olup olmadığını merak
              ediyorsanız:{" "}
              <Link href={TOOL.href} className="font-medium text-accent hover:text-accent-hover">
                {TOOL.name}
              </Link>
              .
            </p>
          </section>
        </div>
      </Column>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

/** "altın ağırlıklı" for a sentence; the category when there is no mix. */
function kisaAd(c: MarketCluster): string {
  const b = bilesim(c.style);
  if (b && b.length > 0) return `${b[0].ad.toLocaleLowerCase("tr")} ağırlıklı`;
  return c.top_category ?? "karışık";
}

function Sayac({
  deger,
  etiket,
  vurgu,
}: {
  deger: string;
  etiket: string;
  vurgu?: boolean;
}) {
  return (
    <div className="bg-surface px-6 py-5">
      <dt className="sr-only">{etiket}</dt>
      <dd>
        <span
          className={`block font-display text-display-md font-semibold tabular-nums ${vurgu ? "text-accent" : "text-ink"}`}
        >
          {deger}
        </span>
        <span aria-hidden className="mt-1 block text-caption text-ink-subtle text-pretty">
          {etiket}
        </span>
      </dd>
    </div>
  );
}

/**
 * Two 100% bars over the same segments: by fund count, and by money.
 *
 * Part-to-whole, so a stacked bar; the same segment keeps its colour in
 * both, so the eye can follow one group from "how many funds" to "how much
 * money". The legend below is a table with both shares written out, which
 * is also the relief the three light slots under 3:1 contrast need.
 */
function PayCubugu({ dilimler: ds }: { dilimler: Dilim[] }) {
  const fonToplam = ds.reduce((a, d) => a + d.fon, 0);
  const paraToplam = ds.reduce((a, d) => a + d.para, 0);

  const cubuk = (key: "fon" | "para", toplam: number) => (
    <div className="flex h-9 w-full gap-[2px] overflow-hidden rounded-control">
      {ds.map((d) => {
        const pay = toplam > 0 ? d[key] / toplam : 0;
        if (pay <= 0) return null;
        return (
          <div
            key={d.anahtar}
            className="h-full first:rounded-l-control last:rounded-r-control"
            style={{ width: `${pay * 100}%`, background: d.renk }}
            title={`${d.etiket}${d.alt ? ` (${d.alt})` : ""}: ${yuzde(pay)}`}
          />
        );
      })}
    </div>
  );

  return (
    <figure className="mt-12 rounded-card border border-border bg-surface px-5 py-6 sm:px-7">
      <figcaption className="text-lead font-semibold text-ink">
        Fonlar ve para gruplara nasıl dağılıyor
      </figcaption>
      <div className="mt-6 grid gap-5">
        <div>
          <p className="mb-2 text-label text-ink-subtle">Fon sayısına göre</p>
          {cubuk("fon", fonToplam)}
        </div>
        <div>
          <p className="mb-2 text-label text-ink-subtle">Fon büyüklüğüne (paraya) göre</p>
          {cubuk("para", paraToplam)}
        </div>
      </div>

      <table className="mt-6 w-full table-fixed text-left">
        <thead>
          <tr className="border-b border-border text-label text-ink-subtle">
            <th scope="col" className="py-2 font-normal">Grup</th>
            <th scope="col" className="w-16 py-2 text-right font-normal sm:w-24">Fon payı</th>
            <th scope="col" className="w-16 py-2 text-right font-normal sm:w-24">Para payı</th>
          </tr>
        </thead>
        <tbody className="text-caption tabular-nums">
          {ds.map((d) => (
            <tr key={d.anahtar} className="border-b border-border last:border-b-0">
              <th scope="row" className="py-2 pr-3 font-normal text-ink">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span
                    aria-hidden
                    className="size-3 shrink-0 rounded-[3px]"
                    style={{ background: d.renk }}
                  />
                  <span className="min-w-0 truncate" title={d.alt ? `${d.etiket} · ${d.alt}` : d.etiket}>
                    {d.etiket}
                    {d.alt && <span className="ml-2 text-ink-subtle">{d.alt}</span>}
                  </span>
                </span>
              </th>
              <td className="py-2 text-right text-ink-muted">
                {fonToplam > 0 ? yuzde(d.fon / fonToplam) : "—"}
              </td>
              <td className="py-2 text-right text-ink-muted">
                {paraToplam > 0 ? yuzde(d.para / paraToplam) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-caption text-ink-subtle text-pretty">
        Yalnızca ölçülebilen fonlar. İlk {RENKLI_GRUP} grup en kalabalık
        olanlar; büyüklük TEFAS’ın son yayımladığı fon toplam değeri.
      </p>
    </figure>
  );
}

function GrupKarti({
  c,
  sira,
  adlar,
}: {
  c: MarketCluster;
  sira: number;
  adlar: Record<string, string>;
}) {
  const renk = sira <= RENKLI_GRUP ? `var(--group-${sira})` : "var(--ink-subtle)";
  const onizleme = c.codes.slice(0, ONIZLEME);
  const kalan = c.codes.slice(ONIZLEME);

  return (
    <li className="flex flex-col overflow-hidden rounded-card border border-border bg-surface">
      <div className="h-1" style={{ background: renk }} />
      <div className="flex flex-1 flex-col px-5 pt-4 pb-5">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-body font-semibold text-ink-subtle tabular-nums">
            {sira}
          </span>
          <h3 className="min-w-0 text-lead font-semibold text-ink text-balance">
            {grupAdi(c)}
          </h3>
        </div>
        <p className="mt-1 text-caption text-ink-muted tabular-nums">
          {c.size} fon · {c.founders} farklı kurum
          {c.total_assets !== null ? ` · ${paraKisa(c.total_assets)}` : ""}
        </p>
        {c.style && (
          <p className="mt-1 text-caption text-ink-subtle tabular-nums">
            {kategoriSatiri(c) ? `${kategoriSatiri(c)} · ` : ""}
            {c.style.reportable
              ? `açıklama gücü (R²) ${oran(c.style.r2)}`
              : `açıklama gücü (R²) ${oran(Math.max(0, c.style.r2))}, bileşim adı verilmedi`}
          </p>
        )}
        <p className="mt-1 text-caption text-ink-subtle tabular-nums">
          En zayıf çiftin alt sınırı {korelasyon(c.weakest_ci_low)} · ortanca
          korelasyon {korelasyon(c.median_correlation)}
        </p>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {onizleme.map((code) => (
            <FonKodu key={code} code={code} ad={adlar[code]} />
          ))}
        </div>
        {kalan.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer list-none text-label text-accent marker:hidden hover:underline">
              {kalan.length} fon daha
            </summary>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {kalan.map((code) => (
                <FonKodu key={code} code={code} ad={adlar[code]} />
              ))}
            </div>
          </details>
        )}
      </div>
    </li>
  );
}

/** A fund code that opens its page, with the name one hover away. */
function FonKodu({ code, ad }: { code: string; ad?: string }) {
  return (
    <Link
      href={fundHref(code)}
      title={ad ? `${code} · ${ad}` : code}
      className="rounded-control border border-border bg-canvas-sunken px-2 py-0.5 font-mono text-label text-ink transition-colors hover:border-accent hover:text-accent"
    >
      {code}
    </Link>
  );
}
