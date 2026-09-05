import { BasketWorkspace } from "@/components/basket/basket-workspace";
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
      <div className="mx-auto w-full max-w-page px-gutter pt-section">
        <Reveal className="max-w-prose">
          <p className="text-overline uppercase text-accent">Sepet incelemesi</p>
          <h1 className="mt-4 text-display-lg text-balance">
            Neye sahipsiniz?
          </h1>
          <p className="mt-5 text-lead text-ink-muted text-pretty">
            Fonlarınızı ekleyin, ne kadarını tuttuğunuzu yazın. Birlikte hareket
            eden fonları bulup sepetinizin gerçekte ne kadar dağıldığını
            söyleyelim.
          </p>
        </Reveal>
      </div>

      <BasketWorkspace />
    </div>
  );
}
