import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cache } from "react";

import { API_BASE_URL, ApiError, getMarket, getMarketGroup } from "@/lib/api";
import type { GroupMember, MarketGroupResponse } from "@/lib/api";
import { Column } from "@/components/column";
import { Reveal } from "@/components/reveal";
import { karsilastirilabilir, ucretOrani } from "@/lib/fee";
import { korelasyon, oran, paraKisa, sayi, tarih } from "@/lib/format";
import { grupCizgileri } from "@/lib/group-chart";
import { ayirtSatirlari, bilesim, grupAdi, kategoriSatiri, yakinGrupCumlesi } from "@/lib/market";
import { MARKET_HREF, METHOD_HREF, SITE, fundHref, groupHref } from "@/lib/site";

/**
 * One market group: what it is made of and every fund in it.
 *
 * Addressed by any member's code; the map links to each group by its
 * largest fund. A code in no group — a fund with no twin, or one that was
 * not measured — goes to that fund's own page, which says why.
 *
 * The fund list is alphabetical and stays that way. The funds in a group
 * move as one; listing them by fee or by return would turn a finding into a
 * shortlist, and which of them to hold is the reader's decision.
 */
export const dynamic = "force-static";
export const revalidate = 86400;

const load = cache(async (code: string): Promise<MarketGroupResponse> => {
  try {
    return await getMarketGroup(code, { timeoutMs: 90_000 });
  } catch (error) {
    if (error instanceof ApiError && error.kind === "not_found") redirect(fundHref(code));
    throw error;
  }
});

