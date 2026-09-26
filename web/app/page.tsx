import type { Metadata } from "next";
import Link from "next/link";

import { getFundList, getFundPage } from "@/lib/api";
import type { FundPageResponse, Neighbour } from "@/lib/api";
import { Column } from "@/components/column";
import { Reveal } from "@/components/reveal";
import { korelasyon, sayi, tarih } from "@/lib/format";
import { sparkLines } from "@/lib/neighbour-chart";
import { FUND_BASE, METHOD_HREF, SITE, TOOL, fundHref } from "@/lib/site";

/**
 * The brand's home page: `/`.
 *
 * Says what miru is in one screen, shows one real finding from the last
 * weekly run, and points at the three places to go. Static, rebuilt daily.
 *
 * **The example is measured, never written down.** It is read at build time
 * from `/fund/{code}` for the first of `ORNEK_ADAYLARI` whose closest
 * neighbour is `overlapping`, so the pair, its coefficient and its chart are
 * whatever the last Monday measured. A hand-typed "AFO and HBF, 0,986" would
 * go on asserting that after the correlation drifted, which is the thing
 * this product does not do. When no candidate qualifies, or the API is
 * down, the hero renders without the card rather than failing the build.
 */
export const dynamic = "force-static";
export const revalidate = 86400;

export const metadata: Metadata = {
  title: { absolute: `${SITE.brand} · Sepetinde ne var?` },
  description:
    "Türk yatırım fonlarından kurulmuş bir sepetin gerçekte kaç ayrı şeye yatırıldığını gösterir. Tavsiye vermez; elinizde ne olduğunu gösterir.",
};

/** Well-known funds whose closest neighbour is likely to make the point. */
const ORNEK_ADAYLARI = ["AFO", "AKU", "TI2", "HBF"];

interface Ornek {
  page: FundPageResponse;
  komsu: Neighbour;
}

async function ornekBul(): Promise<Ornek | null> {
  for (const code of ORNEK_ADAYLARI) {
    try {
      const page = await getFundPage(code, { timeoutMs: 20_000 });
      const komsu = page.high[0];
      if (komsu && komsu.bucket === "overlapping" && komsu.recent && page.series) {
        return { page, komsu };
      }
    } catch {
      // Next candidate. A home page that cannot show an example is still a
      // home page.
    }
  }
  return null;
}

async function fonSayisi(): Promise<number | null> {
  try {
    const { funds } = await getFundList({ timeoutMs: 20_000 });
    return funds.length > 0 ? funds.length : null;
  } catch {
    return null;
  }
}

