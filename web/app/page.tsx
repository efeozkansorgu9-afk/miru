import { BasketWorkspace } from "@/components/basket/basket-workspace";
import { Column } from "@/components/column";
import { Reveal } from "@/components/reveal";

/**
 * The whole product on one page: what is in your basket, then what that means.
 *
 * Everything above the workspace is server rendered and revealed by CSS, so
 * the question is on the page before any JavaScript arrives. The basket and
 * the result share state, so they live together in one client component
 * below.
 */
export default function Home() {
  return (
    <div>
      {/* The only centred text on the page. It is three lines that are read
          in one glance before anything is asked of the reader, which is what
          centring suits; everything below is a form to fill in or a table to
          scan, and those stay left aligned. `text-balance` on the paragraph
          so its two lines come out near the same length, which is what stops
          centred text looking like a spill. */}
      <Column className="pt-section">
        <Reveal className="mx-auto max-w-lede text-center">
          <p className="text-overline uppercase text-accent">Sepet incelemesi</p>
          <h1 className="mt-4 text-display-lg text-balance">
            Neye sahipsiniz?
          </h1>
          <p className="mt-5 text-lead text-ink-muted text-balance">
            Fonlarınızı ekleyin, ne kadarını tuttuğunuzu yazın. Birlikte hareket
            eden fonları bulup sepetinizin gerçekte ne kadar dağıldığını
            söyleyelim.
          </p>
        </Reveal>
      </Column>

      <BasketWorkspace />
    </div>
  );
}
