import { ApiStatus } from "@/components/api-status";
import { Reveal } from "@/components/reveal";
import { SITE } from "@/lib/site";

/**
 * Placeholder home page.
 *
 * Deliberately almost empty: this step is the foundation, not the screens.
 * What is here exercises the parts that have to work before any screen can
 * be built, so a broken one is visible now rather than three components
 * later: the type scale, the semantic colours in both themes, and a live
 * call to the backend.
 */
export default function Home() {
  return (
    <div className="mx-auto w-full max-w-page px-gutter py-section-lg">
      <Reveal className="max-w-prose">
        <p className="text-overline uppercase text-accent">Kuruluyor</p>
        <h1 className="mt-4 text-display-xl text-balance">
          Sepetiniz göründüğü kadar dağınık mı?
        </h1>
        <p className="mt-6 text-lead text-ink-muted text-pretty">
          {SITE.name} bir fon sepetinin gerçekte nasıl dağıldığını ölçer.
          Arayüz henüz kurulum aşamasında, aşağıdaki bağlantı kontrolü ise
          şimdiden çalışıyor.
        </p>
      </Reveal>

      <div className="mt-section max-w-prose">
        <ApiStatus />
      </div>
    </div>
  );
}
