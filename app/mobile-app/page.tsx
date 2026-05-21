import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  AppWindow,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  LockKeyhole,
  MonitorSmartphone,
  Share,
  Smartphone,
} from "lucide-react";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Studio OS Mobile App for Photographers",
  description:
    "Use Studio OS Mobile on iPhone to sign in, view schools and events, check orders, and manage gallery access from the field.",
  alternates: {
    canonical: "https://www.studiooscloud.com/mobile-app",
  },
};

const testFlightUrl = process.env.NEXT_PUBLIC_STUDIO_OS_MOBILE_TESTFLIGHT_URL?.trim();
const appStoreUrl = process.env.NEXT_PUBLIC_STUDIO_OS_MOBILE_APP_STORE_URL?.trim();

const featureCards = [
  {
    icon: MonitorSmartphone,
    title: "Schools and events",
    detail:
      "Photographers can sign in and see the same schools, events, galleries, and live statuses they manage on Studio OS Cloud.",
  },
  {
    icon: LockKeyhole,
    title: "PIN and privacy control",
    detail:
      "Open a gallery, review access, and update client-facing controls without needing to sit at the desktop dashboard.",
  },
  {
    icon: AppWindow,
    title: "Orders at a glance",
    detail:
      "Check recent orders and active work from the phone while moving between schools, events, or studio jobs.",
  },
];

const installSteps = [
  {
    title: "Open on iPhone",
    detail: "Visit studiooscloud.com/mobile-app in Safari on the photographer's iPhone.",
  },
  {
    title: "Tap Share",
    detail: "Use the Safari share button at the bottom of the screen.",
  },
  {
    title: "Add to Home Screen",
    detail: "Choose Add to Home Screen and save it as Studio OS Mobile.",
  },
];

