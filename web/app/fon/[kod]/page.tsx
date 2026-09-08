import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { ApiError, getFundList, getFundPage } from "@/lib/api";
import type { FundPageResponse } from "@/lib/api";
import { Column } from "@/components/column";
import { Reveal } from "@/components/reveal";
import { ScrollRise } from "@/components/scroll-rise";
import { BasketBridge, Footnote } from "@/components/fund/footer";
import { Finding } from "@/components/fund/finding";
import { Identity } from "@/components/fund/identity";
import { NeighbourList } from "@/components/fund/neighbour-list";
import { Returns } from "@/components/fund/returns";
import { bulgu, enYakinKomsu, fonAciklamasi, komsuListesi } from "@/lib/fund";
import { SITE } from "@/lib/site";

/**
 * One fund: what it is, what it returned, and what else moves like it.
 *
 * Every number here was computed by `jobs.weekly` and read out of Postgres;
 * nothing on this page touches TEFAS, and nothing is computed at request
 * time. That is what makes it a static page rather than a tool, and it is
 * where this product's search traffic is meant to land.
 *
 * `force-static` with a day's `revalidate` rather than a cached `fetch`: the
 * API client sends an abort signal with every request, and the page's
 * freshness should not depend on whether that leaves the response cacheable.
 * The segment config says what is true either way — this page is prerendered
 * and rebuilt once a day, which is more often than the weekly job that fills
 * it.
 */
export const dynamic = "force-static";
export const revalidate = 86400;

/**
 * Fetch once per render pass.
 *
 * `generateMetadata` and the page body both need the whole payload, and
 * without this they would ask for it twice — 2,744 requests across a build
 * instead of 1,372.
 */
const load = cache(async (code: string): Promise<FundPageResponse> => {
  try {
    return await getFundPage(code);
  } catch (error) {
    // The only expected failure. A code the last run never saw is a page
    // that does not exist, which is a 404 and not an error to report.
    if (error instanceof ApiError && error.kind === "not_found") notFound();
    throw error;
  }
});

/**
 * A page per fund, built ahead of time.
 *
 * An empty list is not a failure here: `dynamicParams` is on by default, so
 * every page still renders on demand and caches itself. That is what keeps a
 * frontend build from requiring a database — a developer running `next build`
 * with no API up gets a working site whose fund pages fill in as they are
 * asked for, rather than a build that stops.
 */
export async function generateStaticParams(): Promise<{ kod: string }[]> {
  try {
    const { funds } = await getFundList({ timeoutMs: 30_000 });
    return funds.map((fund) => ({ kod: fund.code }));
  } catch (error) {
    console.warn(
      "[fon] fund list unavailable, pages will be rendered on demand:",
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}

/**
 * The title is the fund's name, then its code, then the brand.
 *
 * `absolute`, so the layout's template does not put the basket tool's name
 * in the middle of it: this page is not part of that tool, it is the fund's
 * own page under the same brand.
 */
export async function generateMetadata({
  params,
}: PageProps<"/fon/[kod]">): Promise<Metadata> {
  const { kod } = await params;
  const { fund } = await load(kod);

  return {
    title: { absolute: `${fund.name} (${fund.code}) · ${SITE.brand}` },
    description: fonAciklamasi(fund),
  };
}

export default async function FonSayfasi({ params }: PageProps<"/fon/[kod]">) {
  const { kod } = await params;
  const page = await load(kod);

  const komsular = komsuListesi(page.high, page.low);
  const finding = bulgu(
    enYakinKomsu(page.high, komsular),
    page.neighbours_unavailable,
    page.fund.returns,
  );

  return (
    <div>
      {/* Who the fund is, and what it did. Both are facts about the fund on
          its own, and both are here before anything is claimed about how it
          relates to anything else. */}
      <Column className="pt-section pb-section">
        <div className="flex flex-col gap-section">
          <Reveal>
            <Identity fund={page.fund} />
          </Reveal>

          <ScrollRise>
            <Returns returns={page.fund.returns} />
          </ScrollRise>
        </div>
      </Column>

      {/* Everything measured against other funds sits on the sunken ground,
          the same way an analysis does on the basket page. The change of
          ground is the page saying it has moved from describing to
          comparing. */}
      <div className="border-t border-border bg-canvas-sunken">
        <Column className="py-section">
          <div className="flex flex-col gap-section">
            <ScrollRise>
              <Finding bulgu={finding} />
            </ScrollRise>

            <ScrollRise>
              <NeighbourList komsular={komsular} />
            </ScrollRise>

            <ScrollRise>
              <Footnote freshness={page.freshness} />
            </ScrollRise>

            <ScrollRise>
              <BasketBridge code={page.fund.code} />
            </ScrollRise>
          </div>
        </Column>
      </div>
    </div>
  );
}
