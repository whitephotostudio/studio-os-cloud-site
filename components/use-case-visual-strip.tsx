import { VisualSlot } from "@/components/visual-slot";
import { studioUseCases } from "@/lib/studio-os-content";

const useCaseCopy: Record<string, string> = {
  school:
    "Run photo day with faster capture, cleaner organization, and smoother delivery to families.",
  corporate:
    "Handle headshots and event coverage without piecing together extra software for galleries and delivery.",
  wedding:
    "Deliver polished galleries, manage selections, and keep the client experience organized from start to finish.",
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
              Everything You Need. One Workflow.
            </h2>
            <p className="mt-4 text-base leading-8 text-neutral-600">
              Stop switching between platforms. Studio OS connects your entire
              process — from photo day to final delivery.
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