export default function MobileAppPage() {
  return (
    <div className="min-h-screen bg-white text-neutral-950">
      <SiteHeader />

      <main>
        <section className="border-b border-neutral-200 bg-neutral-950 text-white">
          <div className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:py-24">
            <div className="flex flex-col justify-center">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white">
                <Smartphone className="h-4 w-4 text-red-400" />
                Studio OS Mobile
              </div>
              <h1 className="mt-7 max-w-3xl text-4xl font-black leading-[1.03] sm:text-6xl">
                Control schools and events from your iPhone.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-neutral-300">
                Give photographers a simple phone app for Studio OS Cloud. They can
                sign in, view their schools or events, check gallery status, and keep
                client access under control without opening the full desktop dashboard.
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/m"
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-red-600 px-6 py-3 text-sm font-bold text-white shadow-[0_18px_45px_rgba(220,38,38,0.34)] transition hover:bg-red-700"
                >
                  Open Studio OS Mobile
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/sign-in?redirect=%2Fm"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-white/20 bg-white px-6 py-3 text-sm font-bold text-neutral-950 transition hover:bg-neutral-100"
                >
                  Photographer Sign In
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </div>

              <p className="mt-5 max-w-2xl text-sm leading-6 text-neutral-400">
                The mobile web app works now. The native iOS app can be added here
                once it is approved through TestFlight or the App Store.
              </p>
            </div>

            <div className="flex items-center justify-center lg:justify-end">
              <div className="relative w-full max-w-[360px] rounded-[42px] border border-white/15 bg-neutral-900 p-3 shadow-[0_32px_90px_rgba(0,0,0,0.45)]">
                <div className="overflow-hidden rounded-[32px] bg-white text-neutral-950">
                  <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Image
                        src="/studio_os_logo_official_cropped.png"
                        alt=""
                        width={36}
                        height={36}
                        className="h-9 w-9 object-contain"
                        priority
                      />
                      <div className="text-sm font-black">Studio OS Mobile</div>
                    </div>
                    <div className="rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-600">
                      Live
                    </div>
                  </div>

                  <div className="space-y-4 bg-[#f7f5f2] p-4">
                    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
                      <p className="text-xs font-bold uppercase text-neutral-500">
                        Today
                      </p>
                      <p className="mt-2 text-2xl font-black">Good morning</p>
                      <div className="mt-4 grid grid-cols-3 gap-2">
                        {["Orders", "Schools", "Events"].map((label, index) => (
                          <div
                            key={label}
                            className="rounded-xl border border-neutral-100 bg-neutral-50 p-3 text-center"
                          >
                            <div className="text-xl font-black">
                              {[4, 12, 8][index]}
                            </div>
                            <div className="mt-1 text-[11px] font-semibold text-neutral-500">
                              {label}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {[
                      ["Pamela Wedding", "Event gallery", "Active"],
                      ["St. Mary School", "School gallery", "PIN on"],
                      ["Prom 2026", "Pre-release", "Emails"],
                    ].map(([title, kind, status]) => (
                      <div
                        key={title}
                        className="flex items-center justify-between rounded-2xl border border-neutral-200 bg-white p-4"
                      >
                        <div>
                          <p className="text-sm font-black">{title}</p>
                          <p className="mt-1 text-xs font-semibold text-neutral-500">
                            {kind}
                          </p>
                        </div>
                        <div className="rounded-full bg-neutral-950 px-3 py-1 text-xs font-bold text-white">
                          {status}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-neutral-200 bg-white">
          <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
            <div className="max-w-3xl">
              <h2 className="text-3xl font-black sm:text-4xl">
                Built for photographers in the field
              </h2>
              <p className="mt-4 text-base leading-7 text-neutral-600">
                Studio OS Mobile is the quick-control companion for the web
                dashboard. It is not replacing the desktop production app; it is
                for fast checks and simple changes from a phone.
              </p>
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {featureCards.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.title}
                    className="rounded-2xl border border-neutral-200 bg-neutral-50 p-6"
                  >
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-neutral-950 text-white">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="mt-5 text-lg font-black">{item.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-neutral-600">
                      {item.detail}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="border-b border-neutral-200 bg-[#f7f5f2]">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
            <div>
              <h2 className="text-3xl font-black sm:text-4xl">
                Install on iPhone today
              </h2>
              <p className="mt-4 text-base leading-7 text-neutral-600">
                Until the native iOS app is live in TestFlight or the App Store,
                photographers can install the mobile web app from Safari. It opens
                from the Home Screen like an app and keeps them signed in.
              </p>
              <Link
                href="/m"
                className="mt-7 inline-flex items-center justify-center gap-2 rounded-full bg-neutral-950 px-6 py-3 text-sm font-bold text-white transition hover:bg-black"
              >
                Open mobile app
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="grid gap-3">
              {installSteps.map((step, index) => (
                <div
                  key={step.title}
                  className="flex gap-4 rounded-2xl border border-neutral-200 bg-white p-5"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-600 text-sm font-black text-white">
                    {index + 1}
                  </div>
                  <div>
                    <h3 className="font-black">{step.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-neutral-600">
                      {step.detail}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-white">
          <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
            <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
              <div>
                <h2 className="text-3xl font-black sm:text-4xl">
                  Native iOS app distribution
                </h2>
                <p className="mt-4 text-base leading-7 text-neutral-600">
                  The iPhone build is ready for internal testing. For every
                  photographer to download it from this website, the public page
                  should link to TestFlight first, then the App Store when Apple
                  approves the release.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <DownloadOption
                  title="TestFlight beta"
                  detail="Invite photographers before the public App Store release."
                  href={testFlightUrl}
                  emptyLabel="TestFlight link coming soon"
                />
                <DownloadOption
                  title="App Store"
                  detail="Public iPhone download once the app is approved."
                  href={appStoreUrl}
                  emptyLabel="App Store release coming soon"
                />
              </div>
            </div>

            <div className="mt-10 grid gap-3 rounded-2xl border border-red-100 bg-red-50 p-5 text-sm leading-6 text-red-900 md:grid-cols-[auto_1fr]">
              <Share className="mt-0.5 h-5 w-5 text-red-600" />
              <p>
                A normal website cannot safely distribute an unsigned iPhone app
                to every photographer. The current website install works now as a
                mobile web app; the native app should go through TestFlight or the
                App Store for real customer installs.
              </p>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function DownloadOption({
  title,
  detail,
  href,
  emptyLabel,
}: {
  title: string;
  detail: string;
  href: string | undefined;
  emptyLabel: string;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-6">
      <div className="flex items-center gap-2 text-sm font-bold text-neutral-500">
        <CheckCircle2 className="h-4 w-4 text-red-600" />
        iPhone
      </div>
      <h3 className="mt-4 text-xl font-black">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-neutral-600">{detail}</p>
      {href ? (
        <Link
          href={href}
          className="mt-5 inline-flex items-center justify-center gap-2 rounded-full bg-neutral-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-black"
        >
          Open link
          <ExternalLink className="h-4 w-4" />
        </Link>
      ) : (
        <div className="mt-5 inline-flex items-center justify-center rounded-full border border-neutral-200 bg-white px-5 py-2.5 text-sm font-bold text-neutral-500">
          {emptyLabel}
        </div>
      )}
    </div>
  );
}
