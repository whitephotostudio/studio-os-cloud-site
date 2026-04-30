import { Cloud, Monitor, UploadCloud } from "lucide-react";
import { Reveal } from "./Reveal";

const appFeatures = ["Capture", "Tethering", "Sorting", "Rosters", "AI tools"];
const cloudFeatures = ["Galleries", "Orders", "Downloads", "Private access"];

export function AppCloudSection() {
  return (
    <section className="bg-white px-4 py-20 text-neutral-950 sm:px-6 lg:px-8 lg:py-28">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <Reveal>
            <p className="marketing-kicker text-red-600">
              Connected System
            </p>
            <h2 className="marketing-title mt-4">
              From desktop capture to cloud delivery.
            </h2>
            <p className="marketing-body mt-5 text-neutral-600">
              Studio OS starts before the gallery. Organize projects, capture
              locally, manage school workflows, then publish to Studio OS Cloud for
              viewing, ordering, and delivery.
            </p>
            <p className="marketing-button mt-5 text-neutral-950">
              Capture locally. Publish beautifully. Keep orders connected.
            </p>
          </Reveal>

          <div className="grid gap-5 md:grid-cols-[1fr_auto_1fr] md:items-center">
            <Reveal delay={120}>
              <SystemCard
                icon={<Monitor className="h-6 w-6" />}
                title="Studio OS App"
                text="Capture, tethering, sorting, rosters, and AI tools stay close to production."
                items={appFeatures}
                dark
              />
            </Reveal>
            <Reveal delay={240} className="relative hidden h-px w-16 md:block">
              <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-neutral-300 via-red-500 to-neutral-300" />
              <div className="connection-pulse absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500 shadow-[0_0_24px_rgba(239,68,68,0.55)]" />
            </Reveal>
            <div className="flex justify-center md:hidden">
              <UploadCloud className="h-6 w-6 text-red-500" />
            </div>
            <Reveal delay={360}>
              <SystemCard
                icon={<Cloud className="h-6 w-6" />}
                title="Studio OS Cloud"
                text="Premium galleries, order review, downloads, and private access live online."
                items={cloudFeatures}
              />
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}

function SystemCard({
  icon,
  title,
  text,
  items,
  dark = false,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  items: string[];
  dark?: boolean;
}) {
  return (
    <article
      className={`premium-card rounded-[1.5rem] border p-6 shadow-sm ${
        dark
          ? "border-neutral-800 bg-neutral-950 text-white"
          : "border-neutral-200 bg-neutral-50 text-neutral-950"
      }`}
    >
      <div
        className={`mb-8 inline-flex rounded-2xl p-3 ${
          dark ? "bg-white/10 text-red-300" : "bg-white text-red-600"
        }`}
      >
        {icon}
      </div>
      <h3 className="marketing-card-title">{title}</h3>
      <p className={`marketing-caption mt-3 ${dark ? "text-white/60" : "text-neutral-600"}`}>
        {text}
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        {items.map((item) => (
          <span
            key={item}
            className={`marketing-caption rounded-full px-3 py-1.5 font-semibold ${
              dark ? "bg-white/10 text-white/70" : "bg-white text-neutral-700"
            }`}
          >
            {item}
          </span>
        ))}
      </div>
    </article>
  );
}
