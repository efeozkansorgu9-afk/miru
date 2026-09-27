import type { Metadata } from "next";

import { API_BASE_URL, getFundList } from "@/lib/api";
import { Column } from "@/components/column";
import { FundDirectory } from "@/components/fund/directory";
import { SITE } from "@/lib/site";

/**
 * The index of fund pages: `/fon`.
 *
 * Built once a day like the pages it lists, from the same `/funds/list`, so
 * the index and the pages cannot disagree about which funds exist.
 */
export const dynamic = "force-static";
export const revalidate = 86400;

export const metadata: Metadata = {
  // `absolute` for the same reason as a fund page: this is under the brand,
  // not under the basket tool, so the tool's name has no place in the title.
  title: { absolute: `Fonlar · ${SITE.brand}` },
  description:
    "TEFAS'ta işlem gören yatırım fonları: her biri için getiri, enflasyona göre getiri ve birlikte hareket ettiği fonlar.",
};

export default async function FonDizini() {
  let funds;
  try {
    ({ funds } = await getFundList({ timeoutMs: 30_000 }));
  } catch (error) {
    // Thrown rather than rendering an empty index, for the reason
    // `generateStaticParams` on the fund page gives: a green build with an
    // empty list replaces a working page with a broken one, and a red build
    // keeps the previous deploy serving.
    throw new Error(
      `Fund index cannot be generated: ${API_BASE_URL}/funds/list did not ` +
        `answer. Cause: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  const sorted = [...funds].sort((a, b) => a.code.localeCompare(b.code, "tr"));

  return (
    <Column className="pt-section pb-section-lg">
      <div className="enter">
      <div className="max-w-prose">
        <p className="text-overline uppercase text-accent">Fonlar</p>
        <h1 className="mt-4 text-display-md text-balance">
          Bir fonun sayfasını açın.
        </h1>
        <p className="mt-5 text-lead text-ink-muted text-pretty">
          Her fon için getirisi, enflasyona göre getirisi ve hangi fonlarla
          birlikte hareket ettiği.
        </p>
      </div>

      <div className="mt-10">
        <FundDirectory funds={sorted} />
      </div>
      </div>
    </Column>
  );
}
