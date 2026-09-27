import type { Metadata } from "next";
import Link from "next/link";

import { API_BASE_URL, getFundList, getMarket, getMarketPeriods } from "@/lib/api";
import type { MarketPeriodsResponse } from "@/lib/api";
import { Donemler } from "@/components/market/periods";
import { donemGirisi } from "@/lib/periods";
import type { MarketCluster, MarketResponse } from "@/lib/api";
import { Column } from "@/components/column";
import { PayCubugu } from "@/components/market/share-bars";
import { Reveal } from "@/components/reveal";
import { ayYil, korelasyon, oran, paraKisa, sayi, yuzde, yuzdeEki } from "@/lib/format";
import { ucretOrani } from "@/lib/fee";
import {
  ETKEN_ACIKLAMALARI,
  ETKEN_ADLARI,
  OLCULEMEDI,
  RENKLI_GRUP,
  ayirtSatirlari,
  yakinGrupCumlesi,
  bilesim,
  dilimler,
  grupAdi,
  gruptakiler,
  kategoriSatiri,
} from "@/lib/market";
import { METHOD_HREF, SITE, TOOL, fundHref, groupHref } from "@/lib/site";

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
/** Funds listed on a group card before "Tümünü göster". */
const ONIZLEME = 5;

/**
 * A few tries, spaced out, before a build gives up.
 *
 * Every push redeploys the API on Railway at the same time as the frontend
 * on Vercel, so a build can ask while the API is restarting, or before the
 * new process has computed the grouping once (about ten seconds cold). A
 * build that failed on that race on 2026-09-27 compiled cleanly on retry.
 * Waiting out a restart is not the same as tolerating a broken API: after
 * the last try it still throws.
 */
async function tekrarla<T>(is: () => Promise<T>, deneme = 4, beklemeMs = 15_000): Promise<T> {
  let son: unknown;
  for (let i = 0; i < deneme; i++) {
    try {
      return await is();
    } catch (error) {
      son = error;
      if (i < deneme - 1) await new Promise((r) => setTimeout(r, beklemeMs));
    }
  }
  throw son;
}

