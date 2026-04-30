import { Camera, CloudUpload, FolderKanban, PackageCheck, ShoppingBag } from "lucide-react";
import { Reveal } from "./Reveal";

const steps = [
  { label: "Capture", sub: "Desktop App", icon: Camera },
  { label: "Organize", sub: "Projects", icon: FolderKanban },
  { label: "Publish", sub: "Cloud", icon: CloudUpload },
  { label: "Order", sub: "Parent Gallery", icon: ShoppingBag },
  { label: "Deliver", sub: "Orders", icon: PackageCheck },
];

export function WorkflowStrip() {
  return (
    <section className="bg-white px-4 py-14 text-neutral-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="grid items-center gap-10 border-y border-neutral-200 py-10 lg:grid-cols-[0.82fr_1.18fr]">
          <Reveal as="h2" className="marketing-title">
            Beautiful galleries are only the beginning.
          </Reveal>

          <div>
            <Reveal className="relative grid gap-4 md:grid-cols-5 md:gap-0">
              <div className="workflow-line absolute left-[10%] right-[10%] top-6 hidden h-px bg-gradient-to-r from-red-500/0 via-red-500 to-red-500/0 md:block" />
              {steps.map(({ label, sub, icon: Icon }, index) => (
                <Reveal
                  key={label}
                  delay={index * 110}
                  className="relative z-10 flex items-center gap-3 md:flex-col md:text-center"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-full border border-neutral-200 bg-white text-red-600 shadow-[0_10px_30px_rgba(0,0,0,0.06)]">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="marketing-button block text-neutral-950">{label}</span>
                    <span className="marketing-caption mt-1 block text-neutral-500">{sub}</span>
                  </span>
                </Reveal>
              ))}
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
