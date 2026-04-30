import { LockKeyhole, Mail, PackageCheck, ShieldCheck } from "lucide-react";
import Image from "next/image";
import { Reveal } from "./Reveal";

const portalSteps = [
  "School selector",
  "Private PIN code",
  "Photos Coming Soon email capture",
  "Gallery released",
  "Order due date",
];

const packageCards = [
  { name: "Essential", price: "$28" },
  { name: "Classic", price: "$48" },
  { name: "Keepsake", price: "$72" },
];

const studentGalleryPhotos = [
  "/marketing/parent-gallery-student-01.png",
  "/marketing/parent-gallery-student-02.png",
  "/marketing/parent-gallery-student-03.png",
  "/marketing/parent-gallery-student-04.png",
];

export function SchoolParentSection() {
  return (
    <section id="parent-gallery-flow" className="bg-neutral-950 px-4 py-20 text-white sm:px-6 lg:px-8 lg:py-28">
      <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[0.9fr_1.1fr]">
        <Reveal>
          <p className="marketing-kicker text-red-400">
            Schools + Volume
          </p>
          <h2 className="marketing-title mt-4">
            Built for private school and volume ordering.
          </h2>
          <p className="marketing-body mt-5 text-white/70">
            Parents enter through a private access flow, view their child&apos;s
            gallery, choose packages, and place orders &mdash; while the photographer
            keeps control of production and fulfillment.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {portalSteps.map((step, index) => (
              <Reveal
                key={step}
                delay={index * 80}
                className="marketing-caption rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 font-medium text-white/80"
              >
                {step}
              </Reveal>
            ))}
          </div>
        </Reveal>

        <Reveal delay={160} className="relative flex justify-center">
          <div className="absolute inset-y-10 left-1/2 w-px bg-gradient-to-b from-red-500/0 via-red-500/40 to-red-500/0" />
          <div className="float-slower relative w-[min(86vw,330px)] rounded-[2.35rem] border border-white/20 bg-neutral-950 p-3 shadow-[0_35px_120px_rgba(0,0,0,0.55)]">
            <div className="relative h-[620px] overflow-hidden rounded-[1.85rem] bg-white text-neutral-950">
              <div className="absolute inset-x-0 top-0 z-10 bg-[linear-gradient(135deg,#111111,#2a0a0a)] px-5 py-5 text-white">
                <p className="marketing-kicker text-white/50">Parent Portal</p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <h3 className="marketing-card-title">Northview School</h3>
                  <span className="marketing-caption inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-1 font-semibold">
                    <ShieldCheck className="h-3.5 w-3.5 text-red-300" />
                    Private
                  </span>
                </div>
              </div>

              <div className="absolute inset-x-0 bottom-0 top-[118px]">
                <PinState />
                <GalleryState />
                <OrderState />
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function PinState() {
  return (
    <div className="phone-screen-state absolute inset-0 bg-white p-5">
      <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
        <label className="marketing-kicker text-neutral-500">School</label>
        <div className="marketing-caption mt-2 rounded-xl border border-neutral-200 bg-white px-3 py-3 font-semibold">
          Northview School 2026
        </div>
      </div>
      <div className="mt-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
        <label className="marketing-kicker text-neutral-500">PIN Code</label>
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-3 font-mono text-lg font-bold">
          <LockKeyhole className="h-4 w-4 text-red-500" />
          4821
        </div>
      </div>
      <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <div className="marketing-caption flex items-center gap-2 font-semibold text-amber-900">
          <Mail className="h-4 w-4" />
          Photos Coming Soon
        </div>
        <div className="marketing-caption mt-3 rounded-xl bg-white px-3 py-3 text-neutral-500">
          parent@email.com
        </div>
      </div>
    </div>
  );
}

function GalleryState() {
  return (
    <div className="phone-screen-state absolute inset-0 bg-white p-5 opacity-0">
      <div className="grid grid-cols-[0.92fr_1.08fr] gap-4 rounded-2xl border border-neutral-200 p-4">
        <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-neutral-200">
          <Image
            src={studentGalleryPhotos[0]}
            alt="Student portrait preview"
            fill
            sizes="120px"
            className="object-cover object-[50%_18%]"
          />
        </div>
        <div className="flex flex-col justify-between">
          <div>
            <div className="marketing-caption inline-flex rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-700">
              Gallery released
            </div>
            <h4 className="marketing-card-title mt-4">Student portrait</h4>
            <p className="marketing-caption mt-2 text-neutral-500">
              Order due date: May 18
            </p>
          </div>
          <div className="marketing-button rounded-full bg-neutral-950 px-4 py-3 text-center text-white">
            Order Photos
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {studentGalleryPhotos.map((src, index) => (
          <div
            key={src}
            className="relative aspect-square overflow-hidden rounded-xl bg-neutral-100"
          >
            <Image
              src={src}
              alt={`Student gallery thumbnail ${index + 1}`}
              fill
              sizes="78px"
              className="object-cover object-[50%_18%]"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function OrderState() {
  return (
    <div className="phone-screen-state absolute inset-0 bg-white p-5 opacity-0">
      <div className="marketing-caption mb-3 flex items-center gap-2 font-semibold">
        <PackageCheck className="h-4 w-4 text-red-500" />
        Package cards
      </div>
      <div className="space-y-3">
        {packageCards.map((card, index) => (
          <div
            key={card.name}
            className={`rounded-2xl border p-4 ${
              index === 1
                ? "border-neutral-950 bg-neutral-50 shadow-[0_16px_40px_rgba(0,0,0,0.08)]"
                : "border-neutral-200 bg-white"
            }`}
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="marketing-caption font-semibold">{card.name}</div>
                <div className="marketing-caption mt-1 text-neutral-500">Portrait package</div>
              </div>
              <div className="text-lg font-bold leading-none">{card.price}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="marketing-button mt-5 rounded-full bg-neutral-950 px-4 py-3 text-center text-white">
        Place Order
      </div>
    </div>
  );
}