export default async function AnaSayfa() {
  const [ornek, n] = await Promise.all([ornekBul(), fonSayisi()]);
  const guncelleme = ornek?.page.freshness.last_run_at?.slice(0, 10) ?? null;

  return (
    <div>
      {/* Hero: what this is, and one real pair beside it. */}
      <Column className="pt-section pb-section">
        <div
          className={`grid items-center gap-12 ${ornek ? "lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-16" : ""}`}
        >
          <Reveal className="max-w-prose">
            <p className="text-overline uppercase text-accent">
              TEFAS yatırım fonları için
            </p>
            <h1 className="mt-4 text-display-xl text-balance">
              Sepetinde ne var?
            </h1>
            <p className="mt-6 text-lead text-ink-muted text-pretty">
              Birkaç farklı fon aldığınızda paranızı dağıttığınızı düşünürsünüz.
              Çoğu zaman öyle değildir: farklı kurumların fonları aynı şeyi alıp
              satıyor olabilir. {SITE.brand}, elinizdeki fonların gerçekte kaç
              ayrı şeye yatırıldığını gösterir.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
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
          </Reveal>

          {ornek && (
            <Reveal delay={120}>
              <OrnekKart ornek={ornek} />
            </Reveal>
          )}
        </div>

        {n !== null && (
          <Reveal delay={200}>
            <dl className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-card border border-border bg-border sm:grid-cols-3">
              <Sayac deger={sayi(n)} etiket="fonun sayfası var" />
              <Sayac
                deger={sayi((n * (n - 1)) / 2)}
                etiket="fon çifti karşılaştırıldı"
              />
              <Sayac
                deger={guncelleme ? tarih(guncelleme) : "Her pazartesi"}
                etiket={guncelleme ? "son ölçüm, her pazartesi yenilenir" : "yeniden ölçülüyor"}
              />
            </dl>
          </Reveal>
        )}
      </Column>

      {/* The three places to go. */}
      <div className="border-t border-border bg-canvas-sunken">
        <Column className="py-section">
          <p className="text-overline uppercase text-ink-subtle">Neler var</p>
          <h2 className="mt-4 max-w-prose text-display-sm text-balance">
            Üç yerden başlayabilirsiniz.
          </h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <Arac
              href={TOOL.href}
              baslik={TOOL.name}
              metin="Fonlarınızı ve tutarlarını girin. Hangilerinin birlikte hareket ettiğini, sepetinizin gerçekte kaç parçaya bölündüğünü görün."
              eylem="Sepetinizi inceleyin"
            />
            <Arac
              href={FUND_BASE}
              baslik="Fon sayfaları"
              metin={`${n !== null ? sayi(n) : "Yüzlerce"} fonun her biri için getirisi, enflasyona göre getirisi ve hangi fonlarla birlikte hareket ettiği.`}
              eylem="Fonlara göz atın"
            />
            <Arac
              href={METHOD_HREF}
              baslik="Yöntem"
              metin="Her sayının nereden geldiği: haftalık getiriler, güven aralıkları ve neden bazı sorulara cevap vermediğimiz."
              eylem="Yöntemi okuyun"
            />
          </div>
        </Column>
      </div>

      {/* How the basket tool answers, in three steps. */}
      <Column className="py-section">
        <p className="text-overline uppercase text-ink-subtle">Nasıl çalışıyor</p>
        <h2 className="mt-4 max-w-prose text-display-sm text-balance">
          Bir sepeti incelemek üç adım.
        </h2>
        <ol className="mt-8 grid gap-8 md:grid-cols-3">
          <Adim no={1} baslik="Fonlarınızı girin">
            Kodunu ya da adını yazın, ne kadar tuttuğunuzu ekleyin. Kademeli
            aldıysanız alım tarihlerini de girebilirsiniz.
          </Adim>
          <Adim no={2} baslik="Birlikte ölçüyoruz">
            Son beş yılın haftalık getirilerini karşılaştırıyor, her fon çiftinin
            ne kadar aynı hareket ettiğini buluyoruz.
          </Adim>
          <Adim no={3} baslik="Gerçek dağılımı görün">
            Hangi fonların aslında tek bir şey olduğunu ve sepetinizin ne
            kadarını kapladıklarını açıkça söylüyoruz.
          </Adim>
        </ol>
      </Column>

      {/* What it will not do, which is half of what it is. */}
      <div className="border-t border-border bg-canvas-sunken">
        <Column className="py-section">
          <div className="max-w-prose">
            <h2 className="text-display-sm text-balance">
              Size ne almanız gerektiğini söylemiyoruz.
            </h2>
            <p className="mt-4 text-body text-ink-muted text-pretty">
              Elinizde ne olduğunu gösteriyoruz; kararı siz veriyorsunuz.
              Yeterli veri olmayan yerde tahmin yürütmüyor, bir sepete
              “güvenli” ya da “iyi dağılmış” gibi notlar vermiyoruz. Her sayının
              nasıl hesaplandığını açıkça yazıyoruz.
            </p>
            <Link
              href={METHOD_HREF}
              className="mt-6 inline-flex items-center gap-1.5 text-body font-medium text-accent transition-colors hover:text-accent-hover"
            >
              Nasıl ölçtüğümüzü okuyun
              <Ok />
            </Link>
          </div>
        </Column>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

/**
 * One real pair from the last run: this fund, its closest neighbour, and
 * their last year from 100. The same drawing as the neighbour card on a
 * fund page, larger, and with the same colours for the same roles.
 */
function OrnekKart({ ornek }: { ornek: Ornek }) {
  const { page, komsu } = ornek;
  const W = 360;
  const H = 150;
  const lines = sparkLines(page.series, komsu.recent, W, H, 6);
  // Unknown is not "different": a fund whose founder could not be read off
  // its title gets the sentence that claims neither.
  const kurumlar =
    page.fund.founder === null || komsu.fund.founder === null
      ? "bilinmiyor"
      : page.fund.founder === komsu.fund.founder
        ? "ayni"
        : "ayri";

  return (
    <Link
      href={fundHref(page.fund.code)}
      className="group block overflow-hidden rounded-card border border-border bg-surface shadow-lg shadow-black/5 transition-colors hover:border-accent"
    >
      <div className="h-1 bg-accent" />
      <div className="px-5 pt-4 pb-5">
        <p className="text-overline uppercase text-ink-subtle">
          Son ölçümden bir örnek
        </p>
        <p className="mt-3 text-display-sm">
          <span className="text-accent">{page.fund.code}</span>
          <span className="text-ink-subtle"> ile </span>
          <span className="text-series-alt">{komsu.fund.code}</span>
        </p>
        <p className="mt-1 text-caption text-ink-muted text-pretty">
          {kurumlar === "ayni"
            ? "Aynı kurumun iki fonu, haftalık getirileri neredeyse aynı."
            : kurumlar === "ayri"
              ? "İki ayrı kurumun iki fonu, ama haftalık getirileri neredeyse aynı."
              : "İki fonun haftalık getirileri neredeyse aynı."}{" "}
          İkisini birden tutmak, aynı şeyi iki kez almak demek.
        </p>

        {lines && (
          <figure className="mt-4 rounded-control bg-canvas-sunken px-2 pt-2 pb-2">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="block h-36 w-full"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <line
                x1={0}
                x2={W}
                y1={lines.baseY}
                y2={lines.baseY}
                stroke="var(--border-strong)"
                strokeDasharray="2 3"
                vectorEffect="non-scaling-stroke"
              />
              {lines.subject && (
                <path
                  d={lines.subject}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              <path
                d={lines.neighbour}
                fill="none"
                stroke="var(--series-alt)"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <figcaption className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-label text-ink-muted">
              <Anahtar renk="bg-accent" etiket={page.fund.code} />
              <Anahtar renk="bg-series-alt" etiket={komsu.fund.code} />
              <span className="ml-auto text-ink-subtle">
                Son {lines.weeks} hafta · 100&apos;den
              </span>
            </figcaption>
          </figure>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-3 text-caption tabular-nums">
          <div>
            <dt className="text-label text-ink-subtle">Korelasyon</dt>
            <dd className="mt-0.5 text-body font-semibold text-ink">
              {korelasyon(komsu.correlation)}
            </dd>
          </div>
          <div>
            <dt className="text-label text-ink-subtle">%95 güven aralığı</dt>
            <dd className="mt-0.5 text-body font-semibold text-ink">
              {komsu.ci_low !== null && komsu.ci_high !== null
                ? `${korelasyon(komsu.ci_low)} – ${korelasyon(komsu.ci_high)}`
                : "—"}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-caption text-ink-subtle">
          {komsu.n_weeks} haftalık ortak geçmiş üzerinden.{" "}
          <span className="text-accent group-hover:underline">
            {page.fund.code} sayfasına git
          </span>
        </p>
      </div>
    </Link>
  );
}

function Anahtar({ renk, etiket }: { renk: string; etiket: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={`h-0.5 w-3 rounded-full ${renk}`} />
      {etiket}
    </span>
  );
}

function Sayac({ deger, etiket }: { deger: string; etiket: string }) {
  return (
    <div className="bg-surface px-6 py-5">
      <dt className="sr-only">{etiket}</dt>
      <dd>
        <span className="block font-display text-display-sm font-semibold tabular-nums text-ink">
          {deger}
        </span>
        <span aria-hidden className="mt-1 block text-caption text-ink-subtle">
          {etiket}
        </span>
      </dd>
    </div>
  );
}

function Arac({
  href,
  baslik,
  metin,
  eylem,
}: {
  href: string;
  baslik: string;
  metin: string;
  eylem: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-card border border-border bg-surface px-6 py-6 transition-colors hover:border-accent"
    >
      <h3 className="text-lead font-semibold text-ink">{baslik}</h3>
      <p className="mt-2 flex-1 text-body text-ink-muted text-pretty">{metin}</p>
      <span className="mt-5 inline-flex items-center gap-1.5 text-body font-medium text-accent">
        {eylem}
        <Ok className="transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

function Adim({
  no,
  baslik,
  children,
}: {
  no: number;
  baslik: string;
  children: React.ReactNode;
}) {
  return (
    <li>
      <span
        aria-hidden
        className="inline-flex size-9 items-center justify-center rounded-full bg-accent-surface font-display text-body font-semibold text-accent"
      >
        {no}
      </span>
      <h3 className="mt-4 text-lead font-semibold text-ink">{baslik}</h3>
      <p className="mt-2 text-body text-ink-muted text-pretty">{children}</p>
    </li>
  );
}

function Ok({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`size-4 ${className ?? ""}`}
    >
      <path d="M4 10h11M11 5l5 5-5 5" />
    </svg>
  );
}
