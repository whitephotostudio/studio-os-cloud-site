import { VisualSlot } from "@/components/visual-slot";
import { studioUseCases } from "@/lib/studio-os-content";

const useCaseCopy: Record<string, string> = {
  school:
    "Keep picture day structured from roster and capture to private parent gallery delivery.",
  corporate:
    "Handle headshots and events with organized delivery, downloads, and client access in one system.",
  wedding:
    "Deliver polished galleries and selections without losing the production workflow behind them.",
};

export function UseCaseVisualStrip() {
  return (
    <section className="pb-2 pt-2 sm:pb-4">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="rounded-[28px] border border-neutral-200 bg-neutral-50/85 p-6 sm:p-8">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">
              Platform overview
            </div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-neutral-950 sm:text-4xl">
              Great Galleries. Connected Workflow.
            </h2>
            <p className="mt-4 text-base leading-8 text-neutral-600">
              Studio OS supports polished delivery for portraits, weddings,
              events, schools, and structured volume jobs without splitting the
              work across disconnected tools.
            </p>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {studioUseCases.map((useCase) => (
              <article
                key={useCase.id}
                className="rounded-[24px] border border-neutral-200 bg-white p-4 shadow-[0_10px_30px_rgba(20,20,20,0.04)]"
              >
                <VisualSlot
                  src={useCase.src}
                  alt={useCase.alt}
                  label={`${useCase.label} image slot`}
                  hint="Approved photo can drop in here later."
                  aspectRatio="5 / 4"
                  className="rounded-[20px] border border-neutral-200 bg-[linear-gradient(180deg,#fbfbfa_0%,#f4f1ec_100%)]"
                />

                <div className="mt-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">
                    {useCase.label}
                  </div>
                  <div className="mt-2 text-xl font-semibold text-neutral-950">
                    {useCase.title}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-neutral-600">
                    {useCaseCopy[useCase.id] ?? useCase.description}
                  </p>
                  {!useCase.src ? (
                    <div className="mt-3 text-[11px] font-medium text-neutral-400">
                      {useCase.plannedImagePath}
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
