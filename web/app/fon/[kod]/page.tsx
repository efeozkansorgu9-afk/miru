import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { API_BASE_URL, ApiError, getFundList, getFundPage } from "@/lib/api";
import type { FundListItem, FundPageResponse } from "@/lib/api";
import { Column } from "@/components/column";
import { Reveal } from "@/components/reveal";
import { ScrollRise } from "@/components/scroll-rise";
import { BasketBridge, Footnote } from "@/components/fund/footer";
import { Identity } from "@/components/fund/identity";
import { NeighbourList } from "@/components/fund/neighbour-list";
import { Returns } from "@/components/fund/returns";
import {
  bulgu,
  enYakinKomsu,
  fonAciklamasi,
  heroBulgusu,
  komsuListesi,
} from "@/lib/fund";
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
 * This throws rather than degrading, and that is a correction of an earlier
 * decision rather than a preference. It used to catch the failure, warn, and
 * return an empty list, on the reasoning that a frontend build should not
 * require a database: `dynamicParams` is on, so every page would still render
 * on demand.
 *
 * What that produced in production was a green build that had generated zero
 * fund pages, because the API was answering 503 — and every fund URL then
 * rendered on demand, failed the same way, and returned a 500. The deploy
 * that broke the whole section looked exactly like the deploy that worked.
 * One line of warning in a build log nobody reads is not a signal.
 *
 * A build that cannot reach the fund list has nothing to publish, and the
 * right outcome is a red build: the previous deploy keeps serving, which is
 * a working site, instead of being replaced by a broken one.
 *
 * An empty list throws for the same reason. It is not a smaller version of
 * the same answer — it means the last weekly run priced nothing, and 1,372
 * pages silently becoming zero is the failure this function exists to catch.
 */
export async function generateStaticParams(): Promise<{ kod: string }[]> {
  let funds: FundListItem[];

  try {
    ({ funds } = await getFundList({ timeoutMs: 30_000 }));
  } catch (error) {
    // Re-thrown with the URL that was actually called. The API's own message
    // says what is wrong with the API; it does not say which build step
    // wanted it, and in a build log that is the missing half.
    throw new Error(
      `Fund pages cannot be generated: ${API_BASE_URL}/funds/list did not ` +
        `answer. Check that the API is up and that NEXT_PUBLIC_API_URL and ` +
        `the API's DATABASE_URL are set. Cause: ` +
        `${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  if (funds.length === 0) {
    throw new Error(
      `Fund pages cannot be generated: ${API_BASE_URL}/funds/list answered ` +
        `with an empty list. The last weekly run priced no funds, so there ` +
        `is nothing to publish.`,
    );
  }

  return funds.map((fund) => ({ kod: fund.code }));
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
  // One decision, two renderings: `bulgu` still owns the bucket-to-verdict
  // mapping, and `heroBulgusu` only rephrases it for a single line.
  const finding = heroBulgusu(
    bulgu(
      enYakinKomsu(page.high, komsular),
      page.neighbours_unavailable,
      page.fund.returns,
    ),
  );

  return (
    <div>
      {/* Who the fund is, what was found about it, and what it returned.
          The finding is up here rather than in a section of its own further
          down: it is why the page exists, and it used to sit below three
          boxes of metadata that between them said thirty characters. */}
      <Column className="pt-section pb-section">
        <div className="flex flex-col gap-section">
          <Reveal>
            <Identity fund={page.fund} bulgu={finding} />
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
            {/* No finding block here any more. It said the same fund the
                "Örtüşenler (1)" group below it said, and the verdict now
                leads the page. What is left is only the list the verdict
                was read off. */}
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
