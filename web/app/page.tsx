import { BasketForm } from "@/components/basket/basket-form";
import { Reveal } from "@/components/reveal";

/**
 * The input screen: what is in your basket.
 *
 * Everything above the form is server rendered and revealed by CSS, so the
 * question is on the page before any JavaScript arrives. The form itself is
 * interactive and therefore a client component.
 */
export default function Home() {
  return (
    <div className="mx-auto w-full max-w-page px-gutter py-section">
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

      <div className="mt-section max-w-4xl">
        <BasketForm />
      </div>
    </div>
  );
}
