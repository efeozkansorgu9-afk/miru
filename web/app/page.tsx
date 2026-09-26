import type { Metadata } from "next";
import Link from "next/link";

import { getFundList } from "@/lib/api";
import { Column } from "@/components/column";
import { OrnekCarousel } from "@/components/home/example-carousel";
import { Reveal } from "@/components/reveal";
import { sayi, tarih } from "@/lib/format";
import { ornekleriBul } from "@/lib/home-examples";
import { FUND_BASE, METHOD_HREF, SITE, TOOL } from "@/lib/site";

/**
 * The brand's home page: `/`.
 *
 * Says what miru is in one screen, shows real findings from the last weekly
 * run, and points at the three places to go. Static, rebuilt daily.
 *
 * **The examples are measured, never written down.** `lib/home-examples`
 * picks them at build time from `/fund/{code}`, so the pairs, coefficients
 * and charts are whatever the last Monday measured, and `OrnekCarousel`
 * shows them one at a time. When nothing qualifies, or the API is down, the
 * hero renders without the card rather than failing the build.
 */
export const dynamic = "force-static";
export const revalidate = 86400;

export const metadata: Metadata = {
  title: { absolute: `${SITE.brand} · Sepetinde ne var?` },
  description:
    "Türk yatırım fonlarından kurulmuş bir sepetin gerçekte kaç ayrı şeye yatırıldığını gösterir. Tavsiye vermez; elinizde ne olduğunu gösterir.",
};

async function fonSayisi(): Promise<number | null> {
  try {
    const { funds } = await getFundList({ timeoutMs: 20_000 });
    return funds.length > 0 ? funds.length : null;
  } catch {
    return null;
  }
}

export default async function AnaSayfa() {
  const [{ ornekler, sonOlcum: guncelleme }, n] = await Promise.all([
    ornekleriBul(),
    fonSayisi(),
  ]);
  const ornekVar = ornekler.length > 0;

  return (
    <div>
      {/* Hero: what this is, and real pairs beside it. */}
      <Column className="pt-section pb-section">
        <div
          className={`grid items-center gap-12 ${ornekVar ? "lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-16" : ""}`}
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

          {ornekVar && (
            <Reveal delay={120}>
              <OrnekCarousel ornekler={ornekler} />
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