/** A page per group, addressed by its largest fund. */
export async function generateStaticParams(): Promise<{ kod: string }[]> {
  try {
    const m = await getMarket({ timeoutMs: 90_000 });
    return m.clusters.flatMap((c) => (c.anchor ? [{ kod: c.anchor }] : []));
  } catch (error) {
    throw new Error(
      `Group pages cannot be generated: ${API_BASE_URL}/market/clusters did not answer. ` +
        `Cause: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export async function generateMetadata({ params }: PageProps<"/piyasa/grup/[kod]">): Promise<Metadata> {
  const { kod } = await params;
  const g = await load(kod.toUpperCase());
  const ad = grupAdi(g.cluster);
  return {
    title: { absolute: `${ad} · ${g.cluster.size} fon · ${SITE.brand}` },
    description:
      `Haftalık hareketi neredeyse aynı olan ${g.cluster.size} fon: ${ad}. ` +
      `Fonların listesi, büyüklükleri ve yıllık ücretleri.`,
  };
}

export default async function GrupSayfasi({ params }: PageProps<"/piyasa/grup/[kod]">) {
  const { kod } = await params;
  const upper = kod.toUpperCase();
  if (upper !== kod) redirect(`${MARKET_HREF}/grup/${upper}`);
  const g = await load(upper);
  const c = g.cluster;
  const bilesenler = bilesim(c.style);
  const kanitlar = ayirtSatirlari(c);
  const cizgi = grupCizgileri(g.members, 800, 260);
  const yakin = yakinGrupCumlesi(c, g.overlapping_threshold);

  return (
    <div>
      <Column className="pt-section pb-12">
        <Reveal className="max-w-prose">
          <Link
            href={`${MARKET_HREF}#gruplar`}
            className="text-label text-ink-muted underline-offset-4 hover:text-accent hover:underline"
          >
            ← Piyasa haritası
          </Link>
          <p className="mt-8 text-overline uppercase text-accent">
            {g.rank}. grup · {sayi(g.groups)} grup içinde
          </p>
          <h1 className="mt-4 text-display-md text-balance">{grupAdi(c)}</h1>
          {kanitlar.length > 0 && (
            <ul className="mt-4 flex flex-col gap-1 text-body text-ink-muted tabular-nums">
              {kanitlar.map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ul>
          )}
          <p className="mt-6 text-lead text-ink-muted text-pretty">
            Bu {c.size} fonun her ikisi arasındaki ilişki, güven aralığının alt
            ucunda bile {korelasyon(g.overlapping_threshold)} eşiğinin üstünde:
            haftadan haftaya neredeyse aynı hareketi yapıyorlar. Farklı kurumların,
            farklı adlarla sattığı ürünler olabilirler; aşağıda hepsi var.
          </p>
        </Reveal>

        <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-border bg-border sm:grid-cols-4">
          <Olcu etiket="Fon" deger={sayi(c.size)} />
          <Olcu etiket="Farklı kurum" deger={sayi(c.founders)} />
          <Olcu etiket="Toplam büyüklük" deger={c.total_assets != null ? paraKisa(c.total_assets) : "—"} />
          <Olcu
            etiket="Yıllık ücret"
            deger={
              c.fee_low != null && c.fee_high != null
                ? c.fee_low === c.fee_high
                  ? ucretOrani(c.fee_low)
                  : `${ucretOrani(c.fee_low)} – ${ucretOrani(c.fee_high)}`
                : "—"
            }
          />
        </dl>
        {yakin && (
          <p className="mt-3 max-w-prose text-caption text-ink-muted text-pretty">
            {yakin}{" "}
            {c.nearest?.anchor && (
              <Link href={groupHref(c.nearest.anchor)} className="text-accent underline-offset-4 hover:underline">
                {c.nearest.rank}. gruba git
              </Link>
            )}
          </p>
        )}
        <p className="mt-3 text-caption text-ink-subtle tabular-nums">
          En zayıf çiftin alt sınırı {korelasyon(c.weakest_ci_low)} · ortanca korelasyon{" "}
          {korelasyon(c.median_correlation)}
          {kategoriSatiri(c) ? ` · ${kategoriSatiri(c)}` : ""}
        </p>

        {bilesenler && c.style && (
          <section className="mt-12 max-w-prose">
            <h2 className="text-lead font-semibold text-ink">Grubun getirisi neyden oluşuyor</h2>
            <dl className="mt-4 flex flex-col gap-2.5">
              {bilesenler.map((b) => (
                <div key={b.anahtar} className="grid grid-cols-[6.5rem_1fr_6.5rem] items-center gap-3">
                  <dt className="text-caption text-ink-muted">{b.ad}</dt>
                  {/* The bar is the fitted weight; the band behind it is the
                      5-95% range over block-bootstrap resamples. */}
                  <dd className="relative h-2 rounded-full bg-canvas-sunken" aria-hidden="true">
                    {b.aralik && (
                      <span
                        className="absolute inset-y-0 rounded-full bg-accent/20"
                        style={{ left: `${b.aralik[0] * 100}%`, width: `${(b.aralik[1] - b.aralik[0]) * 100}%` }}
                      />
                    )}
                    <span className="absolute inset-y-0 left-0 rounded-full bg-accent/70" style={{ width: `${b.pay * 100}%` }} />
                  </dd>
                  <dd className="text-right text-caption text-ink tabular-nums">
                    %{Math.round(b.pay * 100)}
                    {b.aralik && (
                      <span className="text-ink-subtle">
                        {" "}
                        ({Math.round(b.aralik[0] * 100)}–{Math.round(b.aralik[1] * 100)})
                      </span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-caption text-ink-subtle text-pretty">
              Grubun eşit ağırlıklı haftalık getirisinin, her biri bir temsilci
              fonla ölçülen varlık sınıflarına ayrıştırılması. Açıklama gücü (R²){" "}
              {oran(c.style.r2)}. Parantez içindeki aralık, haftalar yeniden
              örneklendiğinde payın yüzde 90 olasılıkla kaldığı aralık; geniş bir
              aralık, varlık sınıfları birlikte hareket ettiği için payın kesin
              ölçülemediğini gösteriyor
              {bilesenler.some((b) => !b.kesin)
                ? ", bu yüzden grubun adında bu payları yazmıyoruz."
                : "."}{" "}
              <Link href={`${METHOD_HREF}#harita`} className="text-accent underline-offset-4 hover:underline">
                Nasıl hesaplandığı
              </Link>
            </p>
          </section>
        )}

        {cizgi && (
          <figure className="mt-12">
            <figcaption className="text-lead font-semibold text-ink">
              Son {cizgi.weeks} hafta, her fon 100’den
            </figcaption>
            <p className="mt-1 text-caption text-ink-subtle">
              Her çizgi bir fon. Birbirinin üstüne binmeleri grubun iddiası.
            </p>
            <div className="mt-4 rounded-card border border-border bg-surface p-4">
              <svg viewBox="0 0 800 260" className="block h-auto w-full" role="img" aria-label={`${c.size} fonun son ${cizgi.weeks} haftası`}>
                <line x1="0" x2="800" y1={cizgi.baseY} y2={cizgi.baseY} stroke="var(--border-strong)" strokeDasharray="3 4" />
                {cizgi.paths.map((p) => (
                  <path key={p.code} d={p.d} fill="none" stroke="var(--accent)" strokeOpacity={0.35} strokeWidth={1.4} vectorEffect="non-scaling-stroke">
                    <title>{p.code}</title>
                  </path>
                ))}
              </svg>
              <div className="mt-2 flex justify-between text-label text-ink-subtle tabular-nums">
                <span>{tarih(cizgi.start)}</span>
                <span>
                  en düşük {Math.round(cizgi.lo)} · en yüksek {Math.round(cizgi.hi)}
                </span>
                <span>{tarih(cizgi.end)}</span>
              </div>
            </div>
          </figure>
        )}
      </Column>

      <div className="border-t border-border bg-canvas-sunken">
        <Column className="py-section">
          <h2 className="text-display-sm text-balance">Gruptaki {c.size} fon</h2>
          <p className="mt-3 max-w-prose text-body text-ink-muted text-pretty">
            Alfabetik sırayla. Aynı hareketi yapan fonları ücrete ya da getiriye
            göre sıralamıyoruz; hangisini tutacağınız sizin kararınız. Her satır
            fonun kendi sayfasına gider.
          </p>
          <FonTablosu members={g.members} />
        </Column>
      </div>
    </div>
  );
}

function Olcu({ etiket, deger }: { etiket: string; deger: string }) {
  return (
    <div className="bg-surface px-5 py-4">
      <dt className="text-label text-ink-subtle">{etiket}</dt>
      <dd className="mt-1 text-lead font-semibold text-ink tabular-nums">{deger}</dd>
    </div>
  );
}

function FonTablosu({ members }: { members: GroupMember[] }) {
  return (
    <ul className="mt-8 overflow-hidden rounded-card border border-border bg-surface">
      <li
        aria-hidden="true"
        className="hidden grid-cols-[4rem_minmax(0,1fr)_8rem_8rem] gap-4 border-b border-border px-6 py-2.5 text-label text-ink-subtle sm:grid"
      >
        <span>Kod</span>
        <span>Fon</span>
        <span className="text-right">Büyüklük</span>
        <span className="text-right">Yıllık ücret</span>
      </li>
      {members.map(({ fund }) => (
        <li key={fund.code} className="border-t border-border first:border-t-0 sm:[&:nth-child(2)]:border-t-0">
          <Link
            href={fundHref(fund.code)}
            className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-0.5 px-4 py-3 transition-colors hover:bg-canvas-sunken sm:grid-cols-[4rem_minmax(0,1fr)_8rem_8rem] sm:px-6"
          >
            <span className="font-mono text-label text-accent sm:row-span-1">{fund.code}</span>
            <span className="min-w-0">
              <span className="block truncate text-body text-ink" title={fund.name}>
                {fund.name}
              </span>
              <span className="block truncate text-caption text-ink-subtle">
                {fund.founder ?? "Kurucusu belirtilmemiş"}
                <span className="sm:hidden tabular-nums">
                  {fund.total_assets != null ? ` · ${paraKisa(fund.total_assets)}` : ""}
                  {fund.fee ? ` · ücret ${ucretSade(fund.fee)}` : ""}
                </span>
              </span>
            </span>
            <span className="hidden text-right text-caption text-ink tabular-nums sm:block">
              {fund.total_assets != null ? paraKisa(fund.total_assets) : "—"}
            </span>
            <span className="hidden text-right text-caption text-ink tabular-nums sm:block">
              {fund.fee ? ucretSade(fund.fee) : "—"}
              {fund.fee?.kind === "operating" && (
                <span className="block text-label text-ink-subtle">işletim gideri</span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ucretSade(fee: NonNullable<GroupMember["fund"]["fee"]>): string {
  return karsilastirilabilir(fee) ? ucretOrani(fee.rate) : "sıfır bildirilmiş";
}
