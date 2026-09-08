import Link from "next/link";

import { Column } from "@/components/column";
import { Reveal } from "@/components/reveal";
import { TOOL } from "@/lib/site";

/**
 * A code with no fund behind it.
 *
 * It says what it can and does not guess. A code the last weekly run never
 * saw is either a typo or a fund TEFAS has stopped listing, and from here
 * those two are indistinguishable — TEFAS answers both the same way — so the
 * page names both possibilities rather than picking one.
 *
 * The way out is the basket tool, which is the only other thing to do here.
 */
export default function FonBulunamadi() {
  return (
    <Column className="pt-section pb-section-lg">
      <Reveal className="max-w-prose">
        <p className="text-overline uppercase text-caution">Fon bulunamadı</p>
        <h1 className="mt-4 text-display-md text-balance">
          Böyle bir fon sayfası yok.
        </h1>
        <p className="mt-5 text-lead text-ink-muted text-pretty">
          Aradığınız kod son taramada listede değildi. Kodda bir yazım hatası
          olabilir, ya da fon TEFAS&apos;ta artık işlem görmüyor olabilir — bu
          ikisi dışarıdan ayırt edilemiyor.
        </p>
        <Link
          href={TOOL.href}
          className="mt-8 inline-flex items-center rounded-control border border-border-strong bg-surface px-6 py-3.5 text-body font-medium text-ink transition-colors hover:border-accent hover:text-accent"
        >
          {TOOL.name}&apos;ne git
        </Link>
      </Reveal>
    </Column>
  );
}