async function yukle(): Promise<{
  m: MarketResponse;
  adlar: Record<string, string>;
  donemler: MarketPeriodsResponse | null;
}> {
  try {
    const [m, list, donemler] = await Promise.all([
      tekrarla(() => getMarket({ timeoutMs: 90_000 })),
      tekrarla(() => getFundList({ timeoutMs: 30_000 })),
      // An extra: without it the page loses one section, not the build.
      getMarketPeriods({ timeoutMs: 90_000 }).catch(() => null),
    ]);
    return {
      m,
      adlar: Object.fromEntries(list.funds.map((f) => [f.code, f.name])),
      donemler: donemler && donemler.periods.length > 1 ? donemler : null,
    };
  } catch (error) {
    throw new Error(
      `Market page cannot be generated: ${API_BASE_URL}/market/clusters did not ` +
        `answer. Cause: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export default async function Piyasa() {
  const { m, adlar, donemler } = await yukle();
  const donemGiris = donemler ? donemGirisi(donemler) : null;
  const g = gruptakiler(m);
  const olculmeyen = Object.values(m.unmeasured).reduce((a, v) => a + (v?.length ?? 0), 0);
  const parcalar = dilimler(m);
  const adSayisi = new Map<string, number>();
  for (const c of m.clusters) adSayisi.set(grupAdi(c), (adSayisi.get(grupAdi(c)) ?? 0) + 1);

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

      <div id="gruplar" className="scroll-mt-28 border-t border-border bg-canvas-sunken sm:scroll-mt-24">
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

          <ol className="mt-8 grid items-start gap-4 md:grid-cols-2">
            {m.clusters.slice(0, KART_SAYISI).map((c, i) => (
              <GrupKarti
                key={c.codes[0]}
                c={c}
                sira={i + 1}
                adlar={adlar}
                // Only where the name alone cannot tell this group from
                // another: then the page says why they are still two.
                yakin={adSayisi.get(grupAdi(c))! > 1 ? yakinGrupCumlesi(c, m.overlapping_threshold) : null}
              />
            ))}
          </ol>

          {m.clusters.length > KART_SAYISI && (
            <details className="group mt-6 rounded-card border border-border bg-surface">
              <summary className="cursor-pointer list-none px-6 py-4 text-body font-medium text-ink marker:hidden">
                Diğer {m.clusters.length - KART_SAYISI} grubu göster
                <span className="ml-2 text-ink-subtle group-open:hidden">+</span>
              </summary>
              {/* One line per group, each a link to the group's own page,
                  which carries the funds. */}
              <ul className="border-t border-border">
                {m.clusters.slice(KART_SAYISI).map((c, i) => (
                  <li key={c.codes[0]} className="border-t border-border first:border-t-0">
                    <Link
                      href={groupHref(c.anchor ?? c.codes[0])}
                      className="flex items-baseline gap-3 px-6 py-3 transition-colors hover:bg-canvas-sunken"
                    >
                      <span className="w-8 shrink-0 font-display text-label font-semibold text-ink-subtle tabular-nums">
                        {KART_SAYISI + i + 1}
                      </span>
                      <span className="min-w-0 flex-1 text-caption text-ink">{grupAdi(c)}</span>
                      <span className="shrink-0 text-caption text-ink-subtle tabular-nums">{c.size} fon →</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Column>
      </div>

      {donemler && (
        <Column className="pt-section">
          <section id="donemler" aria-labelledby="donemler-baslik" className="scroll-mt-28 sm:scroll-mt-24">
            <p className="text-overline uppercase text-accent">Dönemler</p>
            <h2 id="donemler-baslik" className="mt-4 max-w-prose text-display-sm text-balance">
              Varlık sınıfları arasındaki ilişki yıldan yıla değişiyor
            </h2>
            {donemGiris && (
              <p className="mt-4 max-w-prose text-lead text-ink-muted text-pretty">{donemGiris}</p>
            )}
            <p className="mt-4 max-w-prose text-body text-ink-muted text-pretty">
              Her varlık sınıfını aşağıda, adlar bölümünde saydığımız temsilci
              fonla ölçüyoruz. Bir ikilinin bir yıldaki ilişkisini, diğer
              yılların haftalarındaki ilişkisiyle karşılaştırıyoruz ve farkı
              yalnızca, o yılın {donemler.factors.length * (donemler.factors.length - 1) / 2}{" "}
              ikilisi birlikte sınandığında bile tesadüfle açıklanamayacak kadar
              büyükse gösteriyoruz.{" "}
              <Link href={`${METHOD_HREF}#donemler`} className="text-accent underline-offset-4 hover:underline">
                Nasıl sınadığımız
              </Link>
            </p>
            <Donemler data={donemler} />
          </section>
        </Column>
      )}

      <Column className="pt-section">
        <section id="adlar" className="max-w-prose scroll-mt-28 sm:scroll-mt-24">
          <h2 className="text-display-sm text-balance">Grupların adları nereden geliyor</h2>
          <p className="mt-4 text-body text-ink-muted text-pretty">
            TEFAS’ın kategorileri bir fonun hukuki türünü söylüyor, içinde ne
            olduğunu söylemiyor: “Serbest Fon” etiketli bir fon dolar tahvili de
            tutabilir, TL mevduat da. Bu yüzden grupları, getirilerinin neyden
            oluştuğuna bakarak adlandırıyoruz. Her grubun haftalık getirisini
            aşağıdaki sekiz etkenin bir karışımı olarak açıklıyoruz; karışımdaki
            paylar eksi olamıyor ve toplamları %100 ediyor (Sharpe’ın stil
            analizi). “Türk hisse %87 · TL faiz %12”, grubun haftalık
            hareketinin böyle bir karışımla en iyi açıklandığı anlamına geliyor.
            Payların ne kadar kesin olduğunu da ölçüyoruz: haftaları yeniden
            örnekleyip hesabı yüz kez tekrarlıyoruz. Bir pay 20 puandan geniş bir
            aralıkta oynuyorsa grubun adında o payı yazmıyor, yalnızca varlık
            sınıfını söylüyoruz: “Dolar · TL faiz”. Aralıkların hepsi grubun
            kendi sayfasında.
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
          <p className="mt-4 text-body text-ink-muted text-pretty">
            Sekiz etken bazı grupları birbirinden ayıramıyor: katılım
            hisseleri, temettü hisseleri ve geniş borsa aynı “Türk hisse”
            etkenine yükleniyor. Bu yüzden bir grubun adına, fonlarının
            adlarında ortak geçen bir kelimeyi de ekliyoruz; ama yalnızca
            grubun en az yarısında geçiyorsa ve grup dışındaki fonlarda en
            fazla yarısı kadar yaygınsa. Kurucu şirketin adındaki kelimeleri
            saymıyoruz: “QNB Sağlık Hayat” bir sağlık fonu değil. Aynı kuralla,
            fonların en az yarısı tek bir kurumunsa o kurumu da gösteriyoruz. Kelimenin kaç fonda geçtiğini her grubun altında
            yazıyoruz; kontrol etmek isterseniz grubun sayfasındaki listede
            hepsi var.
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

function GrupKarti({
  c,
  sira,
  adlar,
  yakin,
}: {
  c: MarketCluster;
  sira: number;
  adlar: Record<string, string>;
  yakin: string | null;
}) {
  const renk = sira <= RENKLI_GRUP ? `var(--group-${sira})` : "var(--ink-subtle)";
  const onizleme = c.codes.slice(0, ONIZLEME);
  const kalan = c.codes.slice(ONIZLEME);
  const sayfa = groupHref(c.anchor ?? c.codes[0]);

  return (
    <li className="flex flex-col overflow-hidden rounded-card border border-border bg-surface">
      <div className="h-1" style={{ background: renk }} />
      <div className="flex flex-1 flex-col px-5 pt-4 pb-5">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-body font-semibold text-ink-subtle tabular-nums">
            {sira}
          </span>
          <h3 className="min-w-0 text-lead font-semibold text-ink text-balance">
            <Link href={sayfa} className="underline-offset-4 hover:text-accent hover:underline">
              {grupAdi(c)}
            </Link>
          </h3>
        </div>
        {/* What sets this group apart from others of the same make-up, with
            the count that shows it, so the heading can be checked. */}
        {ayirtSatirlari(c).map((k) => (
          <p key={k} className="mt-1 text-caption text-accent tabular-nums">
            {k}
          </p>
        ))}
        {yakin && <p className="mt-1 text-caption text-ink-muted text-pretty">{yakin}</p>}
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
        {/* A range, not a pick: the funds in a group move as one, and the
            fee is what still differs between them. Which to hold is the
            reader's decision; the page states the spread and stops. */}
        {c.fee_low != null && c.fee_high != null && (
          <p className="mt-1 text-caption text-ink-muted tabular-nums">
            {c.fee_low === c.fee_high
              ? `Yıllık ücret ${ucretOrani(c.fee_low)}`
              : `Yıllık ücret ${ucretOrani(c.fee_low)} ile ${ucretOrani(c.fee_high)} arasında`}
          </p>
        )}
        <p className="mt-1 text-caption text-ink-subtle tabular-nums">
          En zayıf çiftin alt sınırı {korelasyon(c.weakest_ci_low)} · ortanca
          korelasyon {korelasyon(c.median_correlation)}
        </p>
        {/* The funds as the fund index lists them — code and name, each
            row a link to the fund's page — rather than a wall of code
            chips nobody can read a name off. The rest open in place, in a
            box that scrolls, so a 70-fund group does not push the next
            card a screen away. Everything is in the HTML either way. */}
        <ul className="mt-4 overflow-hidden rounded-control border border-border">
          {onizleme.map((code) => (
            <FonSatiri key={code} code={code} ad={adlar[code]} />
          ))}
        </ul>
        <Link
          href={sayfa}
          className="mt-3 inline-flex items-center gap-1.5 self-start text-label font-medium text-accent underline-offset-4 hover:underline"
        >
          {kalan.length > 0 ? `Tüm ${c.size} fonu gör` : "Grubun sayfası"}
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </li>
  );
}

/** One fund as the fund index shows it: code and name, linking to its page. */
function FonSatiri({ code, ad }: { code: string; ad?: string }) {
  return (
    <li className="border-t border-border first:border-t-0">
      <Link
        href={fundHref(code)}
        className="flex min-h-11 items-center gap-3 px-3.5 py-2 transition-colors hover:bg-canvas-sunken"
      >
        <span className="w-10 shrink-0 font-mono text-label text-accent">{code}</span>
        <span className="min-w-0 flex-1 truncate text-caption text-ink" title={ad ?? code}>
          {ad ?? "Adı bulunamadı"}
        </span>
      </Link>
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
