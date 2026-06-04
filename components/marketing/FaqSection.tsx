import { homeFaqItems } from "@/lib/marketing-faq";
import { Reveal } from "./Reveal";

export function FaqSection() {
  return (
    <section className="bg-white px-4 py-20 text-neutral-950 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
        <Reveal>
          <div>
            <p className="marketing-kicker text-red-600">Questions</p>
            <h2 className="marketing-title mt-4 max-w-xl">
              Clear answers for gallery and workflow buyers.
            </h2>
            <p className="marketing-body mt-5 max-w-xl text-neutral-600">
              Studio OS Cloud can stand alone as a premium gallery platform, and
              it can also support deeper production workflows when a job needs
              more structure behind the scenes.
            </p>
          </div>
        </Reveal>

        <div className="divide-y divide-neutral-200 border-y border-neutral-200">
          {homeFaqItems.map((item, index) => (
            <Reveal key={item.question} delay={index * 80}>
              <details className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-5 text-left">
                  <span className="text-base font-bold text-neutral-950 sm:text-lg">
                    {item.question}
                  </span>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-neutral-200 text-lg leading-none text-neutral-500 transition group-open:rotate-45 group-open:border-red-200 group-open:text-red-600">
                    +
                  </span>
                </summary>
                <p className="marketing-body mt-4 max-w-3xl text-neutral-600">
                  {item.answer}
                </p>
              </details>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
